import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

/**
 * Seletor de `[[wikilink]]`.
 *
 * Lista as aulas que existem de verdade em `wiki/subjects/`. Digitar o slug de
 * cabeca e como nasce link orfao: `[[interrupcoes]]` quando a pagina se chama
 * `interrupcoes-externas` nao aponta para lugar nenhum, no Obsidian e no site.
 */
export function LinkPicker({
  onPick,
  onClose,
}: {
  onPick: (slug: string) => void;
  onClose: () => void;
}) {
  const [aulas, setAulas] = useState<{ slug: string; subject: string }[]>([]);
  const [filtro, setFiltro] = useState("");

  useEffect(() => {
    api.fs.lessons().then(setAulas).catch(() => setAulas([]));
  }, []);

  const lista = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    const base = f ? aulas.filter((a) => (a.slug + a.subject).toLowerCase().includes(f)) : aulas;
    return base.slice(0, 60);
  }, [aulas, filtro]);

  return (
    <div className="card" style={{ padding: 12, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="label">Link para aula</span>
        <button
          className="btn"
          style={{ marginLeft: "auto", padding: "3px 8px", fontSize: 11 }}
          onClick={onClose}
        >
          fechar
        </button>
      </div>

      <input
        className="field"
        autoFocus
        placeholder="filtrar por slug ou matéria"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && lista[0]) onPick(lista[0].slug);
        }}
      />

      <div className="scroll" style={{ maxHeight: 200, marginTop: 8 }}>
        {lista.length === 0 ? (
          <p style={{ color: "var(--c-muted)", fontSize: 12, margin: "6px 2px" }}>
            {aulas.length === 0 ? "Nenhuma aula publicada ainda." : "Nada com esse filtro."}
          </p>
        ) : (
          lista.map((a) => (
            <button key={a.slug} className="nav-item" onClick={() => onPick(a.slug)}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.slug}
              </span>
              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--c-muted)" }}>
                {a.subject}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
