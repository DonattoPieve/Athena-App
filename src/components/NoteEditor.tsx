import { useEffect, useState } from "react";
import { api, mensagemDeErro, type SubjectRef } from "../lib/api";
import { MarkdownEditor } from "./MarkdownEditor";

const PLACEHOLDER =
  "Escreva a nota da aula. O material oficial continua sendo a fonte principal — isto orienta o foco.";

/**
 * Nota NOVA. Escolhe matéria e título, grava em raw/subjects/<MATERIA>/.
 * A edição de nota que já existe é o FileEditor — aqui o assunto é criar.
 */
export function NoteEditor({
  subjects,
  onSaved,
  onIngest,
}: {
  subjects: SubjectRef[];
  onSaved: () => void;
  onIngest: (code: string, lesson: string) => void;
}) {
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [slug, setSlug] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!folder && subjects[0]) setFolder(subjects[0].folder);
  }, [subjects, folder]);

  useEffect(() => {
    if (!title) return setSlug("");
    api.fs.slug(title).then(setSlug);
  }, [title]);

  const ready = !!folder && !!title.trim();

  async function save() {
    setError(null);
    try {
      await api.fs.write(`raw/subjects/${folder}/${title.trim()}.md`, body);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(mensagemDeErro(e));
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="label">Nova nota</span>

      <div style={{ display: "flex", gap: 8 }}>
        <select
          className="field"
          style={{ maxWidth: 240 }}
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        >
          {subjects.length === 0 && <option value="">Nenhuma matéria em raw/subjects</option>}
          {subjects.map((s) => (
            <option key={s.folder} value={s.folder}>
              {s.folder}
            </option>
          ))}
        </select>
        <input
          className="field"
          placeholder="Título da aula (com acento, como o professor chamou)"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved(false);
          }}
        />
      </div>

      {slug && (
        <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>
          Vira <code style={{ color: "var(--c-accent)" }}>{slug}.md</code> na wiki
        </p>
      )}

      <MarkdownEditor
        value={body}
        onChange={(md) => {
          setBody(md);
          setSaved(false);
        }}
        placeholder={PLACEHOLDER}
        imageBase={slug}
      />

      {error && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn" disabled={!ready} onClick={save}>
          Salvar nota
        </button>
        <button
          className="btn btn-primary"
          disabled={!ready || !saved}
          onClick={() => onIngest(folder.split("-")[0], slug)}
          title={saved ? "Gera a página desta aula" : "Salve a nota antes"}
        >
          Gerar página
        </button>
        {saved && (
          <span style={{ color: "#1d9e75", fontSize: 12 }}>salva em raw/subjects/{folder}</span>
        )}
      </div>
    </div>
  );
}
