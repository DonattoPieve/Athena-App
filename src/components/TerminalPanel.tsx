import { useEffect, useRef, useState } from "react";
import { api, mensagemDeErro } from "../lib/api";

type Linha = { n: number; tipo: "cmd" | "out" | "err" | "fim"; texto: string };

const SUGESTOES = ["athena publish --dry-run", "athena pull", "git status", "athena status"];

/**
 * Terminal do app: roda comando na raiz do vault e mostra a saída.
 *
 * Não é um TTY. Cada comando abre um `powershell -Command` próprio, então
 * comando que faz pergunta interativa (um prompt de senha, um editor) fica
 * pendurado — daí o botão Interromper. Isso cobre o uso real daqui (publish,
 * pull, git, npm) sem a dependência nativa que um terminal de verdade exige e
 * que precisa ser recompilada a cada versão do Electron.
 */
export function TerminalPanel() {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [comando, setComando] = useState("");
  const [rodando, setRodando] = useState(false);
  const [cwd, setCwd] = useState("");
  const [historico, setHistorico] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState<number | null>(null);
  const seq = useRef(0);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.term.cwd().then(setCwd).catch(() => setCwd(""));
  }, []);

  useEffect(() => {
    return api.term.onEvent((e) => {
      seq.current += 1;
      if (e.kind === "exit") {
        setRodando(false);
        setLinhas((l) => [
          ...l,
          {
            n: seq.current,
            tipo: "fim",
            texto: e.code === 0 ? "— concluído" : `— saiu com código ${e.code}`,
          },
        ]);
      } else {
        setLinhas((l) => [
          ...l,
          { n: seq.current, tipo: e.kind === "err" ? "err" : "out", texto: e.text },
        ]);
      }
    });
  }, []);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [linhas]);

  async function rodar(texto?: string) {
    const cmd = (texto ?? comando).trim();
    if (!cmd || rodando) return;
    seq.current += 1;
    setLinhas((l) => [...l, { n: seq.current, tipo: "cmd", texto: `> ${cmd}` }]);
    setHistorico((h) => (h[h.length - 1] === cmd ? h : [...h, cmd]));
    setHIdx(null);
    setComando("");
    setRodando(true);
    try {
      await api.term.run(cmd);
    } catch (e) {
      seq.current += 1;
      setLinhas((l) => [...l, { n: seq.current, tipo: "err", texto: mensagemDeErro(e) }]);
      setRodando(false);
    }
  }

  /** Seta pra cima/baixo anda no histórico, como em qualquer shell. */
  function navegar(dir: -1 | 1) {
    if (historico.length === 0) return;
    const atual = hIdx ?? historico.length;
    const novo = Math.min(historico.length, Math.max(0, atual + dir));
    setHIdx(novo);
    setComando(novo === historico.length ? "" : historico[novo]);
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="label">Terminal</span>
        <code style={{ fontSize: 11, color: "var(--c-muted)" }}>{cwd}</code>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {rodando && (
            <button
              className="btn"
              style={{ padding: "3px 10px", fontSize: 11 }}
              onClick={() => api.term.cancel()}
            >
              Interromper
            </button>
          )}
          <button
            className="btn"
            style={{ padding: "3px 10px", fontSize: 11 }}
            onClick={() => setLinhas([])}
          >
            Limpar
          </button>
        </div>
      </div>

      <pre className="term scroll" style={{ minHeight: 260, maxHeight: "46vh" }}>
        {linhas.length === 0
          ? "Rode um comando na raiz do vault. Não é um TTY: comando que pergunta algo fica esperando — use Interromper."
          : linhas.map((l) => (
              <span
                key={l.n}
                style={{
                  color:
                    l.tipo === "err"
                      ? "#ff9a9a"
                      : l.tipo === "cmd"
                        ? "var(--c-accent)"
                        : l.tipo === "fim"
                          ? "var(--c-muted)"
                          : undefined,
                }}
              >
                {l.texto}
                {l.texto.endsWith("\n") ? "" : "\n"}
              </span>
            ))}
        <div ref={fim} />
      </pre>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="field"
          placeholder={rodando ? "rodando…" : "comando"}
          value={comando}
          disabled={rodando}
          onChange={(e) => setComando(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") rodar();
            if (e.key === "ArrowUp") {
              e.preventDefault();
              navegar(-1);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              navegar(1);
            }
          }}
        />
        <button className="btn btn-primary" disabled={rodando || !comando.trim()} onClick={() => rodar()}>
          Rodar
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SUGESTOES.map((s) => (
          <button
            key={s}
            className="btn"
            style={{ padding: "3px 8px", fontSize: 11 }}
            disabled={rodando}
            onClick={() => rodar(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
