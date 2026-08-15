import { useEffect, useMemo, useState } from "react";
import { api, type HomeData } from "../lib/api";

/**
 * Home — mesma linguagem visual do athena-web (hero com brilho radial, cartões
 * de número com sparkline, lista de matérias com barra, atividade recente).
 *
 * A diferença de fundo: os números aqui vêm do DISCO, não do Supabase. Esta é
 * a tela de quem está com o vault na frente — ela tem que dizer a verdade
 * sobre esta máquina mesmo sem conta, sem internet e antes de publicar.
 */
export function Home({
  onAbrir,
  onNovaNota,
  onComandos,
}: {
  onAbrir: (rel: string) => void;
  onNovaNota: () => void;
  onComandos: () => void;
}) {
  const [dados, setDados] = useState<HomeData | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    api.fs.home().then(setDados).catch(() => setDados(null));
  }, []);

  const saudacao = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  }, []);

  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q || !dados) return [];
    return dados.paginas
      .filter((p) => (p.titulo + p.slug + p.subject).toLowerCase().includes(q))
      .slice(0, 8);
  }, [busca, dados]);

  if (!dados) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <p style={{ margin: 0, color: "var(--c-muted)" }}>Lendo o vault…</p>
      </div>
    );
  }

  const semana = dados.paginas.filter((p) => diasAte(p.updated) <= 7).length;
  const ingests = dados.eventos.filter((e) => !e.removido).length;
  const maxPaginas = Math.max(1, ...dados.subjects.map((s) => s.paginas));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {dados.logConflitado && (
        <div className="card" style={{ padding: 14, borderColor: "#ba7517" }}>
          <strong style={{ color: "#ba7517", fontSize: 13 }}>
            log.md tem marcadores de conflito de merge
          </strong>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--c-muted)" }}>
            O publish manda o log inteiro para a tabela <code>ingests</code>. Com{" "}
            <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> no meio, o histórico vai torto. Resolva o
            arquivo antes de publicar.
          </p>
        </div>
      )}

      {/* ---- hero ---- */}
      <div className="card hero">
        <div className="hero-brilho" />
        <div className="hero-conteudo">
          <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>{saudacao}</p>
          <h1 className="hero-titulo">
            Seu <span style={{ color: "var(--c-accent)" }}>Segundo</span> Cérebro
          </h1>
          <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--c-muted)" }}>
            {dados.subjects.length} matéria(s), {dados.paginas.length} página(s) e {dados.notas}{" "}
            nota(s) neste disco.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-primary" onClick={onNovaNota}>
              Nova nota
            </button>
            <button className="btn" onClick={onComandos}>
              Comandos
            </button>
          </div>
        </div>
      </div>

      {/* ---- busca ---- */}
      <div style={{ position: "relative" }}>
        <input
          className="field"
          placeholder="Buscar aula pelo título, slug ou matéria…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setBusca("");
            if (e.key === "Enter" && resultados[0]) {
              onAbrir(resultados[0].rel);
              setBusca("");
            }
          }}
        />
        {resultados.length > 0 && (
          <div className="card busca-lista">
            {resultados.map((p) => (
              <button
                key={p.rel}
                className="nav-item"
                onClick={() => {
                  onAbrir(p.rel);
                  setBusca("");
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.titulo}</span>
                <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--c-muted)" }}>
                  {p.subject}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---- números ---- */}
      <div className="stats">
        <Stat
          n={dados.paginas.length}
          rotulo="Páginas"
          sub={semana ? `+${semana} nesta semana` : ""}
          serie={serieAcumulada(dados)}
        />
        <Stat
          n={dados.subjects.length}
          rotulo="Matérias"
          sub={`${dados.notas} nota(s) crua(s)`}
          serie={dados.subjects.map((s) => s.paginas)}
        />
        <Stat
          n={ingests}
          rotulo="Ingests no log"
          sub={dados.eventos[0]?.data ?? ""}
          serie={porDia(dados)}
          barras
        />
      </div>

      {/* ---- matérias ---- */}
      <div className="card" style={{ padding: 16 }}>
        <p className="label" style={{ margin: "0 0 10px" }}>
          Matérias
        </p>
        {dados.subjects.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>
            Nada em <code>wiki/subjects</code> ainda.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dados.subjects.map((s) => (
              <button
                key={s.slug}
                className="materia"
                onClick={() => onAbrir(`${s.rel}/${s.slug}.md`)}
                title={`Abrir o MOC de ${s.slug}`}
              >
                <span className="materia-code">{s.code}</span>
                <span className="materia-nome">{s.nome}</span>
                <span className="materia-barra">
                  <span style={{ width: `${(s.paginas / maxPaginas) * 100}%` }} />
                </span>
                <span className="materia-n">{s.paginas}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---- recentes + log ---- */}
      <div className="duas-colunas">
        <div className="card" style={{ padding: 16 }}>
          <p className="label" style={{ margin: "0 0 10px" }}>
            Atualizadas por último
          </p>
          {dados.paginas.slice(0, 6).map((p) => (
            <button key={p.rel} className="nav-item" onClick={() => onAbrir(p.rel)}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.titulo}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--c-muted)" }}>
                {quando(p.updated)}
              </span>
            </button>
          ))}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <p className="label" style={{ margin: "0 0 10px" }}>
            Histórico (log.md)
          </p>
          {dados.eventos.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>Sem eventos ainda.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {dados.eventos.slice(0, 6).map((e, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 11.5 }}>
                  <span style={{ color: "var(--c-muted)", flex: "0 0 auto" }}>{e.data}</span>
                  <span
                    style={{
                      color: e.removido ? "#e24b4a" : "var(--c-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={e.texto}
                  >
                    {e.slug ?? e.texto}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  n,
  rotulo,
  sub,
  serie,
  barras,
}: {
  n: number;
  rotulo: string;
  sub?: string;
  serie: number[];
  barras?: boolean;
}) {
  return (
    <div className="card stat">
      <div className="stat-n">{n}</div>
      <div className="stat-rotulo">{rotulo}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      <Sparkline dados={serie} barras={barras} />
    </div>
  );
}

/** Mesmo desenho do athena-web: área com linha, ou barras. */
function Sparkline({ dados, barras }: { dados: number[]; barras?: boolean }) {
  const w = 90;
  const h = 22;
  const serie = dados.length ? dados : [0];
  const max = Math.max(...serie, 1);

  if (barras) {
    const bw = w / serie.length - 1.5;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none">
        {serie.map((v, i) => {
          const bh = Math.max(1.5, (v / max) * (h - 2));
          return (
            <rect
              key={i}
              x={(i / serie.length) * w}
              y={h - bh}
              width={Math.max(1, bw)}
              height={bh}
              rx="0.6"
              fill="var(--sv-accent)"
              opacity={v === 0 ? 0.2 : 0.55 + 0.45 * (v / max)}
            />
          );
        })}
      </svg>
    );
  }

  const pts = serie.map((v, i) => [
    (i / Math.max(1, serie.length - 1)) * w,
    h - (v / max) * (h - 3) - 1,
  ]);
  const linha = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(" ");
  const area = `${linha} L ${w} ${h} L 0 ${h} Z`;
  const ultimo = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none">
      <path d={area} fill="var(--sv-accent)" fillOpacity="0.12" />
      <path
        d={linha}
        fill="none"
        stroke="var(--sv-accent)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={ultimo[0]} cy={ultimo[1]} r="2" fill="var(--sv-bright)" />
    </svg>
  );
}

function diasAte(iso: string): number {
  if (!iso) return Infinity;
  const d = new Date(iso).getTime();
  if (isNaN(d)) return Infinity;
  return (Date.now() - d) / 86400000;
}

function quando(iso: string): string {
  const dias = diasAte(iso);
  if (!isFinite(dias)) return "";
  if (dias < 1) return "hoje";
  if (dias < 2) return "ontem";
  if (dias < 30) return `${Math.floor(dias)} dias`;
  const meses = Math.floor(dias / 30);
  return meses === 1 ? "1 mês" : `${meses} meses`;
}

/** Páginas acumuladas por semana — a curva sobe conforme o vault cresce. */
function serieAcumulada(d: HomeData): number[] {
  const serie: number[] = [];
  for (let i = 7; i >= 0; i--) {
    const corte = Date.now() - i * 7 * 86400000;
    serie.push(d.paginas.filter((p) => new Date(p.updated).getTime() <= corte).length);
  }
  return serie;
}

/** Ingests por dia nos últimos 14 dias, do log.md. */
function porDia(d: HomeData): number[] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dias: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const dia = new Date(hoje.getTime() - i * 86400000).toISOString().slice(0, 10);
    dias.push(d.eventos.filter((e) => e.data === dia && !e.removido).length);
  }
  return dias;
}
