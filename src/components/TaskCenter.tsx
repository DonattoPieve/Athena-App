import { useEffect, useRef, useState } from "react";
import { api, type Job, type Line, type SessionEvent, type SessionState } from "../lib/api";
import { etapas, progresso, rotuloAtual, temMarcos } from "../lib/progresso";
import { t, tf } from "../lib/i18n";
import { IconConfig, IconPerfil } from "./icons";

/**
 * Painel direito — o que o app está fazendo agora.
 *
 * Ele existe porque o ingest é longo e roda fora da tela: sem um lugar fixo,
 * a única forma de saber se o Claude ainda está trabalhando era abrir o
 * monitor. Aqui o estado fica à vista o tempo todo, e o monitor continua
 * sendo o lugar do log cru.
 *
 * Tudo aqui é derivado da sessão de verdade. Nada de placeholder: sem comando
 * rodando, o painel diz que não há comando rodando.
 */

const ATALHOS: [string, string][] = [
  ["Ctrl P", "Abrir arquivo"],
  ["Ctrl K", "Buscar em tudo"],
  ["Ctrl Shift P", "Paleta de comandos"],
  ["Ctrl N", "Nova nota"],
  ["Ctrl W", "Fechar aba"],
  ["Ctrl Shift I", "Ir para o ingest"],
];

/** `Resumos/subjects/C09-Computacao-Grafica/x.md` -> `C09 / x` */
function alvoLegivel(rotulo: string | null): string | null {
  if (!rotulo) return null;
  const m = /^athena\s+(?:\w+\s+)?([A-Z]\d{2})\s+(\S+)/.exec(rotulo);
  if (m) return `${m[1]} / ${m[2]}`;
  return rotulo.replace(/^athena\s+/, "");
}

