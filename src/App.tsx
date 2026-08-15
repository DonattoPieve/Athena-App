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
import { MaterialView } from "./components/MaterialView";
import { ThemeControl } from "./components/ThemeControl";
import {
  IconArquivos,
  IconBusca,
  IconComandos,
  IconLado,
  IconPublicar,
} from "./components/icons";

type Scope = "raw" | "wiki";

const MATERIAL = /\.(pdf|pptx?|docx?)$/i;
const TEXTO = /\.(md|txt)$/i;
/** Editavel = raw/ inteiro menos raw/INATEL — espelha o vault.ts. */
const EDITAVEL = (rel: string) => rel.startsWith("raw/") && !rel.startsWith("raw/INATEL/");

/**
 * ABAS
 * ----
 * Tudo que se abre e uma aba, como num editor de codigo. "Home" e fixa (nao
 * fecha); as outras nascem do clique na arvore e morrem no X.
 *
 * Antes existia um item "Arquivo" na navegacao mostrando o selecionado: so
 * cabia um por vez, e clicar na arvore trocava o que voce estava lendo.
 */
type Aba =
  | { id: "home"; tipo: "home" }
  | { id: "comandos"; tipo: "comandos" }
  | { id: "nova-nota"; tipo: "nova-nota" }
  | { id: string; tipo: "arquivo"; rel: string };

const ABA_HOME: Aba = { id: "home", tipo: "home" };
const ABA_COMANDOS: Aba = { id: "comandos", tipo: "comandos" };

/** Painel que o rail de icones mostra na lateral. */
type Painel = "arquivos" | "busca";

