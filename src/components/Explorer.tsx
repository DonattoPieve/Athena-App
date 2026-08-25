import { useEffect, useRef, useState } from "react";
import {
  api,
  mensagemDeErro,
  parseSelection,
  type ProgressoImportar,
  type TreeNode,
} from "../lib/api";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { useConfirm } from "./Confirm";
import { Chevron, FileIcon, FolderIcon, NuvemIcon } from "./icons";
import { t, tf } from "../lib/i18n";
// As tres guardas vivem em `lib/guardas.ts` e sao conferidas contra o
// vault.ts por `scripts/guardas.test.mjs` — ver o cabecalho de la.
import { apagavel, gravavel, recebeDeFora } from "../lib/guardas";

const EDITAVEIS = /\.(md|txt)$/i;
const MATERIAL = /\.(pdf|pptx?|docx?)$/i;

/** MIME custom do drag-and-drop de mover — so a arvore le, nao precisa ser padrao. */
const DND_MIME = "application/x-athena-rel";

/**
 * Nó que só existe no bucket ainda não tem arquivo nesta máquina.
 *
 * Renomear, mover ou apagar um deles falharia no main com "não encontrado" —
 * pior, pareceria bug do app. Aqui o item já nasce desabilitado; o que traz o
 * arquivo é abrir (ver electron/materiais.ts). Não é guarda de permissão, é
 * estado do disco — por isso não mora em `lib/guardas.ts`.
 */
function local(node: TreeNode) {
  return !node.remoto;
}

/**
 * Onde o arquivo cai quando e solto EM CIMA deste no.
 *
 * Pasta recebe nela mesma; ARQUIVO manda para a pasta que o contem. Mirar na
 * linha exata da pasta numa lista densa e a parte mais chata de arrastar, e
 * soltar em cima de um PDF da materia so pode querer dizer "junto desse PDF".
 * Antes disso, errar a linha por um item fazia o arrastar evaporar sem aviso.
 */
function destinoDe(node: TreeNode) {
  return node.dir ? node.rel : node.rel.split("/").slice(0, -1).join("/");
}

/**
 * Onde cai o que for solto no vazio do painel.
 *
 * `Notes/` e a raiz do que aceita arquivo de fora. Nao adivinha INATEL nem
 * subjects: o destino aparece escrito na faixa antes de soltar, e o recado
 * repete depois — palpite silencioso aqui seria material do professor
 * aterrissando na pasta errada.
 */
const RAIZ_DE_FORA = "Notes";

/**
 * Esse caminho tem cópia na nuvem?
 *
 * `Notes/INATEL` e `Notes/attachments` são objetos no R2; `Notes/subjects` são
 * linhas na tabela `notes`. O resto de `Notes/` (Ideias, rascunho) só existe
 * nesta máquina — e para esses a pergunta "apagar da nuvem também?" não faria
 * sentido nenhum.
 */
function temCopiaNaNuvem(rel: string) {
  return ["Notes/INATEL", "Notes/attachments", "Notes/subjects"].some(
    (p) => rel === p || rel.startsWith(p + "/"),
  );
}

/** O arrasto traz arquivo do sistema, e não um nó da própria árvore? */
function temArquivoDeFora(e: React.DragEvent) {
  return Array.from(e.dataTransfer.types).includes("Files");
}

type Criando = { dir: string; tipo: "pasta" | "nota" } | null;

type Props = {
  nodes: TreeNode[];
  /** Primeira carga ainda em voo — inclui a ida à nuvem. */
  carregando?: boolean;
  selected: string | null;
  onSelect: (rel: string) => void;
  onOpen?: (rel: string) => void;
  onChanged: () => void;
  readOnly?: boolean;
  scope: "Notes" | "Resumos";
  /** Dispara `athena delete CODIGO AULA` — quem executa e o App. */
  onExcluir?: (code: string, lesson: string | null) => void;
};

