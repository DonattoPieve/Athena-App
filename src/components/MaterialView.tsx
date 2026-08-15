import { useState } from "react";
import { api } from "../lib/api";

/**
 * Visualizador do material oficial.
 *
 * PDF abre embutido: o Chromium do Electron ja tem leitor de PDF, entao a
 * fonte da aula fica ao lado da nota em vez de num programa separado.
 * O arquivo chega pelo esquema athena:// — `file://` dentro de uma janela
 * servida em http (o dev do Vite) e barrado pelo navegador.
 *
 * PPT nao tem leitor no Chromium. Em vez de fingir com uma conversao fragil,
 * abre no PowerPoint do sistema, que renderiza animacao, fonte e layout do
 * jeito que o professor fez.
 */
export function MaterialView({ rel }: { rel: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const nome = rel.split("/").pop() ?? rel;
  const ext = (nome.split(".").pop() ?? "").toLowerCase();
  const url = `athena://file/${rel.split("/").map(encodeURIComponent).join("/")}`;

  async function abrirFora() {
    setErro(null);
    try {
      await api.fs.openExternal(rel);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="label">Material</span>
        <code style={{ color: "var(--c-accent)", fontSize: 12 }}>{nome}</code>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn" style={{ padding: "4px 10px", fontSize: 11 }} onClick={abrirFora}>
            Abrir no programa padrão
          </button>
          <button
            className="btn"
            style={{ padding: "4px 10px", fontSize: 11 }}
            onClick={() => api.fs.reveal(rel)}
          >
            Revelar no Explorer
          </button>
        </div>
      </div>

      {ext === "pdf" ? (
        <div className="viewer">
          <iframe src={url} title={nome} />
        </div>
      ) : (
        <div
          className="viewer"
          style={{ display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}
        >
          <div>
            <p style={{ margin: "0 0 6px", fontWeight: 500 }}>
              {ext === "pptx" || ext === "ppt" ? "Apresentação do professor" : `Arquivo .${ext}`}
            </p>
            <p style={{ margin: "0 0 16px", color: "var(--c-muted)", fontSize: 12, maxWidth: 420 }}>
              O leitor embutido só renderiza PDF. Este arquivo abre no programa padrão do Windows,
              que mostra fonte, layout e animação como o professor montou.
            </p>
            <button className="btn btn-primary" onClick={abrirFora}>
              Abrir {nome}
            </button>
          </div>
        </div>
      )}

      {erro && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
    </div>
  );
}
