import { useState } from "react";
import { api, type Cmd, type Target } from "../lib/api";

type Props = {
  target: Target | null;
  busy: boolean;
  onStarted: () => void;
};

export function CommandBar({ target, busy, onStarted }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");

  const hasSource = !!target && (!!target.rawNote || target.official.length > 0);
  const hasPage = !!target?.wikiPage;
  const isSubjectScope = !!target && target.lesson === null;

  async function run(cmd: Cmd) {
    if (!target) return;
    await api.session.start(cmd, target.code, target.lesson);
    onStarted();
  }

  if (!target) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <p style={{ margin: 0, color: "var(--c-muted)" }}>
          Selecione uma aula ou uma matéria na árvore para habilitar os comandos.
        </p>
      </div>
    );
  }

  const deleteTargets = [
    target.wikiPage,
    target.mirror,
    target.wikiReview,
    target.mirrorReview,
    target.material,
  ].filter(Boolean) as string[];

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span className="label">Alvo</span>
        <code style={{ color: "var(--c-accent)" }}>
          {target.code}
          {target.lesson ? ` / ${target.lesson}` : " — matéria inteira"}
        </code>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          className="btn btn-primary"
          disabled={busy || !hasSource || isSubjectScope}
          onClick={() => run("ingest")}
          title={
            isSubjectScope
              ? "Selecione uma aula"
              : hasSource
                ? "Gera a página a partir do material oficial"
                : "Não há nota nem material oficial para esta aula"
          }
        >
          Gerar página
        </button>

        <button
          className="btn"
          disabled={busy || !hasPage}
          onClick={() => run("redo")}
          title={
            hasPage
              ? "Reescreve do zero — use quando quiser mudar a estrutura"
              : "Ainda não existe página para regerar"
          }
        >
          Regerar do zero
        </button>

        <button
          className="btn"
          disabled={busy || !hasPage}
          onClick={() => run("review")}
          title={hasPage ? "Questões de fixação" : "Review precisa de uma aula existente"}
        >
          Questões
        </button>

        <button
          className="btn btn-danger"
          disabled={busy || (!hasPage && !isSubjectScope)}
          onClick={() => {
            setTyped("");
            setConfirmDelete(true);
          }}
          style={{ marginLeft: "auto" }}
        >
          Remover
        </button>
      </div>

      <Facts target={target} />

      {confirmDelete && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            border: "1px solid #e24b4a",
            borderRadius: "var(--r-xl)",
            background: "var(--c-surface)",
          }}
        >
          <p style={{ margin: "0 0 8px", fontWeight: 500 }}>
            {isSubjectScope
              ? `Remover a matéria ${target.code} inteira`
              : `Remover a aula ${target.lesson}`}
          </p>
          <p style={{ margin: "0 0 10px", color: "var(--c-muted)", fontSize: 12 }}>
            Suas notas em raw/ e os PDFs originais ficam intactos. Some o que foi gerado:
          </p>
          <pre className="term" style={{ marginBottom: 12 }}>
            {isSubjectScope
              ? `wiki/subjects/${target.code}-*/\nathena-web/wiki/subjects/${target.code}-*/\nathena-web/public/materials/${target.code}-*/\nlinha da matéria em index.md`
              : deleteTargets.join("\n") +
                (target.moc ? `\nlinha [[${target.lesson}]] em ${target.moc}` : "")}
          </pre>

          {isSubjectScope && (
            <input
              className="field"
              placeholder={`Digite ${target.code} para confirmar`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              style={{ marginBottom: 10 }}
            />
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-danger"
              disabled={isSubjectScope && typed.trim().toUpperCase() !== target.code.toUpperCase()}
              onClick={() => {
                setConfirmDelete(false);
                run("delete");
              }}
            >
              Remover
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Facts({ target }: { target: Target }) {
  const rows: [string, string][] = [
    ["Nota do aluno", target.rawNote ?? "—"],
    [
      "Material oficial",
      target.official.length ? target.official.map(base).join(", ") : "nenhum encontrado",
    ],
    ["Página gerada", target.wikiPage ?? "—"],
    ["Review", target.wikiReview ?? "—"],
  ];
  return (
    <dl
      style={{
        margin: "14px 0 0",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: "4px 14px",
        fontSize: 12,
      }}
    >
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt className="label" style={{ paddingTop: 2 }}>
            {k}
          </dt>
          <dd
            style={{
              margin: 0,
              color: v === "—" || v.startsWith("nenhum") ? "var(--c-muted)" : "var(--c-text)",
              overflowWrap: "anywhere",
            }}
          >
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function base(p: string) {
  return p.split("/").pop() ?? p;
}