export function TaskCenter({
  onAbrirMonitor,
  onVerAtalhos,
  onAjuda,
  onTema,
  onPerfil,
  onConfig,
  versao,
}: {
  onAbrirMonitor: () => void;
  onVerAtalhos: () => void;
  /** Abre o passo a passo numa janela propria (ver `win:ajuda` no main). */
  onAjuda: () => void;
  onTema: () => void;
  onPerfil: () => void;
  onConfig: () => void;
  versao: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<SessionState | null>(null);
  const [queue, setQueue] = useState<Job[]>([]);
  /** Etapa -> hora em que ela apareceu. Só do que foi visto ao vivo. */
  const [horas, setHoras] = useState<Record<string, string>>({});
  const vistas = useRef(new Set<string>());

  useEffect(() => {
    let vivo = true;
    api.session.snapshot().then((s) => {
      if (!vivo) return;
      setLines((cur) => {
        const conhecidas = new Set(s.lines.map((l) => l.n));
        return [...s.lines, ...cur.filter((l) => !conhecidas.has(l.n))];
      });
      setState(s.state);
      setQueue(s.queue);
    });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    return api.session.onEvent((e: SessionEvent) => {
      if (e.kind === "state") setState(e.state);
      else if (e.kind === "queue") setQueue(e.jobs);
      else if (e.kind === "log" || e.kind === "assistant") {
        const level = e.kind === "assistant" ? "assistant" : e.level;
        setLines((l) =>
          l.some((x) => x.n > 0 && x.n === e.n) ? l : [...l, { n: e.n ?? 0, level, text: e.text }],
        );
      }
    });
  }, []);

  const passos = etapas(lines);

  /**
   * Marca a hora da etapa na primeira vez que ela aparece.
   *
   * A hora é a do RENDERER, não a do transcript — as linhas do Claude Code
   * não trazem carimbo de tempo. Por isso etapa que já estava no snapshot
   * (o painel montou no meio do ingest) fica sem hora em vez de ganhar uma
   * hora inventada.
   */
  useEffect(() => {
    const agora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const novas: Record<string, string> = {};
    for (const p of passos) {
      if (!vistas.current.has(p)) {
        vistas.current.add(p);
        novas[p] = agora;
      }
    }
    if (Object.keys(novas).length) setHoras((h) => ({ ...h, ...novas }));
  }, [passos.join("|")]);

  const rodando = state === "running" || state === "awaiting";
  const rotulo = rotuloAtual(lines);
  const { pct, nome } = progresso(lines);
  const medivel = temMarcos(rotulo);

  return (
    <aside className="taskcenter">
      <div className="taskcenter-scroll scroll">
        {/* ---- tarefa em andamento ---- */}
        <section className="tc-card">
          <p className="tc-titulo">Task Center</p>

          {rodando ? (
            <>
              <div className="tc-linha-topo">
                <span className="tc-bolha" aria-hidden />
                <strong className="tc-tarefa">
                  {state === "awaiting" ? t("aguardando você") : t("Gerando página")}
                </strong>
                <span className="tc-girando" aria-hidden />
              </div>
              {alvoLegivel(rotulo) && <p className="tc-alvo">{alvoLegivel(rotulo)}</p>}

              <div className="tc-barra-linha">
                <div className="barra" data-parado={state === "awaiting"}>
                  <div
                    className={medivel ? "barra-cheio" : "barra-cheio barra-indeterminada"}
                    style={medivel ? { width: `${pct}%` } : undefined}
                  />
                </div>
                {medivel && <span className="tc-pct">{pct}%</span>}
              </div>

              <p className="tc-desc">
                {state === "awaiting"
                  ? t("O ingest parou para perguntar. Nada foi publicado — responda para continuar.")
                  : tf("Claude está {etapa}…", { etapa: nome })}
              </p>
              <button className="btn" onClick={onAbrirMonitor}>
                {t("Ver detalhes")}
              </button>
            </>
          ) : (
            <>
              <p className="tc-vazio">
                {state === "failed"
                  ? t("O último comando falhou.")
                  : state === "done"
                    ? t("Nenhum comando rodando. O último terminou bem.")
                    : t("Nenhum comando rodando.")}
              </p>
              <button className="btn" onClick={onAbrirMonitor}>
                {t("Abrir monitor")}
              </button>
            </>
          )}

          {queue.length > 0 && (
            <p className="tc-fila">{tf("{n} na fila", { n: queue.length })}</p>
          )}
        </section>

        {/* ---- etapas da sessao ---- */}
        <section className="tc-card">
          <p className="tc-titulo">{t("Sessão atual")}</p>
          <div className="tc-modelo">
            <span className="tc-modelo-nome">Claude Code</span>
            <span className="tc-ponto" data-on={rodando} />
            <span className="tc-modelo-estado">
              {rodando ? t("Conectado") : t("ocioso")}
            </span>
          </div>

          {passos.length === 0 ? (
            <p className="tc-vazio">{t("Nenhuma etapa ainda.")}</p>
          ) : (
            <ul className="tc-etapas">
              {passos.map((p) => (
                <li key={p}>
                  <span className="tc-etapa-marca" aria-hidden />
                  <span className="truncar">{p}</span>
                  <span className="tc-etapa-hora">{horas[p] ?? ""}</span>
                </li>
              ))}
            </ul>
          )}

          <button className="link-btn" onClick={onAbrirMonitor}>
            {t("Abrir sessão completa")} →
          </button>
        </section>

        {/* ---- atalhos ---- */}
        <section className="tc-card">
          <p className="tc-titulo">{t("Atalhos")}</p>
          <div className="tc-atalhos">
            {ATALHOS.map(([tecla, oque]) => (
              <div key={tecla} className="tc-atalho">
                <kbd>{tecla}</kbd>
                <span className="truncar">{t(oque)}</span>
              </div>
            ))}
          </div>
          <button className="link-btn" onClick={onVerAtalhos}>
            {t("Ver todos os atalhos")} →
          </button>
        </section>
      </div>

      <footer className="taskcenter-rodape">
        <span>{versao ? `Athena v${versao}` : "Athena"}</span>
        <div className="taskcenter-icones">
          <button title={t("Alternar tema")} aria-label={t("Alternar tema")} onClick={onTema}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {/* O "?" vem antes dos outros: quem precisa dele e quem ainda nao
              sabe onde ficam os outros. */}
          <button title={t("Como usar o Athena")} aria-label={t("Como usar o Athena")} onClick={onAjuda}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.2 9.3a2.8 2.8 0 1 1 3.4 2.7c-.7.2-1 .8-1 1.5v.4" strokeLinecap="round" />
              <path d="M12 17.2v.2" strokeLinecap="round" />
            </svg>
          </button>
          <button title={t("Perfil")} aria-label={t("Perfil")} onClick={onPerfil}>
            <IconPerfil />
          </button>
          <button title={t("Configurações")} aria-label={t("Configurações")} onClick={onConfig}>
            <IconConfig />
          </button>
        </div>
      </footer>
    </aside>
  );
}
