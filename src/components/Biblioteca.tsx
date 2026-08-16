import { useEffect, useMemo, useState } from "react";
import { api, type TermoGlossario } from "../lib/api";
import { t, tf } from "../lib/i18n";

/**
 * Glossário — portado do athena-web para o app e em pt-BR.
 *
 * Uma diferença de fundo em relação ao site: lá a fonte é o banco, aqui é o
 * disco. Aula que acabou de sair do ingest aparece antes de ir para o ar —
 * que é justamente quando se quer conferir.
 */

function Cabecalho({
  titulo,
  linha,
  icone,
}: {
  titulo: string;
  linha: string;
  icone: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--c-accent)", display: "flex" }}>{icone}</span>
        <h1 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 600 }}>{titulo}</h1>
      </div>
      <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--c-muted)" }}>{linha}</p>
    </div>
  );
}

function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <div className="card vazio">
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--c-muted)" }}>{children}</p>
    </div>
  );
}

const ic = (d: string) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

/* ------------------------------------------------------------------ *
 * Glossário
 * ------------------------------------------------------------------ */

export function Glossario({ onAbrir }: { onAbrir: (rel: string) => void }) {
  const [termos, setTermos] = useState<TermoGlossario[] | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    api.fs.glossario().then(setTermos).catch(() => setTermos([]));
  }, []);

  const filtrados = useMemo(() => {
    if (!termos) return [];
    const q = busca.trim().toLowerCase();
    if (!q) return termos;
    return termos.filter(
      (x) => x.termo.toLowerCase().includes(q) || x.contexto.toLowerCase().includes(q),
    );
  }, [termos, busca]);

  const letras = useMemo(
    () => [...new Set(filtrados.map((x) => x.termo[0]?.toUpperCase() ?? "?"))].sort(),
    [filtrados],
  );

  if (termos === null) return <Vazio>{t("lendo as páginas da wiki…")}</Vazio>;

  return (
    <div>
      <Cabecalho
        titulo={t("Glossário")}
        linha={`${tf(termos.length === 1 ? "{n} termo" : "{n} termos", { n: termos.length })} · ${t("extraídos das páginas")}`}
        icone={ic("M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z")}
      />

      {termos.length === 0 ? (
        <Vazio>
          {t("Nenhum termo ainda. Saem do que as páginas destacam em ")}
          <strong>{t("negrito")}</strong>.
        </Vazio>
      ) : (
        <>
          <input
            className="field"
            placeholder={t("Filtrar termo…")}
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            style={{ marginBottom: 12 }}
          />
          {letras.length > 1 && (
            <div className="glossario-letras">
              {letras.map((l) => (
                <button key={l} onClick={() => {
                  document.getElementById(`g-${l}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <div className="lista-cartoes">
            {filtrados.map((t, i) => {
              const letra = t.termo[0]?.toUpperCase() ?? "?";
              const primeira = i === 0 || (filtrados[i - 1].termo[0]?.toUpperCase() ?? "?") !== letra;
              return (
                <div key={t.termo} id={primeira ? `g-${letra}` : undefined} className="card termo">
                  <div className="termo-linha">
                    <strong>{t.termo}</strong>
                    {t.refs.map((r) => (
                      <button key={r.rel} className="termo-ref" onClick={() => onAbrir(r.rel)} title={r.rel}>
                        {r.titulo.length > 30 ? r.titulo.slice(0, 29) + "…" : r.titulo}
                      </button>
                    ))}
                  </div>
                  {t.contexto && <p className="termo-contexto">{t.contexto}</p>}
                </div>
              );
            })}
          </div>
          {filtrados.length === 0 && (
            <Vazio>{tf("Nenhum termo com “{busca}”.", { busca })}</Vazio>
          )}
        </>
      )}
    </div>
  );
}
