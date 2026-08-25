import { useCallback, useEffect, useState } from "react";
import { api, parseSelection, type SubjectRef, type Target, type TreeNode } from "./lib/api";
import { Explorer } from "./components/Explorer";
import { Home } from "./components/Home";
import { CommandBar } from "./components/CommandBar";
import { SessionPanel } from "./components/SessionPanel";
import { PublishPanel } from "./components/PublishPanel";
import { NoteEditor } from "./components/NoteEditor";
import { FileEditor } from "./components/FileEditor";
import { MarkdownView } from "./components/MarkdownView";
import { Leitura } from "./components/Leitura";
import { MaterialView } from "./components/MaterialView";
import { ImageView } from "./components/ImageView";
import { Login } from "./components/Login";
import { PrimeiroUso } from "./components/PrimeiroUso";
import { Settings, type PedidoSecao, type SecaoConfig } from "./components/Settings";
import { Profile } from "./components/Profile";
import { Avatar } from "./components/Avatar";
import { Glossario } from "./components/Biblioteca";
import { MeuConteudo } from "./components/MeuConteudo";
import { ControlesJanela } from "./components/TitleBar";
import { Sidebar, type Destino } from "./components/Sidebar";
import { TaskCenter } from "./components/TaskCenter";
import { useConfirm } from "./components/Confirm";
import { SeletorPagina } from "./components/SeletorPagina";
import { t, tf } from "./lib/i18n";
import {
  IconArquivos,
  IconBusca,
  IconComandos,
  IconConfig,
  IconLivro,
  IconMais,
  IconPerfil,
} from "./components/icons";
import type { Account } from "./lib/api";

type Scope = "Notes" | "Resumos";

const MATERIAL = /\.(pdf|pptx?|docx?)$/i;
const TEXTO = /\.(md|txt)$/i;
/** O Chromium do Electron desenha todos estes — nao precisa de programa de fora. */
const IMAGEM = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
/** Editavel = Notes/ inteiro menos Notes/INATEL — espelha o vault.ts. */
const EDITAVEL = (rel: string) => rel.startsWith("Notes/") && !rel.startsWith("Notes/INATEL/");

/**
 * ABAS
 * ----
 * Tudo que se abre e uma aba, como num editor de codigo. "Comandos" e fixa
 * (nao fecha) porque e de onde os comandos saem; as outras nascem do clique
 * na arvore e morrem no X.
 *
 * Antes existia um item "Arquivo" na navegacao mostrando o selecionado: so
 * cabia um por vez, e clicar na arvore trocava o que voce estava lendo.
 */
type Aba =
  | { id: "home"; tipo: "home" }
  | { id: "comandos"; tipo: "comandos" }
  | { id: "config"; tipo: "config" }
  | { id: "perfil"; tipo: "perfil" }
  | { id: "nova-nota"; tipo: "nova-nota" }
  | { id: "glossario"; tipo: "glossario" }
  | { id: "conteudo"; tipo: "conteudo" }
  | { id: string; tipo: "arquivo"; rel: string };

const ABA_HOME: Aba = { id: "home", tipo: "home" };
const ABA_COMANDOS: Aba = { id: "comandos", tipo: "comandos" };
const ABA_CONFIG: Aba = { id: "config", tipo: "config" };
const ABA_PERFIL: Aba = { id: "perfil", tipo: "perfil" };
const ABA_GLOSSARIO: Aba = { id: "glossario", tipo: "glossario" };
const ABA_CONTEUDO: Aba = { id: "conteudo", tipo: "conteudo" };

const ROTULO: Record<string, string> = {
  home: t("Home"),
  comandos: t("Comandos"),
  config: t("Configurações"),
  perfil: t("Perfil"),
  "nova-nota": t("Nova nota"),
  glossario: t("Glossário"),
};

/** Painel que o rail de icones mostra na lateral. */
type Painel = "arquivos" | "busca";

const TASK_MIN = 280;
const TASK_PADRAO = 336;

const MENU_MIN = 190;
const MENU_MAX = 520;
const MENU_PADRAO = 260;

