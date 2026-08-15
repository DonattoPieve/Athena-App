import { useEffect, useRef, useState } from "react";
import { api, type Job, type Line, type SessionEvent, type SessionState } from "../lib/api";

function busyOf(state: SessionState | null) {
  return state === "running" || state === "awaiting" || state === "queued";
}

/** Ignora repetido: o snapshot pode trazer uma linha que ja chegou por evento. */
function append(lines: Line[], line: Line): Line[] {
  if (line.n > 0 && lines.some((l) => l.n === line.n)) return lines;
  return [...lines, line];
}

export function SessionPanel({
  onStateChange,
}: {
  onStateChange: (busy: boolean) => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<SessionState | null>(null);
  const [queue, setQueue] = useState<Job[]>([]);
  const [reply, setReply] = useState("");
  const [authNeeded, setAuthNeeded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // O transcript mora no main. Ao montar (troca de aba, reload do Vite) o
  // painel se reconstitui inteiro em vez de aparecer vazio no meio do ingest.
  // O merge por `n` cobre o intervalo entre assinar os eventos e o snapshot
  // chegar: linha que veio pelos dois caminhos entra uma vez so.
  useEffect(() => {
    let alive = true;
    api.session.snapshot().then((s) => {
      if (!alive) return;
      setLines((cur) => {
        const known = new Set(s.lines.map((l) => l.n));
        return [...s.lines, ...cur.filter((l) => !known.has(l.n))];
      });
      setState(s.state);
      setQueue(s.queue);
      setAuthNeeded(s.authNeeded);
      onStateChange(busyOf(s.state));
    });
    return () => {
      alive = false;
    };
  }, [onStateChange]);

  useEffect(() => {
    return api.session.onEvent((e: SessionEvent) => {
      if (e.kind === "state") {
        setState(e.state);
        if (e.state === "running") setAuthNeeded(false);
        onStateChange(busyOf(e.state));
      } else if (e.kind === "auth") {
        setAuthNeeded(true);
      } else if (e.kind === "queue") {
        setQueue(e.jobs);
      } else if (e.kind === "log") {
        setLines((l) => append(l, { n: e.n ?? 0, level: e.level, text: e.text }));
      } else if (e.kind === "assistant") {
        setLines((l) => append(l, { n: e.n ?? 0, level: "assistant", text: e.text }));
      }
    });
  }, [onStateChange]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const awaiting = state === "awaiting";

  async function send() {
    if (!reply.trim()) return;
    // A linha "< resposta" vem de volta como evento do main, que a guarda
    // no transcript. Escrever aqui tambem duplicaria.
    await api.session.reply(reply);
    setReply("");
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span className="label">Sessão</span>
        <StateBadge state={state} />
        {queue.length > 0 && (
          <span style={{ color: "var(--c-muted)", fontSize: 12 }}>
            {queue.length} na fila: {queue.map((j) => j.label).join(" · ")}
          </span>
        )}
        {(state === "running" || state === "awaiting") && (
          <button className="btn" style={{ marginLeft: "auto" }} onClick={() => api.session.cancel()}>
            Interromper
          </button>
        )}
      </div>

      {authNeeded && (
        <div
          style={{
            marginBottom: 10,
            padding: 12,
            border: "1px solid #ba7517",
            borderRadius: "var(--r-xl)",
            background: "var(--c-surface)",
          }}
        >
          <p style={{ margin: "0 0 4px", fontWeight: 500, color: "#ba7517" }}>
            A conta do Claude Code caiu
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--c-muted)" }}>
            Isto <strong>não</strong> é o login do Athena (Supabase) — é a sua conta Pro, que o app
            usa para rodar o ingest. O login dela é no terminal, uma vez.
          </p>
          <button className="btn" onClick={() => api.claude.openLogin()}>
            Abrir terminal no <code>claude</code>
          </button>
        </div>
      )}

      <pre className="term scroll" style={{ flex: 1, minHeight: 160 }}>
        {lines.length === 0
          ? "Nenhum comando executado ainda."
          : lines.map((l, i) => (
              <span key={l.n || i} style={{ opacity: l.level === "tool" ? 0.65 : 1, color: l.level === "error" ? "#ff9a9a" : undefined }}>
                {l.text}
                {"\n"}
              </span>
            ))}
        <div ref={endRef} />
      </pre>

      {awaiting && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 6px", color: "var(--c-accent)", fontSize: 12 }}>
            O ingest parou para perguntar. Nada foi publicado — responda para continuar.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="field"
              autoFocus
              value={reply}
              placeholder="Sua resposta"
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button className="btn btn-primary" onClick={send}>
              Responder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: SessionState | null }) {
  if (!state) return <span style={{ color: "var(--c-muted)", fontSize: 12 }}>ociosa</span>;
  const map: Record<SessionState, [string, string]> = {
    queued: ["na fila", "var(--c-muted)"],
    running: ["executando", "var(--c-accent)"],
    awaiting: ["aguardando você", "#ba7517"],
    done: ["concluída", "#1d9e75"],
    failed: ["falhou", "#e24b4a"],
  };
  const [text, color] = map[state];
  return <span style={{ color, fontSize: 12 }}>{text}</span>;
}
