import { useEffect, useState } from "react";
import { api, type GitSummary, type IngestStatus } from "../lib/api";

export function PublishPanel({ refreshKey }: { refreshKey: number }) {
  const [summary, setSummary] = useState<GitSummary | null>(null);
  const [status, setStatus] = useState<IngestStatus>("NONE");
  const [message, setMessage] = useState("notes: atualiza wiki");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.git.summary().catch(() => null), api.status.get()]).then(
      ([s, st]) => {
        if (!alive) return;
        setSummary(s);
        setStatus(st);
      },
    );
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  // O veredito muda fora do ciclo da arvore: o main avisa quando o
  // .ingest-status e reescrito (ou quando um comando termina) e o git tambem
  // mudou junto. Sem isto o painel congela no FAIL do inicio do ingest.
  useEffect(() => {
    return api.status.onChange((s) => {
      setStatus(s);
      api.git.summary().then(setSummary).catch(() => setSummary(null));
    });
  }, []);

  const dirty = (summary?.changes.length ?? 0) > 0 || (summary?.ahead ?? 0) > 0;
  const canPublish = status === "OK" && dirty && !busy;

  async function publish() {
    setBusy(true);
    setResult(null);
    try {
      setResult(await api.git.publish(message));
    } catch (e) {
      setResult(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span className="label">Publicar</span>
        <span
          style={{
            fontSize: 12,
            color:
              status === "OK" ? "#1d9e75" : status === "FAIL" ? "#e24b4a" : "var(--c-muted)",
          }}
        >
          {status === "OK"
            ? "último comando terminou bem"
            : status === "FAIL"
              ? "último comando não concluiu — publicação bloqueada"
              : "nenhum comando executado nesta máquina"}
        </span>
        {summary && (
          <span style={{ marginLeft: "auto", color: "var(--c-muted)", fontSize: 12 }}>
            {summary.branch} · {summary.changes.length} alterações
          </span>
        )}
      </div>

      {summary && summary.changes.length > 0 && (
        <pre className="term scroll" style={{ maxHeight: 160, marginBottom: 12 }}>
          {summary.changes.map((c) => `${c.status.padEnd(2)} ${c.file}`).join("\n")}
        </pre>
      )}

      {summary && summary.changes.length === 0 && (
        <p style={{ color: "var(--c-muted)", fontSize: 12, margin: "0 0 12px" }}>
          Nada para publicar.
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="field"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Mensagem do commit"
        />
        <button className="btn btn-primary" disabled={!canPublish} onClick={publish}>
          {busy ? "Publicando…" : "Publicar"}
        </button>
      </div>

      {result && (
        <pre className="term" style={{ marginTop: 12, maxHeight: 140, overflow: "auto" }}>
          {result}
        </pre>
      )}
    </div>
  );
}