/**
 * Aba que veio no hash, quando esta janela nasceu de uma aba arrancada.
 *
 * O `main` poe `#aba=<json>` na URL da janela nova. Ler aqui, e nao esperar um
 * IPC, e o que faz a janela ja montar com o conteudo certo — por IPC a Home
 * apareceria por um instante antes de ser trocada.
 */
function abaDoHash(): Aba | null {
  const m = /[#&]aba=([^&]+)/.exec(location.hash);
  if (!m) return null;
  try {
    const a = JSON.parse(decodeURIComponent(m[1]));
    return a && typeof a.id === "string" && typeof a.tipo === "string" ? (a as Aba) : null;
  } catch {
    return null;
  }
}

export default function App() {
  /** Lida uma vez: o hash nao muda depois que a janela abriu. */
  const [destacada] = useState(abaDoHash);
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  /** null = ainda verificando; false = precisa entrar. */
  const [conta, setConta] = useState<Account | null | false>(null);
  /** Quem esta logado. Trocar de conta troca de vault — ver o efeito abaixo. */
  const uidConta = conta ? conta.id : null;
  const [scope, setScope] = useState<Scope>("Notes");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [carregandoArvore, setCarregandoArvore] = useState(true);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  /** Secao pedida da tela de Configuracoes — ver `abrirConfig`. */
  const [secaoConfig, setSecaoConfig] = useState<PedidoSecao | null>(null);
  const [fileText, setFileText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  // Janela destacada comeca com UMA aba: a que foi arrancada. Sem Home — ela
  // e a janela daquela aba, e fechar a aba fecha a janela.
  const [abas, setAbas] = useState<Aba[]>(destacada ? [destacada] : [ABA_HOME]);
  const [ativa, setAtiva] = useState<string>(destacada ? destacada.id : "home");

  /** Aba sendo arrastada na barra — indice, nao id, porque a ordem e o dado. */
  const [arrastando, setArrastando] = useState<number | null>(null);

  const [painel, setPainel] = useState<Painel>("arquivos");
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState<{ nome: string; rel: string }[]>([]);
  /** Resultados de dentro dos arquivos — o nome nem sempre lembra o assunto. */
  const [noConteudo, setNoConteudo] = useState<
    { rel: string; linha: number; trecho: string }[]
  >([]);

  /** O Task Center encolhe em tela estreita, mas nao some (spec §19). */
  const [larguraTask, setLarguraTask] = useState(TASK_PADRAO);
  useEffect(() => {
    const medir = () =>
      setLarguraTask(window.innerWidth < 1280 ? TASK_MIN : TASK_PADRAO);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  /** Versao vinda do processo principal — uma fonte so com o package.json. */
  const [versao, setVersao] = useState("");
  useEffect(() => {
    api.app.versao().then(setVersao).catch(() => setVersao(""));
  }, []);

  /** Contador, nao booleano: cada clique tem que reabrir o monitor. */
  const [abrirMonitor, setAbrirMonitor] = useState(0);

  function alternarTema() {
    const atual = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const novo = atual === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", novo);
    localStorage.setItem("athena-theme", novo);
  }

  const [larguraMenu, setLarguraMenu] = useState(() => {
    const salvo = Number(localStorage.getItem("athena-menu-w"));
    return salvo >= MENU_MIN && salvo <= MENU_MAX ? salvo : MENU_PADRAO;
  });

  const { confirmar, dialogo } = useConfirm();
  /** Ctrl+P: abrir arquivo sem tirar a mao do teclado. */
  const [abrindoRapido, setAbrindoRapido] = useState(false);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  /**
   * Atalhos.
   *
   * O app tem cara de IDE; quem usa IDE tem o reflexo no dedo. Ctrl+P abre
   * pagina, Ctrl+W fecha a aba, Ctrl+Shift+P vai para os comandos.
   *
   * O Ctrl+W NAO dispara com o cursor dentro do editor. Fechar a aba com a
   * mao no texto e o caminho curto para perder o que estava sendo escrito, e
   * o dedo erra `w` mirando em outra tecla o tempo todo. Ctrl+P continua
   * valendo la: abrir outra pagina no meio da escrita e pedido legitimo.
   *
   * A lista destes atalhos vive em Configuracoes — atalho que so existe no
   * codigo e atalho que ninguem usa.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      const alvo = e.target as HTMLElement | null;
      const escrevendo =
        !!alvo &&
        (alvo.isContentEditable ||
          alvo.tagName === "INPUT" ||
          alvo.tagName === "TEXTAREA");

      const k = e.key.toLowerCase();

      // Os que abrem coisa valem mesmo escrevendo: abrir outra pagina no meio
      // da escrita e pedido legitimo. Os que FECHAM ou trocam de contexto sem
      // pedir confirmacao, nao — perder texto por atalho e imperdoavel.
      if (k === "p") {
        e.preventDefault();
        if (e.shiftKey) abrirFixa(ABA_COMANDOS);
        else setAbrindoRapido(true);
      } else if (k === "k") {
        e.preventDefault();
        setPainel("busca");
        // O foco tem que ir para o campo, senao o atalho so pinta a lateral.
        setTimeout(() => document.querySelector<HTMLInputElement>(".busca-campo")?.focus(), 0);
      } else if (k === "n" && !e.shiftKey && !escrevendo) {
        e.preventDefault();
        abrirFixa({ id: "nova-nota", tipo: "nova-nota" });
      } else if (k === "i" && e.shiftKey) {
        e.preventDefault();
        // Abre os Comandos, NAO dispara o ingest. Ingest gasta credito e
        // reescreve pagina; nada disso pode sair de um toque de tecla.
        abrirFixa(ABA_COMANDOS);
      } else if (k === "w" && !escrevendo) {
        e.preventDefault();
        fechar(ativa);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    localStorage.setItem("athena-menu-w", String(larguraMenu));
  }, [larguraMenu]);

  // Lista achatada dos dois escopos — e o que a busca varre.
  useEffect(() => {
    if (!vaultPath) return;
    Promise.all([api.fs.tree("Notes"), api.fs.tree("Resumos")])
      .then(([r, w]) => setTodos([...achatar(r), ...achatar(w)]))
      .catch(() => setTodos([]));
  }, [vaultPath, refreshKey]);

  // O vault vem DEPOIS da conta: cada conta tem a sua pasta (electron/main.ts,
  // abrirVaultDaConta). Sem conta, nao ha vault para abrir.
  useEffect(() => {
    if (!uidConta) {
      setVaultPath(null);
      return;
    }
    api.vault.get().then((v) => setVaultPath(v.path));
  }, [uidConta]);

  useEffect(() => api.vault.onChange(refresh), [refresh]);

  // Busca no conteudo com espera: cada tecla varreria o vault inteiro.
  useEffect(() => {
    const q = busca.trim();
    if (q.length < 2) {
      setNoConteudo([]);
      return;
    }
    const timer = setTimeout(() => {
      api.fs.buscar(q).then(setNoConteudo).catch(() => setNoConteudo([]));
    }, 220);
    return () => clearTimeout(timer);
  }, [busca]);

  // A sessao do Supabase e a porta: sem ela, o app nem monta. Roda uma vez, na
  // montagem — e ela que decide qual vault sera aberto.
  useEffect(() => {
    let vivo = true;
    api.account
      .status()
      .then((c) => vivo && setConta(c ?? false))
      .catch(() => vivo && setConta(false));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!vaultPath) return;
    // A árvore não é só disco: ela espera a listagem da nuvem desta conta (ver
    // electron/espelho.ts), o que custa uma ida à rede. Sem marcar essa espera,
    // um vault novo mostra "Nada aqui ainda" por um segundo — e essa frase é
    // uma afirmação, não um "carregando". Foi exatamente o que assustou.
    let vivo = true;
    setCarregandoArvore(true);
    api.fs
      .tree(scope)
      .then((t) => vivo && setTree(t))
      .catch(() => vivo && setTree([]))
      .finally(() => vivo && setCarregandoArvore(false));
    api.fs.subjects().then(setSubjects).catch(() => setSubjects([]));
    return () => {
      vivo = false;
    };
  }, [vaultPath, scope, refreshKey]);

  useEffect(() => {
    if (!selected) return setTarget(null);
    const sel = parseSelection(selected);
    if (!sel) return setTarget(null);
    api.fs.describe(sel.code, sel.lesson).then(setTarget).catch(() => setTarget(null));
  }, [selected, refreshKey]);

  const aba = abas.find((a) => a.id === ativa);
  const relAtiva = aba?.tipo === "arquivo" ? aba.rel : null;

  // Texto da aba ativa quando ela e leitura (Resumos/). A edicao le por conta.
  useEffect(() => {
    if (!relAtiva || !TEXTO.test(relAtiva)) return;
    api.fs.read(relAtiva).then(setFileText).catch(() => setFileText(""));
  }, [relAtiva, refreshKey]);

  function abrir(rel: string) {
    setAbas((atuais) =>
      atuais.some((a) => a.id === rel) ? atuais : [...atuais, { id: rel, tipo: "arquivo", rel }],
    );
    setAtiva(rel);
  }

  function abrirFixa(nova: Aba) {
    setAbas((atuais) => (atuais.some((a) => a.id === nova.id) ? atuais : [...atuais, nova]));
    setAtiva(nova.id);
  }

  /**
   * Abre Configuracoes — opcionalmente numa secao especifica.
   *
   * Sem a secao, a aba reabre onde a pessoa parou, que e o certo para a
   * engrenagem. Com ela, quem clicou pediu um assunto ("ver todos os
   * atalhos") e tem que cair nele: a aba fica montada, entao mandar so
   * `abrirFixa` mostrava a ultima secao aberta.
   */
  function abrirConfig(secao?: SecaoConfig) {
    if (secao) setSecaoConfig((antes) => ({ aba: secao, n: (antes?.n ?? 0) + 1 }));
    abrirFixa(ABA_CONFIG);
  }

  function fechar(id: string) {
    // A home e o chao da casa — mas so na janela principal. Numa janela
    // destacada nao existe home, e a ultima aba fechada fecha a janela.
    if (id === "home" && !destacada) return;
    setAbas((atuais) => {
      const i = atuais.findIndex((a) => a.id === id);
      if (i === -1) return atuais;
      const restantes = atuais.filter((a) => a.id !== id);
      if (restantes.length === 0) {
        if (destacada) void api.win.close();
        return destacada ? atuais : [ABA_HOME];
      }
      // Fechou a que estava aberta: vai para a vizinha da direita, senao a da
      // esquerda — o mesmo que qualquer editor faz.
      if (ativa === id) setAtiva((restantes[i] ?? restantes[i - 1] ?? restantes[0]).id);
      return restantes;
    });
  }

  /**
   * Arranca a aba para uma janela nova.
   *
   * A aba viaja inteira (id, tipo, caminho) porque a janela nova monta a
   * partir dela. Sair daqui e um passo separado do abrir la: se a criacao da
   * janela falhar, a aba continua onde estava em vez de sumir.
   */
  async function destacar(a: Aba, x: number, y: number) {
    if (abas.length <= 1) return; // arrancar a unica aba so moveria a janela
    const ok = await api.win.destacar(a, x, y).catch(() => false);
    if (!ok) return;
    setAbas((atuais) => {
      const restantes = atuais.filter((x2) => x2.id !== a.id);
      if (ativa === a.id) setAtiva((restantes[0] ?? ABA_HOME).id);
      return restantes.length ? restantes : [ABA_HOME];
    });
  }

  /**
   * Regera a pagina de um caminho. Confirma antes: `redo` reescreve o arquivo
   * inteiro, e um clique sem aviso num botao ao lado da estrela seria caro.
   */
  async function regerar(rel: string) {
    const alvo = parseSelection(rel);
    if (!alvo?.lesson) return;
    const ok = await confirmar({
      titulo: tf("Regerar {lesson}?", { lesson: alvo.lesson }),
      mensagem: tf(
        "Roda {cmd}: a página é reescrita do ZERO a partir do material oficial, sem reaproveitar a versão atual.",
        { cmd: `athena redo ${alvo.code} ${alvo.lesson}` },
      ),
      detalhe: rel,
      nota: t(
        "Sua nota em Notes/ e o material oficial não são tocados. A versão atual da página se perde — se ela tem edição sua à mão, copie antes.",
      ),
      confirmar: t("Regerar"),
    });
    if (!ok) return;
    await api.session.start("redo", alvo.code, alvo.lesson);
  }

  /** Solta a aba arrastada na posicao de destino. */
  function reordenar(de: number, para: number) {
    if (de === para) return;
    setAbas((atuais) => {
      const copia = [...atuais];
      const [movida] = copia.splice(de, 1);
      copia.splice(para, 0, movida);
      return copia;
    });
  }

  async function pick() {
    setError(null);
    try {
      const r = await api.vault.pick();
      setVaultPath(r.path);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Arrasta a divisoria; duplo clique volta ao padrao. */
  function arrastarMenu(e: React.MouseEvent) {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = larguraMenu;
    const mover = (ev: MouseEvent) =>
      setLarguraMenu(Math.min(MENU_MAX, Math.max(MENU_MIN, w0 + (ev.clientX - x0))));
    const soltar = () => {
      window.removeEventListener("mousemove", mover);
      window.removeEventListener("mouseup", soltar);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    // Sem isto, arrastar seleciona o texto da arvore inteira.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", mover);
    window.addEventListener("mouseup", soltar);
  }

  if (conta === null) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <p style={{ color: "var(--c-muted)" }}>{t("verificando a conta…")}</p>
      </div>
    );
  }

  if (conta === false) {
    return <Login onEntrou={setConta} />;
  }

  if (!vaultPath) {
    return (
      <PrimeiroUso
        onEscolherVaultExistente={pick}
        onVaultPronto={(pasta) => {
          setError(null);
          setVaultPath(pasta);
          refresh();
        }}
        erro={error}
      />
    );
  }

  // Passou pelos tres portoes acima (vault escolhido, conta verificada, conta
  // presente): daqui pra baixo a conta existe.
  const contaAtual = conta as Account;

  /** Conteudo de uma aba de arquivo: edita, le ou visualiza. */
  function Arquivo({ rel }: { rel: string }) {
    if (MATERIAL.test(rel)) return <MaterialView rel={rel} />;
    if (IMAGEM.test(rel)) return <ImageView rel={rel} />;

    if (TEXTO.test(rel) && EDITAVEL(rel)) {
      return (
        <FileEditor
          rel={rel}
          onSaved={refresh}
          onIngest={async (code, lesson) => {
            await api.session.start("ingest", code, lesson);
            setAtiva("comandos");
          }}
        />
      );
    }

    if (TEXTO.test(rel)) {
      return <Leitura rel={rel} texto={fileText} onAbrir={abrir} onRegerar={regerar} />;
    }

    return (
      <div className="card" style={{ padding: 24 }}>
        <p style={{ color: "var(--c-muted)", margin: 0 }}>
          {t("Não sei abrir")} <code>{rel}</code>{" "}
          {t("aqui. Use o botão direito na árvore para abrir no programa padrão.")}
        </p>
      </div>
    );
  }

  /**
   * Os botoes do rail viram DADO para poderem ser reordenados: a ordem e uma
   * lista de ids no localStorage, e o arrasto so mexe nessa lista. Ids que
   * sumirem de uma versao para outra sao ignorados, e ids novos entram no fim —
   * assim uma ordem antiga salva nunca esconde um icone recem-criado.
   */
  /**
   * Miolo da lateral: o alternador Notes/Resumos mais a arvore, ou a busca.
   *
   * O cabecalho (marca, conta, vault) saiu daqui para o `Sidebar`: ele e o
   * mesmo em toda tela, e a lateral so cuida do que muda.
   */
  const explorerLateral = (
    <>
      {painel === "arquivos" ? (
        <>
          <div style={{ padding: "6px 12px 4px", display: "flex", gap: 6 }}>
            <button
              className="btn"
              style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
              data-active={scope === "Notes"}
              onClick={() => setScope("Notes")}
            >
              Notes
            </button>
            <button
              className="btn"
              style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
              data-active={scope === "Resumos"}
              onClick={() => setScope("Resumos")}
            >
              Resumos
            </button>
          </div>

          <p className="label" style={{ padding: "6px 12px 2px" }}>
            {t("Explorer")} {scope === "Resumos" && t("· somente leitura")}
          </p>
          <div className="scroll" style={{ flex: 1, padding: "0 8px 12px", minHeight: 0 }}>
            <Explorer
              nodes={tree}
              carregando={carregandoArvore}
              selected={selected}
              onSelect={setSelected}
              onChanged={refresh}
              scope={scope}
              readOnly={scope === "Resumos"}
              onOpen={abrir}
              onExcluir={async (code, lesson) => {
                await api.session.start("delete", code, lesson);
                setAtiva("comandos");
              }}
            />
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: "6px 12px" }}>
            <input
              className="field busca-campo"
              autoFocus
              placeholder={t("Nome do arquivo…")}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setBusca("")}
            />
          </div>
          <div className="scroll" style={{ flex: 1, padding: "0 8px 12px", minHeight: 0 }}>
            {(() => {
              const q = busca.trim().toLowerCase();
              const achados = q
                ? todos.filter((f) => (f.nome + f.rel).toLowerCase().includes(q)).slice(0, 60)
                : [];
              if (!q)
                return (
                  <p style={{ color: "var(--c-muted)", padding: "8px 10px", fontSize: 12 }}>
                    {t("Digite para procurar em Notes/ e Resumos/.")}
                  </p>
                );
              if (achados.length === 0 && noConteudo.length === 0)
                return (
                  <p style={{ color: "var(--c-muted)", padding: "8px 10px", fontSize: 12 }}>
                    {tf("Nada com “{q}”.", { q: busca })}
                  </p>
                );
              return achados.map((f) => (
                <button
                  key={f.rel}
                  className="nav-item"
                  data-active={selected === f.rel}
                  onClick={() => {
                    setSelected(f.rel);
                    abrir(f.rel);
                  }}
                  title={f.rel}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {f.nome}
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: "var(--c-muted)",
                      flex: "0 0 auto",
                    }}
                  >
                    {f.rel.split("/")[0]}
                  </span>
                </button>
              ));
            })()}

            {/* Dentro dos arquivos. Separado do nome de proposito: sao duas
                perguntas diferentes — "como se chamava?" e "onde eu falei
                disso?" — e misturar as duas listas esconde a segunda. */}
            {noConteudo.length > 0 && (
              <>
                <p className="label" style={{ padding: "12px 10px 4px" }}>
                  {tf("No conteúdo · {n}", { n: noConteudo.length })}
                </p>
                {noConteudo.map((r) => (
                  <button
                    key={`${r.rel}:${r.linha}`}
                    className="nav-item busca-conteudo"
                    onClick={() => {
                      setSelected(r.rel);
                      abrir(r.rel);
                    }}
                    title={`${r.rel}:${r.linha}`}
                  >
                    <span className="truncar" style={{ fontSize: 12 }}>
                      {(r.rel.split("/").pop() ?? r.rel).replace(/\.md$/, "")}
                    </span>
                    <span className="busca-trecho">{r.trecho}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </>
  );

  const divisoria = (
    <div
      className="splitter"
      onMouseDown={arrastarMenu}
      onDoubleClick={() => setLarguraMenu(MENU_PADRAO)}
      title={t("Arraste para redimensionar · duplo clique volta ao padrão")}
      role="separator"
      aria-orientation="vertical"
    />
  );

  /**
   * Faixa de abas + area de conteudo.
   *
   * Sao dois irmaos soltos, e nao um <main> em volta, porque cada um ocupa uma
   * celula diferente da grade: a faixa atravessa conteudo E Task Center, o
   * conteudo fica so na coluna do meio.
   */
  const principal = (
    <>
      <div className="topo">
        <div className="tabs">
        {abas.map((a, i) => (
          <div
            key={a.id}
            className="tab"
            data-active={a.id === ativa}
            data-arrastando={arrastando === i}
            draggable
            onClick={() => setAtiva(a.id)}
            onAuxClick={(e) => e.button === 1 && fechar(a.id)}
            onDragStart={(e) => {
              setArrastando(i);
              e.dataTransfer.effectAllowed = "move";
              // Firefox/Chromium so iniciam o arrasto com algum dado setado.
              e.dataTransfer.setData("text/plain", a.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (arrastando !== null) reordenar(arrastando, i);
              setArrastando(null);
            }}
            /**
             * Soltou longe da barra: vira janela.
             *
             * O limite e a altura da propria faixa mais uma folga — dentro
             * dela o arrasto e reordenacao, e reordenar nao pode virar janela
             * nova por 5px de tremor na mao. Sem coordenada (o navegador zera
             * o ponto em alguns cancelamentos) nao arranca nada.
             */
            onDragEnd={(e) => {
              setArrastando(null);
              const faixa = (e.currentTarget as HTMLElement).closest(".topo");
              if (!faixa || (e.clientX === 0 && e.clientY === 0)) return;
              const r = faixa.getBoundingClientRect();
              const fora =
                e.clientY > r.bottom + 40 ||
                e.clientY < r.top - 40 ||
                e.clientX < r.left - 40 ||
                e.clientX > r.right + 40;
              if (fora) void destacar(a, e.screenX, e.screenY);
            }}
            title={a.tipo === "arquivo" ? a.rel : undefined}
          >
            <span className="tab-nome">
              {a.tipo === "arquivo" ? (a.rel.split("/").pop() ?? a.rel) : ROTULO[a.tipo]}
            </span>
            {a.id !== "home" && (
              <button
                className="tab-x"
                title={t("Fechar")}
                onClick={(e) => {
                  e.stopPropagation();
                  fechar(a.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          className="tab-add"
          title={t("Nova nota")}
          onClick={() => abrirFixa({ id: "nova-nota", tipo: "nova-nota" })}
        >
          +
        </button>

        </div>

        {/* Sempre montado e sempre visível, na ponta direita da faixa: o
            transcript vive aqui, e é o único aviso de que o Claude parou para
            perguntar. Some da faixa em nenhuma tela — nem na leitura. */}
        <div className="topo-direita">
          <span className="pilula-online" data-off={contaAtual.offline}>
            <span className="pilula-ponto" />
            {contaAtual.offline ? t("Athena offline") : t("Athena online")}
          </span>
          <SessionPanel onStateChange={setBusy} abrir={abrirMonitor} />
          <ControlesJanela />
        </div>
      </div>

      <div className="conteudo scroll">
        {contaAtual.offline && (
          <div className="card alerta-conta" style={{ boxShadow: "inset 3px 0 0 var(--c-muted)" }}>
            <strong>{t("Sem conexão — publicar e puxar estão bloqueados.")}</strong>
            <p style={{ marginBottom: 0 }}>{t("O resto funciona: seus arquivos são os deste computador.")}</p>
          </div>
        )}

        {contaAtual.contaAnterior && (
          <div className="card alerta-conta">
            <strong>{tf("Este vault era da conta {conta}.", { conta: contaAtual.contaAnterior })}</strong>
            <p>
              {t("Publicar agora manda o conteúdo desta pasta para")} <code>{contaAtual.email}</code>.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={async () => {
                  await api.account.assumirVault(contaAtual.email);
                  setConta({ ...contaAtual, contaAnterior: undefined });
                }}
              >
                {t("Entendi, estes arquivos são desta conta")}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  await api.account.logout();
                  setConta(false);
                }}
              >
                {tf("Sair e entrar com {conta}", { conta: contaAtual.contaAnterior })}
              </button>
            </div>
          </div>
        )}

        {/*
          TODA aba aberta fica MONTADA; a inativa some por CSS.

          Antes o conteudo era `aba?.tipo === "x" && <X/>`, ou seja, so a aba
          ativa existia — e trocar de aba DESMONTAVA o componente. Numa nota
          nova ainda nao salva isso apagava o que estava escrito. Nenhuma troca
          de aba pode custar texto: o preco de manter tudo montado (memoria de
          alguns componentes) e pequeno perto de perder trabalho.

          A `key` e o id da aba, entao a identidade sobrevive a reordenacao da
          barra: arrastar aba nao remonta nada.
        */}
        {abas.map((a) => (
          <div
            key={a.id}
            className="painel-aba"
            data-ativa={a.id === ativa}
            // `hidden` do HTML nao basta: varios paineis daqui sao flex, e o
            // `display:flex` das classes deles ganharia do `display:none` que
            // o `hidden` aplica.
            style={a.id === ativa ? undefined : { display: "none" }}
          >
            {a.tipo === "home" && (
              <Home
                key={refreshKey}
                onAbrir={abrir}
                onNovaNota={() => abrirFixa({ id: "nova-nota", tipo: "nova-nota" })}
                onComandos={() => abrirFixa(ABA_COMANDOS)}
                onIngest={() => abrirFixa(ABA_COMANDOS)}
                onBuscar={() => setPainel("busca")}
              />
            )}

            {a.tipo === "comandos" && (
              <>
                <CommandBar target={target} busy={busy} onStarted={refresh} />
                <PublishPanel refreshKey={refreshKey} />
              </>
            )}

            {a.tipo === "nova-nota" && (
              <NoteEditor
                subjects={subjects}
                onSaved={refresh}
                onIngest={async (code, lesson) => {
                  await api.session.start("ingest", code, lesson);
                  setAtiva("comandos");
                }}
              />
            )}

            {a.tipo === "config" && (
              <Settings
                vaultPath={vaultPath}
                secao={secaoConfig}
                onTrocouVault={() => window.location.reload()}
              />
            )}

            {a.tipo === "perfil" && (
              <Profile conta={contaAtual} onSaiu={() => setConta(false)} onConta={setConta} />
            )}

            {a.tipo === "glossario" && <Glossario onAbrir={abrir} />}
            {a.tipo === "conteudo" && <MeuConteudo onAbrir={abrir} />}
            {a.tipo === "arquivo" && <Arquivo rel={a.rel} />}
          </div>
        ))}
      </div>
    </>
  );

  /**
   * O shell das imagens de referencia: lateral inteira a esquerda, faixa de
   * abas em cima do conteudo, Task Center a direita.
   *
   * E uma grade de 2x3 em vez de tres colunas empilhadas porque a lateral
   * sobe ate o topo da janela — a faixa de abas comeca DEPOIS dela. Com
   * flexbox isso exigiria duplicar a altura da faixa dos dois lados.
   */
  const destinoAtivo: Destino | null =
    painel === "busca" ? "busca"
    : aba?.tipo === "home" ? "home"
    : aba?.tipo === "glossario" ? "glossario"
    : aba?.tipo === "nova-nota" ? "nova-nota"
    : aba?.tipo === "comandos" ? "comandos"
    : aba?.tipo === "config" ? "config"
    : aba?.tipo === "perfil" ? "perfil"
    : aba?.tipo === "conteudo" ? "conteudo"
    : null;

  function ir(d: Destino) {
    if (d === "busca") {
      setPainel("busca");
      return;
    }
    setPainel("arquivos");
    if (d === "home") abrirFixa(ABA_HOME);
    else if (d === "conteudo") abrirFixa(ABA_CONTEUDO);
    else if (d === "glossario") abrirFixa(ABA_GLOSSARIO);
    else if (d === "nova-nota") abrirFixa({ id: "nova-nota", tipo: "nova-nota" });
    else if (d === "comandos") abrirFixa(ABA_COMANDOS);
    else if (d === "config") abrirFixa(ABA_CONFIG);
    else if (d === "perfil") abrirFixa(ABA_PERFIL);
  }

  return (
    <div
      className="shell"
      style={{ gridTemplateColumns: `${larguraMenu}px 5px 1fr ${larguraTask}px` }}
    >
      {dialogo}
      {abrindoRapido && (
        <SeletorPagina
          titulo={t("Abrir página")}
          aviso=""
          onFechar={() => setAbrindoRapido(false)}
          onEscolher={(a) => {
            setAbrindoRapido(false);
            abrir(a.rel);
          }}
        />
      )}

      <Sidebar
        conta={contaAtual}
        ativo={destinoAtivo}
        onIr={ir}
        explorer={explorerLateral}
        vaultPath={vaultPath}
      />
      {divisoria}
      {principal}
      <TaskCenter
        versao={versao}
        onAbrirMonitor={() => setAbrirMonitor((n) => n + 1)}
        onVerAtalhos={() => abrirConfig("atalhos")}
        onTema={alternarTema}
        onPerfil={() => abrirFixa(ABA_PERFIL)}
        onConfig={() => abrirConfig()}
      />
    </div>
  );
}

/** Achata a arvore em lista de arquivos — a busca nao navega, ela filtra. */
function achatar(nodes: TreeNode[]): { nome: string; rel: string }[] {
  const saida: { nome: string; rel: string }[] = [];
  const andar = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.dir) andar(n.children ?? []);
      else saida.push({ nome: n.name, rel: n.rel });
    }
  };
  andar(nodes);
  return saida;
}
