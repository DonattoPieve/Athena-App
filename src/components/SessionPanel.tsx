import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Job, type Line, type SessionEvent, type SessionState } from "../lib/api";
import { progresso, rotuloAtual, temMarcos } from "../lib/progresso";
import { IconLupa } from "./icons";
import { t, tf } from "../lib/i18n";

function busyOf(state: SessionState | null) {
  return state === "running" || state === "awaiting" || state === "queued";
}

/** Ignora repetido: o snapshot pode trazer uma linha que ja chegou por evento. */
function append(lines: Line[], line: Line): Line[] {
  if (line.n > 0 && lines.some((l) => l.n === line.n)) return lines;
  return [...lines, line];
}

/**
 * A sessão do Claude Code, no formato do Serial Monitor do Arduino: **uma
 * lupa na barra de cima**, e o log inteiro numa janela que abre por cima.
 *
 * Antes era um cartão fixo no meio da tela. O problema não era o tamanho — é
 * que a sessão fica ociosa quase o tempo todo, e um painel permanente cobrava
 * espaço de leitura 100% do tempo para mostrar "ociosa" 95% dele.
 *
 * O que a lupa precisa fazer, já que o log não está mais à vista:
 *   - dizer o estado sem ser aberta (cor + ponto), senão vira botão morto;
 *   - **abrir sozinha** quando o Claude faz uma pergunta. Aí não é enfeite: o
 *     ingest está parado esperando resposta, e uma pergunta escondida trava o
 *     comando até alguém desconfiar.
 */
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
  const rodando = state === "running" || awaiting;
  /** Lupa: o mesmo log numa janela grande, sem sair da tela em que se está. */
  const [ampliado, setAmpliado] = useState(false);

  useEffect(() => {
    if (!ampliado) return;
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && setAmpliado(false);
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [ampliado]);

  // Pergunta do Claude ou queda da conta: abre sem pedir. Nos dois casos o
  // trabalho parou e depende de alguém ver.
  useEffect(() => {
    if (awaiting || authNeeded) setAmpliado(true);
  }, [awaiting, authNeeded]);

  async function send() {
    if (!reply.trim()) return;
    // A linha "< resposta" vem de volta como evento do main, que a guarda
    // no transcript. Escrever aqui tambem duplicaria.
    await api.session.reply(reply);
    setReply("");
  }

  const pontoCor =
    state === "awaiting" ? "#ba7517"
    : state === "failed" ? "#e24b4a"
    : state === "running" || state === "queued" ? "var(--c-accent)"
    : state === "done" ? "#1d9e75"
    : "var(--c-muted)";

  return (
    <>
      <button
        className="lupa-sessao"
        data-estado={state ?? "ociosa"}
        title={tf("Sessão: {estado} — abrir o monitor", { estado: rotuloEstado(state) })}
        onClick={() => setAmpliado(true)}
      >
        <IconLupa />
        <span className="lupa-ponto" style={{ background: pontoCor }} />
        {queue.length > 0 && <span className="lupa-fila">{queue.length}</span>}
      </button>

      {/* PORTAL para o <body>, e nao um <div> aqui dentro.
          A lupa mora na barra de abas, que e `position: sticky` — e sticky cria
          contexto de empilhamento. Dentro dele o `z-index: 200` do modal so vale
          entre irmaos da barra, e o conteudo da Home, que vem depois no DOM,
          pintava POR CIMA do modal aberto. No body nao ha contexto acima. */}
      {ampliado && createPortal(
        <div className="modal-backdrop" onClick={() => setAmpliado(false)}>
          <div
            className="card modal serial-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={t("Monitor da sessão")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span className="label">{t("Sessão")}</span>
              <StateBadge state={state} />
              {queue.length > 0 && (
                <span style={{ color: "var(--c-muted)", fontSize: 12 }}>
                  {tf("{n} na fila: {labels}", {
                    n: queue.length,
                    labels: queue.map((j) => j.label).join(" · "),
                  })}
                </span>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                {rodando && (
                  <button
                    className="btn"
                    style={{ padding: "3px 10px", fontSize: 11 }}
                    onClick={() => api.session.cancel()}
                  >
                    {t("Interromper")}
                  </button>
                )}
                <button
                  className="btn"
                  style={{ padding: "3px 10px", fontSize: 11 }}
                  onClick={() => setAmpliado(false)}
                >
                  {t("Fechar")}
                </button>
              </div>
            </div>

            {rodando && <Barra lines={lines} parado={awaiting} />}

            {authNeeded && (
              <div className="aviso-claude">
                <p style={{ margin: "0 0 4px", fontWeight: 500, color: "#ba7517" }}>
                  {t("A conta do Claude Code caiu")}
                </p>
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--c-muted)" }}>
                  {t("Isto ")}
                  <strong>{t("não")}</strong>
                  {t(
                    " é o login do Athena (Supabase) — é a sua conta Pro, que o app usa para rodar o ingest. O login dela é no terminal, uma vez.",
                  )}
                </p>
                <button className="btn" onClick={() => api.claude.openLogin()}>
                  {t("Abrir terminal no ")}
                  <code>claude</code>
                </button>
              </div>
            )}

            <pre className="term scroll" style={{ flex: 1, minHeight: 0 }}>
              {lines.length === 0
                ? t("Nenhum comando executado ainda.")
                : lines.map((l, i) => (
                    <span
                      key={l.n || i}
                      style={{
                        opacity: l.level === "tool" ? 0.65 : 1,
                        color: l.level === "error" ? "#ff9a9a" : undefined,
                      }}
                    >
                      {l.text}
                      {"\n"}
                    </span>
                  ))}
              <div ref={endRef} />
            </pre>

            <div className="serial-rodape">
              <button
                className="btn"
                disabled={lines.length === 0}
                title={t("Esvazia o log — não interrompe o comando em andamento")}
                onClick={async () => {
                  await api.session.clear();
                  setLines([]);
                }}
              >
                {t("Limpar")}
              </button>
            </div>

            {awaiting ? (
              <div style={{ marginTop: 12 }}>
                <p style={{ margin: "0 0 6px", color: "var(--c-accent)", fontSize: 12 }}>
                  {t("O ingest parou para perguntar. Nada foi publicado — responda para continuar.")}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="field"
                    autoFocus
                    value={reply}
                    placeholder={t("Sua resposta")}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()}
                  />
                  <button className="btn btn-primary" onClick={send}>
                    {t("Responder")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function rotuloEstado(state: SessionState | null) {
  if (!state) return t("ociosa");
  return {
    queued: t("na fila"),
    running: t("executando"),
    awaiting: t("aguardando você"),
    done: t("concluída"),
    failed: t("falhou"),
  }[state];
}

/**
 * Barra do comando em andamento.
 *
 * Determinada só quando há passos para medir (ver progresso.ts). Em `review` e
 * `delete` ela vira listrada e sem número — inventar uma porcentagem ali seria
 * enfeite, e enfeite que mente sobre quanto falta é pior que barra nenhuma.
 */
function Barra({ lines, parado }: { lines: Line[]; parado: boolean }) {
  const rotulo = rotuloAtual(lines);
  const medivel = temMarcos(rotulo);
  const { pct, nome } = progresso(lines);

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: "var(--c-text)" }}>
          {parado ? t("esperando a sua resposta") : medivel ? nome : t("executando")}
        </span>
        {rotulo && (
          <code style={{ fontSize: 11, color: "var(--c-muted)" }}>{rotulo}</code>
        )}
        {medivel && !parado && (
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--c-accent)" }}>{pct}%</span>
        )}
      </div>
      <div
        className="barra"
        data-parado={parado}
        title={t("Estimativa pelas etapas do CLAUDE.md, não tempo restante")}
      >
        <div
          className={medivel ? "barra-cheio" : "barra-cheio barra-indeterminada"}
          style={medivel ? { width: `${pct}%` } : undefined}
        />
      </div>

    </div>
  );
}

function StateBadge({ state }: { state: SessionState | null }) {
  if (!state) return <span style={{ color: "var(--c-muted)", fontSize: 12 }}>{t("ociosa")}</span>;
  const map: Record<SessionState, [string, string]> = {
    queued: [t("na fila"), "var(--c-muted)"],
    running: [t("executando"), "var(--c-accent)"],
    awaiting: [t("aguardando você"), "#ba7517"],
    done: [t("concluída"), "#1d9e75"],
    failed: [t("falhou"), "#e24b4a"],
  };
  const [text, color] = map[state];
  return <span style={{ color, fontSize: 12 }}>{text}</span>;
}
