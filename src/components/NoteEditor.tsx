import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { api, type SubjectRef } from "../lib/api";
import { athenaExtensions, toEditor, toMarkdown } from "../lib/markdown";
import { Toolbar } from "./Toolbar";
import { LinkPicker } from "./LinkPicker";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";

/** Extensao do arquivo a partir do MIME da area de transferencia. */
function extDe(mime: string): string {
  const e = mime.split("/")[1]?.toLowerCase() ?? "png";
  return e === "jpeg" ? "jpg" : e.replace(/[^a-z0-9]/g, "") || "png";
}

const PLACEHOLDER =
  "Escreva a nota da aula. O material oficial continua sendo a fonte principal — isto orienta o foco.";

/**
 * Editor da nota crua — Tiptap (WYSIWYG) por cima de markdown.
 *
 * O que vai para o disco continua sendo `.md`: `body` e sempre markdown
 * serializado, nunca HTML — o passo 1 do CLAUDE.md depende disso. O modo
 * "markdown" mostra exatamente o texto que sera gravado, util para conferir
 * antes de salvar e para colar nota pronta de outro lugar.
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
  const [raw, setRaw] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menu = useContextMenu();

  // O handlePaste roda dentro do ProseMirror, antes do editor existir na
  // closure — a ref e a ponte entre os dois.
  const editorRef = useRef<Editor | null>(null);
  const baseRef = useRef("colada");

  /**
   * Imagem colada (ou arrastada) vai para `raw/attachments/`, que e o primeiro
   * lugar onde o passo 1 do CLAUDE.md procura ao ver `![[arquivo]]`. Salvar em
   * base64 dentro do .md seria mais facil e quebraria o ingest: ele precisa
   * ABRIR a imagem para descrever o que ela ensina.
   */
  async function guardarImagem(file: File) {
    const data = new Uint8Array(await file.arrayBuffer());
    const nome = await api.fs.pasteImage(baseRef.current, extDe(file.type), data);
    editorRef.current
      ?.chain()
      .focus()
      .setImage({
        src: `athena://file/raw/attachments/${encodeURIComponent(nome)}`,
        alt: nome,
      })
      .run();
  }

  function imagemDe(dt: DataTransfer | null): File | null {
    const files = Array.from(dt?.files ?? []);
    return files.find((f) => f.type.startsWith("image/")) ?? null;
  }

  const editor = useEditor({
    extensions: athenaExtensions(PLACEHOLDER),
    content: "",
    editorProps: {
      attributes: { class: "prose" },
      handlePaste: (_view, event) => {
        const img = imagemDe(event.clipboardData);
        if (!img) return false; // texto segue o caminho normal (markdown colado)
        event.preventDefault();
        void guardarImagem(img).catch((e) => setError((e as Error).message));
        return true;
      },
      handleDrop: (_view, event) => {
        const img = imagemDe((event as DragEvent).dataTransfer);
        if (!img) return false;
        event.preventDefault();
        void guardarImagem(img).catch((e) => setError((e as Error).message));
        return true;
      },
    },
    onCreate: ({ editor }) => {
      editorRef.current = editor;
    },
    onUpdate: ({ editor }) => {
      setBody(toMarkdown(editor));
      setSaved(false);
    },
  });

  /** Menu do botao direito dentro do texto. */
  function itensDoEditor(): MenuItem[] {
    const e = editorRef.current;
    const temSelecao = !!e && !e.state.selection.empty;
    return [
      {
        label: "Recortar",
        hint: "Ctrl+X",
        disabled: !temSelecao,
        onClick: () => document.execCommand("cut"),
      },
      {
        label: "Copiar",
        hint: "Ctrl+C",
        disabled: !temSelecao,
        onClick: () => document.execCommand("copy"),
      },
      {
        label: "Colar",
        hint: "Ctrl+V",
        onClick: async () => {
          const texto = await api.clipboard.read();
          if (texto) e?.chain().focus().insertContent(texto).run();
        },
      },
      { kind: "sep" },
      {
        label: "Negrito",
        hint: "Ctrl+B",
        disabled: !temSelecao,
        onClick: () => e?.chain().focus().toggleBold().run(),
      },
      {
        label: "Itálico",
        hint: "Ctrl+I",
        disabled: !temSelecao,
        onClick: () => e?.chain().focus().toggleItalic().run(),
      },
      {
        label: "Código",
        disabled: !temSelecao,
        onClick: () => e?.chain().focus().toggleCode().run(),
      },
      { kind: "sep" },
      { label: "Link para aula…", hint: "[[ ]]", onClick: () => setLinking(true) },
      {
        label: "Tabela 3×3",
        onClick: () => e?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
    ];
  }

  useEffect(() => {
    if (!folder && subjects[0]) setFolder(subjects[0].folder);
  }, [subjects, folder]);

  useEffect(() => {
    if (!title) {
      baseRef.current = "colada";
      return setSlug("");
    }
    api.fs.slug(title).then((s) => {
      setSlug(s);
      // Imagem colada herda o nome da aula: `interrupcoes-externas-2.png` diz
      // de onde veio, `colada-3.png` nao diz nada seis meses depois.
      baseRef.current = s || "colada";
    });
  }, [title]);

  const ready = !!folder && !!title.trim();

  /** Trocar de modo sincroniza os dois lados a partir do markdown. */
  function toggleRaw() {
    if (raw) editor?.commands.setContent(toEditor(body));
    setRaw((r) => !r);
  }

  async function save() {
    setError(null);
    try {
      await api.fs.write(`raw/subjects/${folder}/${title.trim()}.md`, body);
      setSaved(true);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="label">Nova nota</span>
        <button
          className="btn"
          style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11 }}
          data-active={raw}
          onClick={toggleRaw}
          title="Ver e editar o markdown exatamente como vai para o disco"
        >
          markdown
        </button>
      </div>

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

      {raw ? (
        <textarea
          className="field mono-edit"
          value={body}
          placeholder={PLACEHOLDER}
          onChange={(e) => {
            setBody(e.target.value);
            setSaved(false);
          }}
        />
      ) : (
        <div className="editor-shell" onContextMenu={(e) => menu.open(e, itensDoEditor())}>
          {editor && <Toolbar editor={editor} onLink={() => setLinking(true)} />}
          <EditorContent editor={editor} />
        </div>
      )}

      {linking && (
        <LinkPicker
          onClose={() => setLinking(false)}
          onPick={(slug) => {
            setLinking(false);
            if (raw) {
              setBody((b) => `${b}[[${slug}]]`);
              setSaved(false);
            } else {
              editorRef.current?.chain().focus().insertContent(`[[${slug}]]`).run();
            }
          }}
        />
      )}

      <ContextMenu state={menu.state} onClose={menu.close} />

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