const MENU_MIN = 190;
const MENU_MAX = 520;
const MENU_PADRAO = 260;

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("raw");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fileText, setFileText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [abas, setAbas] = useState<Aba[]>([ABA_HOME]);
  const [ativa, setAtiva] = useState<string>("home");

  /** Aba sendo arrastada na barra — indice, nao id, porque a ordem e o dado. */
  const [arrastando, setArrastando] = useState<number | null>(null);

  const [painel, setPainel] = useState<Painel>("arquivos");
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState<{ nome: string; rel: string }[]>([]);

  /** Lado da lateral: em monitor grande, muita gente quer do outro lado. */
  const [lado, setLado] = useState<"esq" | "dir">(() =>
    localStorage.getItem("athena-lado") === "dir" ? "dir" : "esq",
  );

  const [larguraMenu, setLarguraMenu] = useState(() => {
    const salvo = Number(localStorage.getItem("athena-menu-w"));
    return salvo >= MENU_MIN && salvo <= MENU_MAX ? salvo : MENU_PADRAO;
  });

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    localStorage.setItem("athena-menu-w", String(larguraMenu));
  }, [larguraMenu]);

  useEffect(() => {
    localStorage.setItem("athena-lado", lado);
  }, [lado]);

  // Lista achatada dos dois escopos — e o que a busca varre.
  useEffect(() => {
    if (!vaultPath) return;
    Promise.all([api.fs.tree("raw"), api.fs.tree("wiki")])
      .then(([r, w]) => setTodos([...achatar(r), ...achatar(w)]))
      .catch(() => setTodos([]));
  }, [vaultPath, refreshKey]);

  useEffect(() => {
    api.vault.get().then((v) => setVaultPath(v.path));
    return api.vault.onChange(refresh);
  }, [refresh]);

  useEffect(() => {
    if (!vaultPath) return;
    api.fs.tree(scope).then(setTree).catch(() => setTree([]));
    api.fs.subjects().then(setSubjects).catch(() => setSubjects([]));
  }, [vaultPath, scope, refreshKey]);

  useEffect(() => {
    if (!selected) return setTarget(null);
    const sel = parseSelection(selected);
    if (!sel) return setTarget(null);
    api.fs.describe(sel.code, sel.lesson).then(setTarget).catch(() => setTarget(null));
  }, [selected, refreshKey]);

  const aba = abas.find((a) => a.id === ativa);
  const relAtiva = aba?.tipo === "arquivo" ? aba.rel : null;

  // Texto da aba ativa quando ela e leitura (wiki). A edicao le por conta.
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

  function fechar(id: string) {
    if (id === "home") return; // a home e o chao da casa
    setAbas((atuais) => {
      const i = atuais.findIndex((a) => a.id === id);
      if (i === -1) return atuais;
      const restantes = atuais.filter((a) => a.id !== id);
      // Fechou a que estava aberta: vai para a vizinha da direita, senao a da
      // esquerda — o mesmo que qualquer editor faz.
      if (ativa === id) setAtiva((restantes[i] ?? restantes[i - 1] ?? ABA_HOME).id);
      return restantes.length ? restantes : [ABA_HOME];
    });
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
    // Na direita o eixo inverte: puxar para a esquerda alarga o painel.
    const sinal = lado === "esq" ? 1 : -1;
    const mover = (ev: MouseEvent) =>
      setLarguraMenu(Math.min(MENU_MAX, Math.max(MENU_MIN, w0 + sinal * (ev.clientX - x0))));
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

  if (!vaultPath) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="card" style={{ padding: 28, maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: "1.7rem", fontWeight: 600, margin: "0 0 8px" }}>Athena</h1>
          <p style={{ color: "var(--c-muted)", margin: "0 0 20px" }}>
            Aponte para a pasta do vault — a mesma que tem <code>CLAUDE.md</code> e{" "}
            <code>raw/</code>.
          </p>
          <button className="btn btn-primary" onClick={pick}>
            Escolher pasta
          </button>
          {error && <p style={{ color: "#e24b4a", marginTop: 14, fontSize: 12 }}>{error}</p>}
        </div>
      </div>
    );
  }

  /** Conteudo de uma aba de arquivo: edita, le ou visualiza. */
  function Arquivo({ rel }: { rel: string }) {
    if (MATERIAL.test(rel)) return <MaterialView rel={rel} />;

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
      return (
        <div className="card" style={{ padding: 24 }}>
          <p className="label" style={{ marginTop: 0 }}>
            {rel} · somente leitura
          </p>
          <MarkdownView source={fileText} onAbrir={abrir} />
        </div>
      );
    }

    return (
      <div className="card" style={{ padding: 24 }}>
        <p style={{ color: "var(--c-muted)", margin: 0 }}>
          Não sei abrir <code>{rel}</code> aqui. Use o botão direito na árvore para abrir no
          programa padrão.
        </p>
      </div>
    );
  }

  const railBotoes = (
    <div className="rail">
      <button
        className="rail-btn"
        data-active={painel === "arquivos"}
        title="Arquivos"
        onClick={() => setPainel("arquivos")}
      >
        <IconArquivos />
      </button>
      <button
        className="rail-btn"
        data-active={painel === "busca"}
        title="Buscar arquivo"
        onClick={() => setPainel("busca")}
      >
        <IconBusca />
      </button>
      <button
        className="rail-btn"
        data-active={ativa === "comandos"}
        title="Comandos"
        onClick={() => abrirFixa(ABA_COMANDOS)}
      >
        <IconComandos />
      </button>
      <button
        className="rail-btn"
        title="Publicar (abre em Comandos)"
        onClick={() => abrirFixa(ABA_COMANDOS)}
      >
        <IconPublicar />
      </button>

      <button
        className="rail-btn rail-fim"
        title={lado === "esq" ? "Mover a lateral para a direita" : "Mover a lateral para a esquerda"}
        onClick={() => setLado((l) => (l === "esq" ? "dir" : "esq"))}
      >
        <IconLado direita={lado === "esq"} />
      </button>
    </div>
  );

  const lateral = (
    <aside
      style={{
        background: "var(--c-bg)",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
      }}
    >
      <div style={{ padding: "14px 12px 8px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <strong style={{ fontWeight: 600 }}>Athena</strong>
          <ThemeControl />
        </div>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 11,
            color: "var(--c-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={vaultPath}
        >
          {vaultPath}
        </p>
      </div>

      {painel === "arquivos" ? (
        <>
          <div style={{ padding: "6px 12px 4px", display: "flex", gap: 6 }}>
            <button
              className="btn"
              style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
              data-active={scope === "raw"}
              onClick={() => setScope("raw")}
            >
              raw
            </button>
            <button
              className="btn"
              style={{ flex: 1, padding: "5px 8px", fontSize: 12 }}
              data-active={scope === "wiki"}
              onClick={() => setScope("wiki")}
            >
              wiki
            </button>
          </div>

          <p className="label" style={{ padding: "6px 12px 2px" }}>
            Explorer {scope === "wiki" && "· somente leitura"}
          </p>
          <div className="scroll" style={{ flex: 1, padding: "0 8px 12px", minHeight: 0 }}>
            <Explorer
              nodes={tree}
              selected={selected}
              onSelect={setSelected}
              onChanged={refresh}
              scope={scope}
              readOnly={scope === "wiki"}
              onOpen={abrir}
            />
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: "6px 12px" }}>
            <input
              className="field"
              autoFocus
              placeholder="Nome do arquivo…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setBusca("")}
            />
          </div>
          <div className="scroll" style={{ flex: 1, padding: "0 8px 12px", minHeight: 0 }}>
            {(() => {
              const q = busca.trim().toLowerCase();
              if (!q)
                return (
                  <p style={{ color: "var(--c-muted)", padding: "8px 10px", fontSize: 12 }}>
                    Digite para procurar em raw/ e wiki/.
                  </p>
                );
              const achados = todos
                .filter((f) => (f.nome + f.rel).toLowerCase().includes(q))
                .slice(0, 60);
              if (achados.length === 0)
                return (
                  <p style={{ color: "var(--c-muted)", padding: "8px 10px", fontSize: 12 }}>
                    Nada com “{busca}”.
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
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
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
          </div>
        </>
      )}
    </aside>
  );

  const divisoria = (
    <div
      className="splitter"
      onMouseDown={arrastarMenu}
      onDoubleClick={() => setLarguraMenu(MENU_PADRAO)}
      title="Arraste para redimensionar · duplo clique volta ao padrão"
      role="separator"
      aria-orientation="vertical"
    />
  );

  const principal = (
    <main style={{ display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
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
              // Chromium so inicia o arrasto com algum dado setado.
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
            onDragEnd={() => setArrastando(null)}
            title={a.tipo === "arquivo" ? a.rel : undefined}
          >
            <span className="tab-nome">
              {a.tipo === "home"
                ? "Home"
                : a.tipo === "comandos"
                  ? "Comandos"
                  : a.tipo === "nova-nota"
                    ? "Nova nota"
                    : (a.rel.split("/").pop() ?? a.rel)}
            </span>
            {a.id !== "home" && (
              <button
                className="tab-x"
                title="Fechar"
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
          title="Nova nota"
          onClick={() => abrirFixa({ id: "nova-nota", tipo: "nova-nota" })}
        >
          +
        </button>
      </div>

      <div
        className="scroll"
        style={{
          flex: 1,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          minHeight: 0,
        }}
      >
        {aba?.tipo === "home" && (
          <Home
            key={refreshKey}
            onAbrir={abrir}
            onNovaNota={() => abrirFixa({ id: "nova-nota", tipo: "nova-nota" })}
            onComandos={() => abrirFixa(ABA_COMANDOS)}
          />
        )}

        {aba?.tipo === "comandos" && <CommandBar target={target} busy={busy} onStarted={refresh} />}

        {aba?.tipo === "nova-nota" && (
          <NoteEditor
            subjects={subjects}
            onSaved={refresh}
            onIngest={async (code, lesson) => {
              await api.session.start("ingest", code, lesson);
              setAtiva("comandos");
            }}
          />
        )}

        {aba?.tipo === "arquivo" && <Arquivo rel={aba.rel} />}

        {/* Painel unico e sempre montado: trocar de aba nao pode desmontar a
            sessao — era assim que o log e o campo do AGUARDANDO RESPOSTA
            sumiam justo depois de "Gerar pagina". */}
        <SessionPanel onStateChange={setBusy} />

        {aba?.tipo === "comandos" && <PublishPanel refreshKey={refreshKey} />}
      </div>
    </main>
  );

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns:
          lado === "esq" ? `44px ${larguraMenu}px 5px 1fr` : `1fr 5px ${larguraMenu}px 44px`,
      }}
    >
      {lado === "esq" ? (
        <>
          {railBotoes}
          {lateral}
          {divisoria}
          {principal}
        </>
      ) : (
        <>
          {principal}
          {divisoria}
          {lateral}
          {railBotoes}
        </>
      )}
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
