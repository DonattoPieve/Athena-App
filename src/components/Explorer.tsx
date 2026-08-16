import { useEffect, useRef, useState } from "react";
import { api, mensagemDeErro, parseSelection, type TreeNode } from "../lib/api";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { useConfirm } from "./Confirm";
import { Chevron, FileIcon, FolderIcon } from "./icons";
import { t, tf } from "../lib/i18n";

const EDITAVEIS = /\.(md|txt)$/i;
const MATERIAL = /\.(pdf|pptx?|docx?)$/i;

/** Espelha as guardas do vault.ts — o menu nao oferece o que o main recusaria. */
const GRAVAVEIS = [
  "raw/subjects",
  "raw/concepts",
  "raw/games",
  "raw/studies",
  "raw/attachments",
];
function gravavel(rel: string) {
  return GRAVAVEIS.some((p) => rel === p || rel.startsWith(p + "/"));
}

type Criando = { dir: string; tipo: "pasta" | "nota" } | null;

type Props = {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (rel: string) => void;
  onOpen?: (rel: string) => void;
  onChanged: () => void;
  readOnly?: boolean;
  scope: "raw" | "wiki";
  /** Dispara `athena delete CODIGO AULA` — quem executa e o App. */
  onExcluir?: (code: string, lesson: string | null) => void;
};

export function Explorer({
  nodes,
  selected,
  onSelect,
  onOpen,
  onChanged,
  readOnly,
  scope,
  onExcluir,
}: Props) {
  const menu = useContextMenu();
  const { confirmar, dialogo } = useConfirm();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [criando, setCriando] = useState<Criando>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function guard(fn: () => Promise<unknown>) {
    setErro(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  /** Pasta onde a acao acontece: o proprio no se for pasta, senao o pai. */
  function dirDe(node: TreeNode) {
    return node.dir ? node.rel : node.rel.split("/").slice(0, -1).join("/");
  }

  /**
   * "Excluir do Athena" — so na wiki, e so em pagina de aula.
   *
   * Apagar o .md da wiki na mao deixa a pagina viva no site ate o proximo
   * publish, e deixa o MOC apontando para o vazio. `athena delete` e o caminho
   * que o CLAUDE.md define: tira a pagina, desfaz as ligacoes e registra a
   * remocao no log. Por isso este item nao mexe em arquivo — enfileira o
   * comando.
   */
  function excluirDaWiki(node: TreeNode): MenuItem[] {
    if (scope !== "wiki" || node.dir || !onExcluir) return [];
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
              "A sua nota em raw/ e o material oficial não são tocados — dá para gerar de novo depois. Do site a página só some no próximo publish.",
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
    const podeCriar = gravavel(dir);
    const podeMexer = gravavel(node.rel);

    const abrirMaterial: MenuItem[] = MATERIAL.test(node.name)
      ? [
          { kind: "sep" },
          {
            label: t("Abrir no programa padrão"),
            onClick: () => guard(() => api.fs.openExternal(node.rel)),
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
      { kind: "sep" },
      { label: t("Revelar no Explorer"), onClick: () => void api.fs.reveal(node.rel) },
      ...excluirDaWiki(node),
      {
        label: node.dir ? t("Apagar pasta") : t("Apagar"),
        hint: t("lixeira"),
        danger: true,
        disabled: !podeMexer,
        onClick: async () => {
          const ok = await confirmar({
            titulo: node.dir
              ? tf("Apagar a pasta {nome}?", { nome: node.name })
              : tf("Apagar {nome}?", { nome: node.name }),
            mensagem: node.dir
              ? t("A pasta e tudo que está dentro dela vão para a lixeira do Windows.")
              : t("O arquivo vai para a lixeira do Windows."),
            detalhe: node.rel,
            nota: t(
              "Dá para restaurar pela lixeira. O que já foi publicado só sai do site no próximo publish, que espelha o disco.",
            ),
            confirmar: t("Apagar"),
          });
          if (ok) void guard(() => api.fs.trash(node.rel));
        },
      },
    ];
  }

  /** Menu do fundo da arvore: criar na raiz do escopo. */
  function itensDoFundo(): MenuItem[] {
    const dir = scope === "raw" ? "raw/subjects" : "wiki";
    const podeCriar = gravavel(dir);
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
    <div style={{ minHeight: "100%" }} onContextMenu={(e) => menu.open(e, itensDoFundo())}>
      {nodes.length === 0 && !criando ? (
        <p style={{ color: "var(--c-muted)", padding: "8px 10px", fontSize: 12 }}>
          {t("Nada aqui ainda. Botão direito para criar.")}
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

      {erro && (
        <p style={{ color: "#e24b4a", fontSize: 11, padding: "6px 10px", margin: 0 }}>{erro}</p>
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
}) {
  // Tudo fechado ao abrir o app: a arvore inteira aberta e uma parede de nomes
  // e o caminho ate a aula some no meio. Pasta que recebe arquivo novo continua
  // abrindo sozinha (o efeito logo abaixo).
  const [open, setOpen] = useState(false);
  const criandoAqui = criando?.dir === node.rel;

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

  return (
    <li>
      <button
        className="nav-item"
        data-active={selected === node.rel}
        data-dir={node.dir}
        style={{ paddingLeft: 8 + depth * 14, gap: 6 }}
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
          if (e.key === "F2" && gravavel(node.rel)) {
            e.preventDefault();
            setRenaming(node.rel);
          }
        }}
        title={readOnly ? tf("{rel} — somente leitura", { rel: node.rel }) : node.rel}
      >
        {node.dir ? (
          <>
            <Chevron open={open} />
            <FolderIcon open={open} />
          </>
        ) : (
          <>
            <span style={{ width: 10, flex: "0 0 auto" }} />
            <FileIcon material={!EDITAVEIS.test(node.name)} />
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
              criando={criando}
              setCriando={setCriando}
              guard={guard}
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
