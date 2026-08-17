import { useEffect, useMemo, useRef, useState } from "react";
import { api, type TermoGlossario as Termo } from "../lib/api";
import { t, tf } from "../lib/i18n";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import "../styles/biblioteca.css";

/**
 * Glossário — tela reformulada (categorias, busca com Ctrl K, favoritos,
 * lista/grade e paginação).
 *
 * `categoria` em `TermoGlossario` e `api.usage.termos/alternarTermo` (os
 * favoritos) vêm do contrato combinado com quem mexe em api.ts/electron —
 * já estão lá, então este arquivo usa `api` direto, sem cast.
 */

const TAM_PAGINA = 20;

type Ordenacao = "az" | "za" | "categoria";

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

/* ------------------------------------------------------------------ *
 * Ícones locais — mesmo traço (currentColor, stroke 2) do resto do app,
 * sem emoji: assim eles acompanham tema e paleta sozinhos.
 * ------------------------------------------------------------------ */

function IconBuscaCampo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  );
}

function IconCoracao({ cheio }: { cheio: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={cheio ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20.5s-7.5-4.6-10-9.4C.4 7.7 2.2 4 5.8 4c2 0 3.6 1.1 4.7 2.6C11.6 5.1 13.2 4 15.2 4c3.6 0 5.4 3.7 3.8 7.1-2.5 4.8-10 9.4-10 9.4z" />
    </svg>
  );
}

function IconMais() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function IconLista() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function IconGrade() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

const ic = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/**
 * Páginas visíveis na paginação: sempre 1, a última, e uma janela ao redor da
 * atual — com "…" nos buracos. Abaixo de 8 páginas mostra todas, sem cortar.
 */
function paginasVisiveis(atual: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const marcadas = new Set<number>([1, 2, total - 1, total, atual - 1, atual, atual + 1]);
  const numeros = [...marcadas].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let anterior = 0;
  for (const n of numeros) {
    if (anterior && n - anterior > 1) out.push("…");
    out.push(n);
    anterior = n;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Glossário
 * ------------------------------------------------------------------ */

export function Glossario({ onAbrir }: { onAbrir: (rel: string) => void }) {
  const [termos, setTermos] = useState<Termo[] | null>(null);
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>("az");
  const [modo, setModo] = useState<"lista" | "grade">("lista");
  const [pagina, setPagina] = useState(1);
  const buscaRef = useRef<HTMLInputElement>(null);
  const menu = useContextMenu();

  useEffect(() => {
    api.fs.glossario().then(setTermos).catch(() => setTermos([]));
    api.usage
      .termos()
      .then((lista) => setFavoritos(new Set(lista)))
      .catch(() => {});
  }, []);

  // Ctrl+K foca a busca — é o que o atalho ao lado do campo promete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        buscaRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Chips vêm das categorias REAIS que chegaram do disco, não de uma lista
  // fixa — uma categoria nova em um termo aparece sozinha, sem código novo.
  const categorias = useMemo(() => {
    if (!termos) return [];
    return [...new Set(termos.map((x) => x.categoria).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR"),
    );
  }, [termos]);

  const filtrados = useMemo(() => {
    if (!termos) return [];
    const q = busca.trim().toLowerCase();
    return termos.filter((x) => {
      if (categoriaAtiva && x.categoria !== categoriaAtiva) return false;
      if (!q) return true;
      return x.termo.toLowerCase().includes(q) || x.contexto.toLowerCase().includes(q);
    });
  }, [termos, busca, categoriaAtiva]);

  const ordenados = useMemo(() => {
    const copia = [...filtrados];
    if (ordenacao === "az") copia.sort((a, b) => a.termo.localeCompare(b.termo, "pt-BR"));
    else if (ordenacao === "za") copia.sort((a, b) => b.termo.localeCompare(a.termo, "pt-BR"));
    else
      copia.sort(
        (a, b) =>
          a.categoria.localeCompare(b.categoria, "pt-BR") || a.termo.localeCompare(b.termo, "pt-BR"),
      );
    return copia;
  }, [filtrados, ordenacao]);

  // Trocar filtro ou ordenação com a pessoa na página 5 deixaria uma lista
  // vazia na tela — volta para o começo sempre que o conjunto muda de forma.
  useEffect(() => {
    setPagina(1);
  }, [busca, categoriaAtiva, ordenacao]);

  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / TAM_PAGINA));
  const paginaClamped = Math.min(pagina, totalPaginas);
  const visiveis = ordenados.slice((paginaClamped - 1) * TAM_PAGINA, paginaClamped * TAM_PAGINA);

  async function alternarFavorito(termo: string) {
    try {
      const novo = await api.usage.alternarTermo(termo);
      setFavoritos((prev) => {
        const s = new Set(prev);
        if (novo) s.add(termo);
        else s.delete(termo);
        return s;
      });
    } catch {
      // Sem conexão com o main não há como marcar — a tela só continua igual.
    }
  }

  function abrirMenu(e: React.MouseEvent, x: Termo) {
    const primeiraRef = x.refs[0];
    const items: MenuItem[] = [
      {
        label: t("Abrir a aula"),
        disabled: !primeiraRef,
        onClick: () => primeiraRef && onAbrir(primeiraRef.rel),
      },
      {
        label: t("Copiar definição"),
        disabled: !x.contexto,
        onClick: () => {
          api.clipboard.write(x.contexto);
        },
      },
    ];
    menu.open(e, items);
  }

  if (termos === null) return <Vazio>{t("lendo as páginas da wiki…")}</Vazio>;

  return (
    <div>
      <Cabecalho
        titulo={t("Glossário")}
        linha={t("Seus termos-chave organizados e prontos para consulta.")}
        icone={ic("M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z")}
      />

      {termos.length === 0 ? (
        <Vazio>
          {t("Nenhum termo ainda. Saem do que as páginas destacam em ")}
          <strong>{t("negrito")}</strong>.
        </Vazio>
      ) : (
        <>
          <div className="gl-busca">
            <IconBuscaCampo />
            <input
              ref={buscaRef}
              className="gl-busca-input"
              placeholder={t("Buscar termo ou definição...")}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
            <kbd>{t("Ctrl K")}</kbd>
          </div>

          <div className="gl-linha-filtros">
            <div className="gl-chips">
              <button
                className="gl-chip"
                data-ativo={categoriaAtiva === null}
                onClick={() => setCategoriaAtiva(null)}
              >
                {t("Todos")}
              </button>
              {categorias.map((c) => (
                <button
                  key={c}
                  className="gl-chip"
                  data-ativo={categoriaAtiva === c}
                  onClick={() => setCategoriaAtiva((atual) => (atual === c ? null : c))}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="gl-controles">
              <label className="gl-ordenar">
                <span>{t("Ordenar:")}</span>
                <select
                  className="field"
                  value={ordenacao}
                  onChange={(e) => setOrdenacao(e.target.value as Ordenacao)}
                >
                  <option value="az">{t("A-Z")}</option>
                  <option value="za">{t("Z-A")}</option>
                  <option value="categoria">{t("Categoria")}</option>
                </select>
              </label>
              <div className="gl-modo">
                <button
                  data-ativo={modo === "lista"}
                  onClick={() => setModo("lista")}
                  title={t("Lista")}
                  aria-label={t("Lista")}
                >
                  <IconLista />
                </button>
                <button
                  data-ativo={modo === "grade"}
                  onClick={() => setModo("grade")}
                  title={t("Grade")}
                  aria-label={t("Grade")}
                >
                  <IconGrade />
                </button>
              </div>
            </div>
          </div>

          <p className="gl-contagem">
            {tf(ordenados.length === 1 ? "{n} termo cadastrado" : "{n} termos cadastrados", {
              n: ordenados.length,
            })}
          </p>

          {visiveis.length === 0 ? (
            <Vazio>
              {busca
                ? tf("Nenhum termo com “{busca}”.", { busca })
                : t("Nenhum termo nesta categoria.")}
            </Vazio>
          ) : (
            <div className={modo === "grade" ? "gl-grade" : "gl-lista"}>
              {visiveis.map((x) => (
                <div key={x.termo} className="card gl-termo">
                  <div className="gl-termo-topo">
                    <span className="gl-termo-avatar">{x.termo[0]?.toUpperCase() ?? "?"}</span>
                    <strong className="gl-termo-nome">{x.termo}</strong>
                    {x.categoria && <span className="gl-termo-categoria">{x.categoria}</span>}
                    <button
                      className="gl-fav"
                      data-ativo={favoritos.has(x.termo)}
                      onClick={() => alternarFavorito(x.termo)}
                      title={favoritos.has(x.termo) ? t("Remover dos favoritos") : t("Marcar como favorito")}
                      aria-label={t("Favorito")}
                    >
                      <IconCoracao cheio={favoritos.has(x.termo)} />
                    </button>
                    <button
                      className="gl-mais"
                      onClick={(e) => abrirMenu(e, x)}
                      title={t("Mais ações")}
                      aria-label={t("Mais ações")}
                    >
                      <IconMais />
                    </button>
                  </div>
                  {x.contexto && <p className="gl-termo-contexto">{x.contexto}</p>}
                </div>
              ))}
            </div>
          )}

          {totalPaginas > 1 && (
            <div className="gl-paginacao">
              <button
                className="gl-pagina"
                disabled={paginaClamped === 1}
                onClick={() => setPagina((p) => p - 1)}
                aria-label={t("Página anterior")}
              >
                ‹
              </button>
              {paginasVisiveis(paginaClamped, totalPaginas).map((p, i) =>
                p === "…" ? (
                  <span key={`e${i}`} className="gl-reticencias">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    className="gl-pagina"
                    data-ativo={p === paginaClamped}
                    onClick={() => setPagina(p)}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                className="gl-pagina"
                disabled={paginaClamped === totalPaginas}
                onClick={() => setPagina((p) => p + 1)}
                aria-label={t("Próxima página")}
              >
                ›
              </button>
              <span className="gl-pagina-rotulo">
                {tf("Página {atual} de {total}", { atual: paginaClamped, total: totalPaginas })}
              </span>
            </div>
          )}
        </>
      )}

      <ContextMenu state={menu.state} onClose={menu.close} />
    </div>
  );
}
