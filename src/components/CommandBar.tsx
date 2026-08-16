import { useState } from "react";
import { api, type Cmd, type Target } from "../lib/api";
import { SeletorPagina } from "./SeletorPagina";
import { t, tf } from "../lib/i18n";

type Props = {
  target: Target | null;
  busy: boolean;
  onStarted: () => void;
};

export function CommandBar({ target, busy, onStarted }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState("");
  /**
   * Regerar age sobre uma pagina ESCOLHIDA, nao sobre a selecao da arvore.
   * Antes usava o alvo selecionado — que e a ultima coisa em que voce clicou,
   * quase nunca a que quer refazer.
   */
  const [escolhendo, setEscolhendo] = useState(false);

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
        {escolhendo && (
          <SeletorPagina
            titulo={t("Regerar qual página?")}
            aviso={t(
              "A página é reescrita do zero a partir do material oficial. Sua nota em raw/ não é tocada.",
            )}
            onFechar={() => setEscolhendo(false)}
            onEscolher={async (a) => {
              setEscolhendo(false);
              await api.session.start("redo", a.code, a.lesson);
              onStarted();
            }}
          />
        )}
        <p style={{ margin: "0 0 12px", color: "var(--c-muted)" }}>
          {t("Selecione uma aula ou uma matéria na árvore para habilitar os comandos.")}
        </p>
        {/* Regerar nao depende da arvore: ele tem seletor proprio. */}
        <button className="btn" disabled={busy} onClick={() => setEscolhendo(true)}>
          {t("Regerar do zero…")}
        </button>
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
      {escolhendo && (
        <SeletorPagina
          titulo={t("Regerar qual página?")}
          aviso={t(
            "A página é reescrita do zero a partir do material oficial. Sua nota em raw/ não é tocada.",
          )}
          onFechar={() => setEscolhendo(false)}
          onEscolher={async (a) => {
            setEscolhendo(false);
            await api.session.start("redo", a.code, a.lesson);
            onStarted();
          }}
        />
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
        <span className="label">{t("Alvo")}</span>
        <code style={{ color: "var(--c-accent)" }}>
          {target.code}
          {target.lesson ? ` / ${target.lesson}` : ` ${t("— matéria inteira")}`}
        </code>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button
          className="btn btn-primary"
          disabled={busy || !hasSource || isSubjectScope}
          onClick={() => run("ingest")}
          title={
            isSubjectScope
              ? t("Selecione uma aula")
              : hasSource
                ? t("Gera a página a partir do material oficial")
                : t("Não há nota nem material oficial para esta aula")
          }
        >
          {t("Gerar página")}
        </button>

        <button
          className="btn"
          disabled={busy}
          onClick={() => setEscolhendo(true)}
          title={t("Escolha qual página reescrever do zero")}
        >
          {t("Regerar do zero…")}
        </button>

        <button
          className="btn"
          disabled={busy || !hasPage}
          onClick={() => run("review")}
          title={hasPage ? t("Questões de fixação") : t("Review precisa de uma aula existente")}
        >
          {t("Questões")}
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
          {t("Remover")}
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
              ? tf("Remover a matéria {code} inteira", { code: target.code })
              : tf("Remover a aula {lesson}", { lesson: target.lesson ?? "" })}
          </p>
          <p style={{ margin: "0 0 10px", color: "var(--c-muted)", fontSize: 12 }}>
            {t("Suas notas em raw/ e os PDFs originais ficam intactos. Some o que foi gerado:")}
          </p>
          <pre className="term" style={{ marginBottom: 12 }}>
            {isSubjectScope
              ? `wiki/subjects/${target.code}-*/\nathena-web/wiki/subjects/${target.code}-*/\nathena-web/public/materials/${target.code}-*/\n` +
                tf("linha da matéria em {file}", { file: "index.md" })
              : deleteTargets.join("\n") +
                (target.moc
                  ? `\n` + tf("linha [[{lesson}]] em {moc}", { lesson: target.lesson ?? "", moc: target.moc })
                  : "")}
          </pre>

          {isSubjectScope && (
            <input
              className="field"
              placeholder={tf("Digite {code} para confirmar", { code: target.code })}
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
              {t("Remover")}
            </button>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              {t("Cancelar")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Facts({ target }: { target: Target }) {
  const semOficial = t("nenhum encontrado");
  const rows: [string, string][] = [
    [t("Nota do aluno"), target.rawNote ?? "—"],
    [
      t("Material oficial"),
      target.official.length ? target.official.map(base).join(", ") : semOficial,
    ],
    [t("Página gerada"), target.wikiPage ?? "—"],
    [t("Review"), target.wikiReview ?? "—"],
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
              color: v === "—" || v === semOficial ? "var(--c-muted)" : "var(--c-text)",
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
