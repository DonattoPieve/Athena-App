import { useEffect, useMemo, useState } from "react";
import { api, type TreeNode } from "../lib/api";
import { t, tf } from "../lib/i18n";

/**
 * Meu conteúdo — tudo que existe na wiki, agrupado por matéria.
 *
 * O Explorer da lateral mostra a mesma árvore, mas ele é para navegar dentro
 * de uma pasta. Esta tela responde outra pergunta: *o que eu já tenho?* Por
 * isso ela achata as pastas e conta.
 *
 * A fonte é o disco, não o banco: página recém-gerada aparece aqui antes de
 * ser publicada.
 */

type Pagina = { nome: string; rel: string; materia: string };

/** `wiki/subjects/C09-Computacao-Grafica/x.md` -> `C09 Computacao Grafica` */
function materiaDe(rel: string): string {
  const m = /wiki\/subjects\/([^/]+)\//.exec(rel);
  if (!m) return t("Sem matéria");
  return m[1].replace(/-/g, " ");
}

function achatar(nodes: TreeNode[]): Pagina[] {
  const out: Pagina[] = [];
  const andar = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.dir) andar(n.children ?? []);
      else if (n.name.endsWith(".md")) {
        out.push({ nome: n.name.replace(/\.md$/, ""), rel: n.rel, materia: materiaDe(n.rel) });
      }
    }
  };
  andar(nodes);
  return out;
}

export function MeuConteudo({ onAbrir }: { onAbrir: (rel: string) => void }) {
  const [paginas, setPaginas] = useState<Pagina[] | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    api.fs
      .tree("wiki")
      .then((arvore) => setPaginas(achatar(arvore)))
      .catch(() => setPaginas([]));
  }, []);

  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const mapa = new Map<string, Pagina[]>();
    for (const p of paginas ?? []) {
      if (q && !(p.nome + p.materia).toLowerCase().includes(q)) continue;
      const lista = mapa.get(p.materia) ?? [];
      lista.push(p);
      mapa.set(p.materia, lista);
    }
    return [...mapa.entries()]
      .map(([materia, itens]) => ({
        materia,
        itens: itens.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
      }))
      .sort((a, b) => a.materia.localeCompare(b.materia, "pt-BR"));
  }, [paginas, busca]);

  if (paginas === null) return <div className="card vazio">{t("lendo a wiki…")}</div>;

  return (
    <div className="tela">
      <header className="tela-cabecalho">
        <h1>{t("Meu conteúdo")}</h1>
        <p>{t("Tudo que já virou página na sua wiki.")}</p>
      </header>

      <input
        className="field campo-grande"
        placeholder={t("Filtrar por título ou matéria…")}
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />

      <p className="contagem">
        {tf("{n} páginas em {m} matérias", {
          n: paginas.length,
          m: new Set(paginas.map((p) => p.materia)).size,
        })}
      </p>

      {grupos.length === 0 ? (
        <div className="card vazio">{t("Nada com esse filtro.")}</div>
      ) : (
        grupos.map((g) => (
          <section key={g.materia} className="grupo-materia">
            <p className="label">{g.materia}</p>
            <div className="lista-cartoes">
              {g.itens.map((p) => (
                <button key={p.rel} className="card item-pagina" onClick={() => onAbrir(p.rel)} title={p.rel}>
                  <span className="truncar">{p.nome}</span>
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