export function Explorer({
  nodes,
  carregando,
  selected,
  onSelect,
  onOpen,
  onChanged,
  readOnly,
  scope,
  onExcluir,
}: Props) {
  const menu = useContextMenu();
  const { confirmar, dialogo, caixaMarcada } = useConfirm();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [criando, setCriando] = useState<Criando>(null);
  const [erro, setErro] = useState<string | null>(null);
  // "Copiei 12 arquivos" não é erro e não pode sair em vermelho — mas some
  // sozinho também não pode: importar é a única ação aqui sem efeito visível
  // imediato quando a pasta está fechada.
  const [recado, setRecado] = useState<string | null>(null);
  // Pasta sob o cursor durante um arrastar — so o realce visual, a validacao
  // de verdade (origem gravavel, destino gravavel, sem sobrescrever) e do
  // main via vault.mover().
  const [dragOverRel, setDragOverRel] = useState<string | null>(null);
  /** Arrastando de fora, mas longe de qualquer linha: o destino e a raiz. */
  const [deForaNoFundo, setDeForaNoFundo] = useState(false);
  /** Copia em andamento — vem do main a cada arquivo (ver `fs:importar`). */
  const [progresso, setProgresso] = useState<ProgressoImportar | null>(null);

  useEffect(() => api.fs.onImportacao?.(setProgresso), []);

  // O recado some sozinho. Ele e a unica confirmacao de que a copia aconteceu
  // (com a pasta fechada, nada muda na arvore), mas deixado ali vira legenda
  // permanente e passa a descrever uma acao que ja saiu da cabeca de quem le.
  useEffect(() => {
    if (!recado) return;
    const id = window.setTimeout(() => setRecado(null), 12_000);
    return () => window.clearTimeout(id);
  }, [recado]);

  async function guard(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  /** Recebe o que o Windows soltou em cima de uma pasta da árvore. */
  async function importar(destino: string, arquivos: FileList) {
    const origens = Array.from(arquivos)
      .map((f) => api.fs.caminhoDoArquivo(f))
      .filter(Boolean);
    if (origens.length === 0) return;

    setErro(null);
    setRecado(null);
    try {
      const { copiados, jaExistiam } = await api.fs.importar(destino, origens);
      onChanged();
      const partes: string[] = [];
      if (copiados) partes.push(tf("{n} arquivo(s) copiado(s) para {destino}", { n: copiados, destino }));
      if (jaExistiam.length) {
        // Materia inteira que ja existia devolve uma lista de centenas de
        // nomes, e uma parede de texto no rodape da arvore nao e resposta.
        // Tres nomes bastam para reconhecer o que foi pulado.
        const mostra = jaExistiam.slice(0, 3).join(", ");
        partes.push(
          jaExistiam.length > 3
            ? tf("já existiam, não sobrescrevi: {nomes} e mais {n}", {
                nomes: mostra,
                n: jaExistiam.length - 3,
              })
            : tf("já existia, não sobrescrevi: {nomes}", { nomes: mostra }),
        );
      }
      setRecado(partes.join(" · ") || t("Nada a copiar."));
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      // O main manda `null` no fim, mas se ele morrer no meio a linha de
      // progresso ficaria para sempre — e ela diz "copiando".
      setProgresso(null);
    }
  }

  /**
   * Rola a arvore sozinha quando o cursor encosta na borda durante o arrasto.
   *
   * Com a mao segurando o botao do mouse nao ha roda nem barra de rolagem: a
   * pasta que esta abaixo da area visivel era simplesmente inalcancavel.
   */
  function rolarSeNaBorda(e: React.DragEvent) {
    const caixa = (e.currentTarget as HTMLElement).closest(".scroll") as HTMLElement | null;
    if (!caixa) return;
    const r = caixa.getBoundingClientRect();
    const margem = 36;
    if (e.clientY < r.top + margem) caixa.scrollTop -= 16;
    else if (e.clientY > r.bottom - margem) caixa.scrollTop += 16;
  }

  /** Arrasto de fora passando pelo painel, mas nao por cima de uma linha. */
  function aoArrastarNoFundo(e: React.DragEvent) {
    rolarSeNaBorda(e);
    if (readOnly || !temArquivoDeFora(e)) return;
    // Uma linha ja tratou: o destino e o dela, e o realce tambem.
    if ((e.target as HTMLElement).closest(".exp-row")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (dragOverRel !== RAIZ_DE_FORA) setDragOverRel(RAIZ_DE_FORA);
    if (!deForaNoFundo) setDeForaNoFundo(true);
  }

  function aoSoltarNoFundo(e: React.DragEvent) {
    setDeForaNoFundo(false);
    if (readOnly || !temArquivoDeFora(e)) return;
    if ((e.target as HTMLElement).closest(".exp-row")) return;
    e.preventDefault();
    setDragOverRel(null);
    void importar(RAIZ_DE_FORA, e.dataTransfer.files);
  }

  /**
   * Apagar, com a confirmação. Sai daqui, e não de dentro do menu, porque a
   * tecla Del faz exatamente a mesma coisa — e duas cópias do mesmo diálogo
   * divergiriam na primeira vez que um texto mudasse.
   */
  async function apagarNode(node: TreeNode) {
    if (!apagavel(node.rel)) return;
    // Só o que mora na nuvem ganha a caixa: oferecer "apagar da nuvem"
    // numa pasta de ideias soltas seria uma pergunta sem resposta certa.
    const naNuvem = temCopiaNaNuvem(node.rel);
    // Nada no disco: a única coisa que "apagar" pode significar aqui é
    // tirar da nuvem. Oferecer a caixa seria oferecer um botão que, se
    // desmarcado, não faz nada.
    const soNaNuvem = !!node.remoto;

    const ok = await confirmar({
      titulo: node.dir
        ? tf("Apagar a pasta {nome}?", { nome: node.name })
        : tf("Apagar {nome}?", { nome: node.name }),
      mensagem: soNaNuvem
        ? t(
            "Este arquivo não está nesta máquina — ele está só na sua conta na nuvem. Apagar tira dela.",
          )
        : node.dir
          ? t("A pasta e tudo que está dentro dela vão para a lixeira do Windows.")
          : t("O arquivo vai para a lixeira do Windows."),
      detalhe: node.rel,
      caixa:
        naNuvem && !soNaNuvem
          ? {
              rotulo: t(
                "Apagar também da nuvem (Cloudflare e banco de dados). Sem isto, sai só desta máquina e volta a aparecer aqui como material da nuvem.",
              ),
              inicial: true,
            }
          : undefined,
      nota: node.rel.startsWith("Resumos/")
        ? t(
            "Dá para restaurar pela lixeira. Como a wiki é espelho do banco, o que você apagar aqui volta no próximo pull — para sair de vez, publique depois de apagar.",
          )
        : naNuvem
          ? t(
              "Apagar da nuvem é definitivo: o Cloudflare não guarda versão anterior, e nenhum outro PC recupera o arquivo depois.",
            )
          : t(
              "Dá para restaurar pela lixeira. O que já foi publicado só sai do site no próximo publish, que espelha o disco.",
            ),
      confirmar: t("Apagar"),
    });
    if (!ok) return;

    const tambemNaNuvem = naNuvem && (soNaNuvem || caixaMarcada.current);
    setErro(null);
    setRecado(null);
    try {
      const r = await api.fs.trash(node.rel, tambemNaNuvem);
      onChanged();
      if (r && (r.r2 || r.banco)) {
        setRecado(
          tf("Fora da nuvem: {r2} arquivo(s) no Cloudflare, {banco} nota(s) no banco.", {
            r2: r.r2,
            banco: r.banco,
          }),
        );
      }
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  /** Pasta onde a acao acontece: o proprio no se for pasta, senao o pai. */
  function dirDe(node: TreeNode) {
    return node.dir ? node.rel : node.rel.split("/").slice(0, -1).join("/");
  }

  /**
   * "Excluir do Athena" — so em `Resumos/`, e so em pagina de aula.
   *
   * Apagar o .md de `Resumos/` na mao deixa a pagina viva no site ate o proximo
   * publish, e deixa o MOC apontando para o vazio. `athena delete` e o caminho
   * que o CLAUDE.md define: tira a pagina, desfaz as ligacoes e registra a
   * remocao no log. Por isso este item nao mexe em arquivo — enfileira o
   * comando.
   */
  function excluirDaWiki(node: TreeNode): MenuItem[] {
    if (scope !== "Resumos" || node.dir || !onExcluir) return [];
    const alvo = parseSelection(node.rel);
    if (!alvo) return [];

    const oQue = alvo.lesson
      ? tf("a aula {lesson}", { lesson: alvo.lesson })
      : tf("a matéria {code} inteira", { code: alvo.code });
    return [
      { kind: "sep" },
      {
        label: t("Excluir do Athena"),
        hint: "athena delete",
        danger: true,
        onClick: async () => {
          const ok = await confirmar({
            titulo: alvo.lesson
              ? tf("Excluir {nome}?", { nome: node.name })
              : tf("Excluir a matéria {code}?", { code: alvo.code }),
            mensagem: tf(
              "Isto roda {cmd}, que remove {oQue} da wiki, desfaz as ligações no MOC e anota a remoção no log.",
              {
                cmd: alvo.lesson
                  ? `athena delete ${alvo.code} ${alvo.lesson}`
                  : `athena delete ${alvo.code}`,
                oQue,
              },
            ),
            detalhe: node.rel,
            nota: t(
              "A sua nota em Notes/ e o material oficial não são tocados — dá para gerar de novo depois. Do site a página só some no próximo publish.",
            ),
            confirmar: t("Excluir"),
          });
          if (ok) onExcluir(alvo.code, alvo.lesson);
        },
      },
    ];
  }

  function itensDe(node: TreeNode): MenuItem[] {
    const dir = dirDe(node);
    // Criar segue a regra de ACRESCENTAR (Notes/ inteiro), não a de editar:
    // é assim que uma matéria nova nasce em Notes/INATEL sem sair do app.
    const podeCriar = recebeDeFora(dir);
    const podeMexer = gravavel(node.rel) && local(node);

    const abrirMaterial: MenuItem[] = MATERIAL.test(node.name)
      ? [
          { kind: "sep" },
          {
            label: t("Abrir no programa padrão"),
            onClick: () => guard(() => api.fs.openExternal(node.rel)),
          },
        ]
      : [];

    // So arquivo: destacar uma pasta em janela propria nao faz sentido, ela
    // ja tem lugar na arvore. `aba` tem que bater exatamente com o formato
    // que o App usa para arquivo (ver `type Aba` em App.tsx).
    const abrirOutraJanela: MenuItem[] = !node.dir
      ? [
          {
            label: t("Abrir em outra janela"),
            onClick: () =>
              void guard(() =>
                api.win.destacar({ id: node.rel, tipo: "arquivo", rel: node.rel }),
              ),
          },
        ]
      : [];

    return [
      {
        label: t("Nova nota"),
        hint: ".md",
        disabled: !podeCriar,
        onClick: () => setCriando({ dir, tipo: "nota" }),
      },
      { label: t("Nova pasta"), disabled: !podeCriar, onClick: () => setCriando({ dir, tipo: "pasta" }) },
      { kind: "sep" },
      { label: t("Renomear"), hint: "F2", disabled: !podeMexer, onClick: () => setRenaming(node.rel) },
      { label: t("Copiar caminho"), onClick: () => void api.clipboard.write(node.rel) },
      ...abrirMaterial,
      ...abrirOutraJanela,
      { kind: "sep" },
      { label: t("Revelar no Explorer"), onClick: () => void api.fs.reveal(node.rel) },
      ...excluirDaWiki(node),
      {
        label: node.dir ? t("Apagar pasta") : t("Apagar"),
        hint: "Del",
        danger: true,
        // Nó que só existe na nuvem TAMBÉM pode: agora existe para onde mandar
        // o pedido. Renomear e mover continuam fora, porque esses precisam de
        // arquivo local.
        disabled: !apagavel(node.rel),
        onClick: () => void apagarNode(node),
      },
    ];
  }

  /** Menu do fundo da arvore: criar na raiz do escopo. */
  function itensDoFundo(): MenuItem[] {
    const dir = scope === "Notes" ? "Notes/subjects" : "Resumos";
    const podeCriar = recebeDeFora(dir);
    return [
      {
        label: t("Nova pasta de matéria"),
        disabled: !podeCriar,
        onClick: () => setCriando({ dir, tipo: "pasta" }),
      },
      { label: t("Nova nota"), disabled: !podeCriar, onClick: () => setCriando({ dir, tipo: "nota" }) },
    ];
  }

  const criandoNaRaiz = criando && !nodes.some((n) => contem(n, criando.dir));

  return (
    <div
      style={{ minHeight: "100%" }}
      onContextMenu={(e) => menu.open(e, itensDoFundo())}
      onDragOver={aoArrastarNoFundo}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDeForaNoFundo(false);
        setDragOverRel(null);
      }}
      onDrop={aoSoltarNoFundo}
    >
      {nodes.length === 0 && !criando ? (
        <p style={{ color: "var(--c-muted)", padding: "8px 10px", fontSize: 12 }}>
          {carregando
            ? t("Procurando o material desta conta…")
            : t("Nada aqui ainda. Botão direito para criar.")}
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {nodes.map((n) => (
            <Row
              key={n.rel}
              node={n}
              depth={0}
              selected={selected}
              onSelect={onSelect}
              onOpen={onOpen}
              readOnly={readOnly}
              onMenu={(e, node) => menu.open(e, itensDe(node))}
              renaming={renaming}
              setRenaming={setRenaming}
              criando={criando}
              setCriando={setCriando}
              guard={guard}
              importar={importar}
              apagarNode={apagarNode}
              dragOverRel={dragOverRel}
              setDragOverRel={setDragOverRel}
            />
          ))}
        </ul>
      )}

      {criandoNaRaiz && (
        <NomeInline
          inicial=""
          placeholder={criando.tipo === "pasta" ? t("nome da pasta") : t("nome da nota")}
          depth={0}
          onCancel={() => setCriando(null)}
          onConfirm={(nome) => {
            setCriando(null);
            const rel = `${criando.dir}/${nome}`;
            void guard(() =>
              criando.tipo === "pasta" ? api.fs.mkdir(rel) : api.fs.create(comMd(rel)),
            );
          }}
        />
      )}

      {deForaNoFundo && (
        <p className="exp-solte-aqui">
          {tf("Solte para copiar em {destino}/", { destino: RAIZ_DE_FORA })}
        </p>
      )}

      {progresso && (
        <div className="exp-progresso">
          <div className="exp-progresso-barra">
            <span
              style={{
                width: `${progresso.total ? (progresso.feitos / progresso.total) * 100 : 0}%`,
              }}
            />
          </div>
          <p>
            {tf("Copiando {feitos} de {total} — {nome}", {
              feitos: progresso.feitos,
              total: progresso.total,
              nome: progresso.nome,
            })}
          </p>
        </div>
      )}

      {erro && (
        <p style={{ color: "#e24b4a", fontSize: 11, padding: "6px 10px", margin: 0 }}>{erro}</p>
      )}
      {recado && (
        <p style={{ color: "var(--c-muted)", fontSize: 11, padding: "6px 10px", margin: 0 }}>
          {recado}
        </p>
      )}

      <ContextMenu state={menu.state} onClose={menu.close} />
      {dialogo}
    </div>
  );
}

function contem(node: TreeNode, dir: string): boolean {
  if (node.rel === dir) return true;
  return (node.children ?? []).some((c) => contem(c, dir));
}

function comMd(rel: string) {
  return /\.[a-z0-9]+$/i.test(rel) ? rel : `${rel}.md`;
}

function Row({
  node,
  depth,
  selected,
  onSelect,
  onOpen,
  readOnly,
  onMenu,
  renaming,
  setRenaming,
  criando,
  setCriando,
  guard,
  importar,
  apagarNode,
  dragOverRel,
  setDragOverRel,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (rel: string) => void;
  onOpen?: (rel: string) => void;
  readOnly?: boolean;
  onMenu: (e: React.MouseEvent, node: TreeNode) => void;
  renaming: string | null;
  setRenaming: (r: string | null) => void;
  criando: Criando;
  setCriando: (c: Criando) => void;
  guard: (fn: () => Promise<unknown>) => Promise<void>;
  importar: (destino: string, arquivos: FileList) => Promise<void>;
  apagarNode: (node: TreeNode) => Promise<void>;
  dragOverRel: string | null;
  setDragOverRel: (r: string | null) => void;
}) {
  // Tudo fechado ao abrir o app: a arvore inteira aberta e uma parede de nomes
  // e o caminho ate a aula some no meio. Pasta que recebe arquivo novo continua
  // abrindo sozinha (o efeito logo abaixo).
  const [open, setOpen] = useState(false);
  const criandoAqui = criando?.dir === node.rel;

  /**
   * Pasta fechada abre sozinha depois de um instante parado em cima dela.
   *
   * Sem isto, soltar dentro de `Notes/INATEL/C09-.../extras` exigia lembrar de
   * abrir a pasta ANTES de comecar a arrastar — com o botao do mouse
   * pressionado nao ha mais como clicar na seta. Meio segundo e o bastante
   * para separar "estou passando por cima" de "e aqui que eu quero entrar".
   */
  const abrirAoPairar = useRef<number | null>(null);
  function pararDeAbrir() {
    if (abrirAoPairar.current === null) return;
    window.clearTimeout(abrirAoPairar.current);
    abrirAoPairar.current = null;
  }
  useEffect(() => pararDeAbrir, []);

  useEffect(() => {
    if (criandoAqui) setOpen(true);
  }, [criandoAqui]);

  if (renaming === node.rel) {
    return (
      <li>
        <NomeInline
          inicial={node.name}
          depth={depth}
          onCancel={() => setRenaming(null)}
          onConfirm={(nome) => {
            setRenaming(null);
            if (nome !== node.name) void guard(() => api.fs.rename(node.rel, nome));
          }}
        />
      </li>
    );
  }

  // So o que o menu deixaria mexer pode ser arrastado; so pasta gravavel pode
  // receber. Resumos/ e Notes/INATEL ficam de fora dos dois lados sem checagem
  // extra — e a mesma lista que ja guarda o menu de contexto.
  const podeArrastar = !readOnly && gravavel(node.rel) && local(node);
  const podeReceberDrop = !readOnly && node.dir && gravavel(node.rel) && local(node);
  // Vindo do Windows a regra é outra e mais larga: `Notes/INATEL` não aceita
  // edição, mas aceita matéria nova. Ver `recebeDeFora` acima.
  // Sem `local()` aqui, ao contrário do mover: uma pasta que só existe no
  // espelho do R2 (nada dela baixado) ainda é o lugar certo para soltar
  // material novo — o main a cria no disco na hora.
  // E não exige que a linha seja pasta: soltar num arquivo cai na pasta dele
  // (ver `destinoDe`), que é o único destino que aquele gesto pode significar.
  const destinoDeFora = destinoDe(node);
  const podeReceberDeFora = !readOnly && recebeDeFora(destinoDeFora);

  /**
   * O que a linha diz de si mesma quando o arquivo ainda está na nuvem.
   *
   * Sem uma frase aqui, um arquivo apagado e um arquivo que nunca desceu ficam
   * com a mesma cara — e a diferença é grande: um sumiu, o outro chega no
   * clique.
   */
  const titulo = node.remoto
    ? node.emCache
      ? tf("{rel} — já baixado, abre sem internet", { rel: node.rel })
      : tf("{rel} — está na sua conta, ainda não nesta máquina. Clique para trazer.", {
          rel: node.rel,
        })
    : readOnly
      ? tf("{rel} — somente leitura", { rel: node.rel })
      : node.rel;

  return (
    <li>
      <button
        className="nav-item exp-row"
        data-active={selected === node.rel}
        data-dir={node.dir}
        data-drop-over={(podeReceberDrop || podeReceberDeFora) && dragOverRel === node.rel}
        data-remoto={node.remoto ? true : undefined}
        style={{ paddingLeft: 8 + depth * 14, gap: 6 }}
        draggable={podeArrastar}
        onClick={() => {
          if (node.dir) setOpen((o) => !o);
          onSelect(node.rel);
          if (!node.dir) onOpen?.(node.rel);
        }}
        onContextMenu={(e) => {
          onSelect(node.rel);
          onMenu(e, node);
        }}
        onKeyDown={(e) => {
          if (e.key === "F2" && gravavel(node.rel) && local(node)) {
            e.preventDefault();
            setRenaming(node.rel);
          }
          // Del faz o mesmo que o item do menu — inclusive o diálogo. Existe
          // porque "botão direito e o último item" é a única porta hoje, e
          // menu de contexto é a parte da interface que ninguém encontra.
          if (e.key === "Delete" && apagavel(node.rel)) {
            e.preventDefault();
            void apagarNode(node);
          }
        }}
        onDragStart={(e) => {
          if (!podeArrastar) return;
          e.dataTransfer.setData(DND_MIME, node.rel);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          const deFora = temArquivoDeFora(e);
          if (deFora ? !podeReceberDeFora : !podeReceberDrop) return;
          // preventDefault e o que sinaliza ao navegador que este alvo aceita
          // o drop — sem isso o onDrop nunca dispara.
          e.preventDefault();
          // "copy" de fora, "move" de dentro: o cursor do Windows passa a
          // dizer a verdade sobre o que vai acontecer com o original.
          e.dataTransfer.dropEffect = deFora ? "copy" : "move";
          // O realce vai para a pasta que VAI RECEBER, que nem sempre e a
          // linha sob o cursor: parado em cima de um PDF, quem acende e a
          // pasta dele. E o unico jeito de o destino ser visivel antes de
          // soltar.
          const alvo = deFora ? destinoDeFora : node.rel;
          if (dragOverRel !== alvo) setDragOverRel(alvo);
          if (node.dir && !open && abrirAoPairar.current === null) {
            abrirAoPairar.current = window.setTimeout(() => {
              abrirAoPairar.current = null;
              setOpen(true);
            }, 600);
          }
        }}
        onDragLeave={(e) => {
          if (!podeReceberDrop && !podeReceberDeFora) return;
          // relatedTarget dentro do proprio botao e so o cursor passando por
          // cima do icone/texto — nao pode apagar o realce nesse caso.
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          pararDeAbrir();
          setDragOverRel(null);
        }}
        onDrop={(e) => {
          const deFora = temArquivoDeFora(e);
          pararDeAbrir();
          if (deFora ? !podeReceberDeFora : !podeReceberDrop) return;
          e.preventDefault();
          setDragOverRel(null);
          if (deFora) {
            // Pasta inteira também vem por aqui: o Windows entrega a pasta
            // como um item só, e o main copia a árvore dela — mesclando com a
            // que já existir, sem sobrescrever arquivo nenhum.
            void importar(destinoDeFora, e.dataTransfer.files);
            return;
          }
          const origem = e.dataTransfer.getData(DND_MIME);
          if (origem && origem !== node.rel) void guard(() => api.fs.mover(origem, node.rel));
        }}
        title={titulo}
      >
        {node.dir ? (
          <>
            <Chevron open={open} />
            <FolderIcon open={open} />
          </>
        ) : (
          <>
            <span style={{ width: 10, flex: "0 0 auto" }} />
            {node.remoto ? (
              <NuvemIcon baixado={node.emCache} />
            ) : (
              <FileIcon material={!EDITAVEIS.test(node.name)} />
            )}
          </>
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
      </button>

      {node.dir && open && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {(node.children ?? []).map((c) => (
            <Row
              key={c.rel}
              node={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              onOpen={onOpen}
              readOnly={readOnly}
              onMenu={onMenu}
              renaming={renaming}
              setRenaming={setRenaming}
              dragOverRel={dragOverRel}
              setDragOverRel={setDragOverRel}
              criando={criando}
              setCriando={setCriando}
              guard={guard}
              importar={importar}
              apagarNode={apagarNode}
            />
          ))}
          {criandoAqui && criando && (
            <li>
              <NomeInline
                inicial=""
                placeholder={criando.tipo === "pasta" ? t("nome da pasta") : t("nome da nota")}
                depth={depth + 1}
                onCancel={() => setCriando(null)}
                onConfirm={(nome) => {
                  setCriando(null);
                  const rel = `${node.rel}/${nome}`;
                  void guard(() =>
                    criando.tipo === "pasta" ? api.fs.mkdir(rel) : api.fs.create(comMd(rel)),
                  );
                }}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** Campo no lugar da linha — igual ao VS Code, sem caixa de diálogo. */
function NomeInline({
  inicial,
  placeholder,
  depth,
  onCancel,
  onConfirm,
}: {
  inicial: string;
  placeholder?: string;
  depth: number;
  onCancel: () => void;
  onConfirm: (nome: string) => void;
}) {
  const [valor, setValor] = useState(inicial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    // Seleciona so o nome, nao a extensao — renomear .md nao deve exigir
    // redigitar o sufixo.
    const ponto = inicial.lastIndexOf(".");
    ref.current?.setSelectionRange(0, ponto > 0 ? ponto : inicial.length);
  }, [inicial]);

  const recuo = 10 + depth * 14;

  return (
    <input
      ref={ref}
      className="field"
      placeholder={placeholder}
      value={valor}
      style={{ marginLeft: recuo, width: `calc(100% - ${recuo + 8}px)`, padding: "3px 6px", fontSize: 12 }}
      onChange={(e) => setValor(e.target.value)}
      onBlur={onCancel}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && valor.trim()) onConfirm(valor.trim());
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
