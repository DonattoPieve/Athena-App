import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, parseSelection, type TreeNode } from "../lib/api";
import { t, tf } from "../lib/i18n";

/**
 * Escolher QUAL página regerar.
 *
 * Antes o "Regerar do zero" agia sobre o que estivesse selecionado na árvore —
 * ou seja, sobre a última coisa em que você clicou, que quase nunca é a que
 * você quer refazer. Escolher a página é uma decisão, e decisão pede uma tela.
 *
 * Lista só aula: MOC é índice e `-review` é exercício; regerar qualquer um dos
 * dois não é o que "refazer a página" significa.
 */
export type Alvo = { rel: string; code: string; lesson: string; nome: string };

function achatar(nodes: TreeNode[]): Alvo[] {
  const saida: Alvo[] = [];
  const andar = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.dir) {
        andar(n.children ?? []);
        continue;
      }
      if (!n.name.endsWith(".md")) continue;
      const slug = n.name.slice(0, -3);
      const pasta = n.rel.split("/").slice(-2)[0];
      if (slug === pasta || slug.endsWith("-review")) continue;
      const alvo = parseSelection(n.rel);
      if (!alvo?.lesson) continue;
      saida.push({ rel: n.rel, code: alvo.code, lesson: alvo.lesson, nome: slug });
    }
  };
  andar(nodes);
  return saida.sort((a, b) => a.rel.localeCompare(b.rel, "pt"));
}

export function SeletorPagina({
  titulo,
  aviso,
  onEscolher,
  onFechar,
}: {
  titulo: string;
  aviso?: string;
  onEscolher: (a: Alvo) => void;
  onFechar: () => void;
}) {
  const [paginas, setPaginas] = useState<Alvo[] | null>(null);
  const [busca, setBusca] = useState("");
  const [i, setI] = useState(0);
  const listaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.fs
      .tree("Resumos")
      .then((arvore) => setPaginas(achatar(arvore)))
      .catch(() => setPaginas([]));
  }, []);

  const achados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const todas = paginas ?? [];
    if (!q) return todas;
    return todas.filter((p) => (p.nome + " " + p.code).toLowerCase().includes(q));
  }, [paginas, busca]);

  useEffect(() => setI(0), [busca]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onFechar();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setI((n) => Math.min(achados.length - 1, n + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      }
      if (e.key === "Enter" && achados[i]) onEscolher(achados[i]);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [achados, i, onEscolher, onFechar]);

  // Mantém a linha marcada à vista quando se navega pelo teclado.
  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>('[data-marcado="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [i]);

  // Portal pelo mesmo motivo do monitor da sessao: modal nao pode depender do
  // contexto de empilhamento de quem o abriu.
  return createPortal(
    <div className="modal-backdrop" onClick={onFechar}>
      <div
        className="card modal seletor"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={titulo}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span className="label">{titulo}</span>
          <button
            className="btn"
            style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}
            onClick={onFechar}
          >
            {t("Cancelar")}
          </button>
        </div>

        {aviso && (
          <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "var(--c-muted)" }}>{aviso}</p>
        )}

        <input
          className="field"
          autoFocus
          placeholder={t("Filtrar…  ↑↓ Enter Esc")}
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        <div className="scroll seletor-lista" ref={listaRef}>
          {paginas === null ? (
            <p className="seletor-vazio">{t("lendo a wiki…")}</p>
          ) : achados.length === 0 ? (
            <p className="seletor-vazio">
              {paginas.length === 0 ? t("Nenhuma página na wiki ainda.") : tf("Nada com “{q}”.", { q: busca })}
            </p>
          ) : (
            achados.map((p, n) => (
              <button
                key={p.rel}
                className="seletor-item"
                data-marcado={n === i}
                onMouseEnter={() => setI(n)}
                onClick={() => onEscolher(p)}
                title={p.rel}
              >
                <span className="item-codigo">{p.code}</span>
                <span className="truncar">{p.nome}</span>
              </button>
            ))
          )}
        </div>

      </div>
    </div>,
    document.body,
  );
}
