import { useEffect, useMemo, useState } from "react";
import { api, type TreeNode } from "../lib/api";
import { splitFrontmatter } from "../lib/markdown";
import { MarkdownView } from "./MarkdownView";
import { t, tf } from "../lib/i18n";

/**
 * Página da wiki em modo leitura — o mesmo desenho do athena-web, em pt-BR.
 *
 * O texto ocupa a coluna principal e a lateral direita guarda o que o site
 * chama de "Original material", "Contents" e "Other lessons". Aqui é
 * "Material de origem", "Conteúdo" e "Outras aulas" — o app é em português, e
 * traduzir só metade seria pior que não traduzir.
 *
 * A lateral some abaixo de 1100px: numa janela estreita ela roubaria a largura
 * do texto, que é o motivo de a tela existir.
 */

/** Frontmatter YAML raso — só chave: valor, que é tudo que as páginas usam. */
function lerFrontmatter(front: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!front) return out;
  for (const linha of front.split("\n")) {
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(linha.trim());
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

/** Títulos `##` e `###`, ignorando o que estiver dentro de bloco de código. */
function titulos(md: string) {
  const saida: { nivel: number; texto: string; id: string }[] = [];
  let emCodigo = false;
  for (const linha of md.split("\n")) {
    if (linha.trim().startsWith("```")) {
      emCodigo = !emCodigo;
      continue;
    }
    if (emCodigo) continue;
    const m = /^(#{2,3})\s+(.+)$/.exec(linha);
    if (!m) continue;
    const texto = m[2].replace(/\*\*/g, "").replace(/`/g, "").trim();
    saida.push({ nivel: m[1].length, texto, id: idDoTitulo(texto) });
  }
  return saida;
}

/** Mesmo slug do `slugifyHeading` do site — os âncoras precisam bater. */
function idDoTitulo(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function achatarWiki(nodes: TreeNode[]): { nome: string; rel: string }[] {
  const saida: { nome: string; rel: string }[] = [];
  const andar = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.dir) andar(n.children ?? []);
      else if (n.name.endsWith(".md")) saida.push({ nome: n.name, rel: n.rel });
    }
  };
  andar(nodes);
  return saida;
}

const ICONE_ARQUIVO = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    style={{ flex: "0 0 auto", marginTop: 1, color: "var(--c-accent)" }}
    aria-hidden
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

export function Leitura({
  rel,
  texto,
  onAbrir,
  onRegerar,
}: {
  rel: string;
  texto: string;
  onAbrir: (rel: string) => void;
  /** Regerar ESTA página — sem passar pela árvore nem pelo seletor. */
  onRegerar?: (rel: string) => void;
}) {
  const [irmas, setIrmas] = useState<{ nome: string; rel: string }[]>([]);

  const { front, body } = useMemo(() => splitFrontmatter(texto), [texto]);
  const fm = useMemo(() => lerFrontmatter(front), [front]);

  /**
   * Título e corpo sem o título.
   *
   * A página guarda o `# Titulo` no próprio markdown, e a tela já mostra um
   * `<h1>` por fora. O athena-web renderiza os dois e o título aparece
   * duplicado — aqui o `#` de abertura sai do corpo em vez de repetir o
   * defeito. Só o primeiro, e só se for a primeira coisa do arquivo: `#` no
   * meio do texto é seção de verdade.
   */
  const { titulo, corpo } = useMemo(() => {
    const m = /^\s*#\s+(.+?)\s*\r?\n/.exec(body);
    if (m) return { titulo: m[1].trim(), corpo: body.slice(m[0].length) };
    return {
      titulo: (rel.split("/").pop() ?? rel).replace(/\.md$/, ""),
      corpo: body,
    };
  }, [body, rel]);

  const indice = useMemo(() => titulos(corpo), [corpo]);
  const pasta = rel.split("/").slice(0, -1).join("/");

  useEffect(() => {
    let vivo = true;
    api.fs
      .tree("Resumos")
      .then((arvore) => {
        if (!vivo) return;
        setIrmas(
          achatarWiki(arvore).filter(
            (f) =>
              f.rel !== rel &&
              f.rel.split("/").slice(0, -1).join("/") === pasta &&
              // O MOC tem o nome da pasta — é índice, não aula irmã.
              f.nome.replace(/\.md$/, "") !== pasta.split("/").pop(),
          ),
        );
      })
      .catch(() => setIrmas([]));
    return () => {
      vivo = false;
    };
  }, [rel, pasta]);

  /**
   * O material de origem, resolvido pelo main.
   *
   * O `sourceHref` do frontmatter aponta para a cópia que o SITE serve
   * (`athena-web/public/materials/...`), e essa cópia só existe na máquina
   * onde o ingest rodou — não está no `Notes/` e o Worker do R2 não serve
   * aquele prefixo. Montar o caminho aqui, como era antes, dava um botão que
   * abria no PC do Donatto e falhava em qualquer outro. Quem sabe achar o
   * arquivo do professor (no disco ou na conta) é o `materialDaPagina` do
   * vault — e o que ele devolve o app baixa sozinho no primeiro clique.
   */
  const [materialRel, setMaterialRel] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setMaterialRel(null);
    if (!fm.source && !fm.sourceHref) return;
    api.fs
      .materialDaPagina(rel, fm.source ?? null, fm.sourceHref ?? null)
      .then((r) => vivo && setMaterialRel(r))
      .catch(() => vivo && setMaterialRel(null));
    return () => {
      vivo = false;
    };
  }, [rel, fm.source, fm.sourceHref]);

  const ext = ((materialRel ?? fm.sourceHref ?? "").split(".").pop() ?? "").toLowerCase();
  const comoAbre = ext === "pdf" ? t("abrir PDF") : ext.startsWith("ppt") ? t("abrir apresentação") : t("abrir arquivo");

  return (
    <div className="leitura">
      <article className="leitura-texto">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <h1 className="leitura-titulo" style={{ flex: 1, minWidth: 0 }}>
            {titulo}
          </h1>
          {onRegerar && (
            <button
              className="btn"
              style={{ padding: "3px 10px", fontSize: 11, flex: "0 0 auto" }}
              title={t("Reescreve esta página do zero a partir do material oficial")}
              onClick={() => onRegerar(rel)}
            >
              {t("Regerar")}
            </button>
          )}
        </div>
        {fm.updated && (
          <p className="leitura-data">{tf("atualizado: {data}", { data: fm.updated })}</p>
        )}
        <MarkdownView source={corpo} onAbrir={onAbrir} />
      </article>

      <aside className="leitura-lado">
        <div className="leitura-sticky">
          {fm.source && (
            <section>
              <p className="leitura-rotulo">{t("Material de origem")}</p>
              {materialRel ? (
                <button className="leitura-material" onClick={() => onAbrir(materialRel)}>
                  {ICONE_ARQUIVO}
                  <span style={{ minWidth: 0 }}>
                    <span className="leitura-material-nome">{fm.source}</span>
                    <span className="leitura-material-acao">{comoAbre}</span>
                  </span>
                </button>
              ) : (
                <div className="leitura-material" style={{ cursor: "default" }}>
                  {ICONE_ARQUIVO}
                  <span className="leitura-material-nome" style={{ color: "var(--c-muted)" }}>
                    {fm.source}
                  </span>
                </div>
              )}
            </section>
          )}

          {indice.length > 0 && (
            <section>
              <p className="leitura-rotulo">{t("Conteúdo")}</p>
              <nav className="leitura-indice">
                {indice.map((h, i) => (
                  <a
                    key={`${h.id}-${i}`}
                    href={`#${h.id}`}
                    data-nivel={h.nivel}
                    onClick={(e) => {
                      // Âncora de verdade não existe: o Tiptap não põe id nos
                      // títulos. Rola procurando pelo texto, que é o que a
                      // pessoa vê.
                      e.preventDefault();
                      const alvos = document.querySelectorAll(".leitura-texto h2, .leitura-texto h3");
                      for (const el of Array.from(alvos)) {
                        if (el.textContent?.trim() === h.texto) {
                          el.scrollIntoView({ behavior: "smooth", block: "start" });
                          return;
                        }
                      }
                    }}
                  >
                    {h.texto}
                  </a>
                ))}
              </nav>
            </section>
          )}

          {irmas.length > 0 && (
            <section>
              <p className="leitura-rotulo">{t("Outras aulas")}</p>
              <nav className="leitura-irmas">
                {irmas.map((s) => (
                  <button key={s.rel} onClick={() => onAbrir(s.rel)} title={s.rel}>
                    <span style={{ opacity: 0.5 }}>›</span>
                    <span className="truncar">{s.nome.replace(/\.md$/, "")}</span>
                  </button>
                ))}
              </nav>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
