import { useCallback, useEffect, useState } from "react";
import { api, parseSelection, type SubjectRef, type Target, type TreeNode } from "./lib/api";
import { Explorer } from "./components/Explorer";
import { CommandBar } from "./components/CommandBar";
import { SessionPanel } from "./components/SessionPanel";
import { PublishPanel } from "./components/PublishPanel";
import { NoteEditor } from "./components/NoteEditor";
import { ThemeControl } from "./components/ThemeControl";

type Scope = "raw" | "wiki";
type View = "commands" | "new-note" | "read";

export default function App() {
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("raw");
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [view, setView] = useState<View>("commands");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fileText, setFileText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

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

  useEffect(() => {
    if (!selected || selected.endsWith("/") || !/\.(md|txt)$/i.test(selected)) return;
    api.fs.read(selected).then(setFileText).catch(() => setFileText(""));
  }, [selected, refreshKey]);

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

  if (!vaultPath) {
    return (
      <div
        style={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
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

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateColumns: "260px 1fr" }}>
      <aside
        style={{
          borderRight: "1px solid var(--c-border)",
          background: "var(--c-bg)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
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

        <div style={{ padding: "6px 12px" }}>
          <p className="label" style={{ margin: "8px 0 4px" }}>
            Navegação
          </p>
          <button
            className="nav-item"
            data-active={view === "commands"}
            onClick={() => setView("commands")}
          >
            Comandos
          </button>
          <button
            className="nav-item"
            data-active={view === "new-note"}
            onClick={() => setView("new-note")}
          >
            Nova nota
          </button>
          <button
            className="nav-item"
            data-active={view === "read"}
            onClick={() => setView("read")}
          >
            Leitura
          </button>
        </div>

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
            readOnly={scope === "wiki"}
          />
        </div>
      </aside>

      <main
        className="scroll"
        style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}
      >
        {view === "commands" && (
          <CommandBar target={target} busy={busy} onStarted={refresh} />
        )}

        {view === "new-note" && (
          <NoteEditor
            subjects={subjects}
            onSaved={refresh}
            onIngest={async (code, lesson) => {
              await api.session.start("ingest", code, lesson);
              setView("commands");
            }}
          />
        )}

        {view === "read" && (
          <div className="card" style={{ padding: 24 }}>
            {selected && /\.(md|txt)$/i.test(selected) ? (
              <>
                <p className="label" style={{ marginTop: 0 }}>
                  {selected}
                </p>
                <div className="prose-body" style={{ whiteSpace: "pre-wrap" }}>
                  {fileText}
                </div>
              </>
            ) : (
              <p style={{ color: "var(--c-muted)", margin: 0 }}>
                Selecione um arquivo .md na árvore.
              </p>
            )}
          </div>
        )}

        {/* Painel unico e sempre montado: trocar de aba nao pode desmontar a
            sessao — era assim que o log e o campo do AGUARDANDO RESPOSTA
            sumiam justo depois de "Gerar pagina" na aba Nova nota. */}
        <SessionPanel onStateChange={setBusy} />

        {view === "commands" && <PublishPanel refreshKey={refreshKey} />}
      </main>
    </div>
  );
}
