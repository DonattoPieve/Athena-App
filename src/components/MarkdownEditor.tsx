import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import { api, mensagemDeErro } from "../lib/api";
import { athenaExtensions, toEditor, toMarkdown } from "../lib/markdown";
import { Toolbar } from "./Toolbar";
import { LinkPicker } from "./LinkPicker";
import { ContextMenu, useContextMenu, type MenuItem } from "./ContextMenu";
import { t } from "../lib/i18n";

/** Extensao do arquivo a partir do MIME da area de transferencia. */
function extDe(mime: string): string {
  const e = mime.split("/")[1]?.toLowerCase() ?? "png";
  return e === "jpeg" ? "jpg" : e.replace(/[^a-z0-9]/g, "") || "png";
}

/**
 * A superficie de edicao, sem saber de onde o texto veio.
 *
 * Nota nova e nota existente usam este mesmo componente: o que muda entre as
 * duas e onde o markdown e gravado, nao como ele e escrito. `value` e sempre
 * markdown — nunca HTML —, porque e isso que vai para o disco.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  imageBase,
}: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder: string;
  /** Prefixo do nome da imagem colada (slug da aula). */
  imageBase: string;
}) {
  const [raw, setRaw] = useState(false);
  const [linking, setLinking] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const menu = useContextMenu();

  const baseRef = useRef(imageBase);
  baseRef.current = imageBase || "colada";

  /** Ultimo markdown que SAIU daqui — para nao reescrever o editor com o
   *  proprio texto a cada tecla (o que perderia o cursor). */
  const emitido = useRef<string | null>(null);

  /**
   * Imagem colada (ou arrastada) vai para `Notes/attachments/`, primeiro lugar
   * onde o passo 1 do CLAUDE.md procura ao ver `![[arquivo]]`. Base64 dentro
   * do .md seria mais facil e quebraria o ingest, que precisa ABRIR a imagem.
   *
   * Insere pelo `view` do evento, nao por referencia guardada ao editor: em
   * dev o StrictMode monta duas vezes e a primeira instancia morre.
   */
  async function guardarImagem(view: EditorView, file: File) {
    const data = new Uint8Array(await file.arrayBuffer());
    const nome = await api.fs.pasteImage(baseRef.current, extDe(file.type), data);
    if (view.isDestroyed) return;
    const tipo = view.state.schema.nodes.image;
    if (!tipo) throw new Error(t("Extensão de imagem ausente em athenaExtensions()."));
    const node = tipo.create({
      src: `athena://file/Notes/attachments/${encodeURIComponent(nome)}`,
      alt: nome,
    });
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  }

  function imagemDe(dt: DataTransfer | null): File | null {
    if (!dt) return null;
    const doFiles = Array.from(dt.files ?? []).find((f) => f.type.startsWith("image/"));
    if (doFiles) return doFiles;
    for (const item of Array.from(dt.items ?? [])) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
    return null;
  }

  const editor = useEditor({
    extensions: athenaExtensions(placeholder),
    content: toEditor(value),
    editorProps: {
      attributes: { class: "prose" },
      handlePaste: (view, event) => {
        const img = imagemDe(event.clipboardData);
        if (!img) return false; // texto segue o caminho normal (markdown colado)
        event.preventDefault();
        void guardarImagem(view, img).catch((e) => setErro(mensagemDeErro(e)));
        return true;
      },
      handleDrop: (view, event) => {
        const img = imagemDe((event as DragEvent).dataTransfer);
        if (!img) return false;
        event.preventDefault();
        void guardarImagem(view, img).catch((e) => setErro(mensagemDeErro(e)));
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const md = toMarkdown(editor);
      emitido.current = md;
      onChange(md);
    },
  });

  // Texto trocado por fora (abriu outro arquivo, recarregou do disco).
  useEffect(() => {
    if (!editor || value === emitido.current) return;
    emitido.current = value;
    editor.commands.setContent(toEditor(value));
  }, [editor, value]);

  function itensDoEditor(): MenuItem[] {
    const e = editor;
    const temSelecao = !!e && !e.state.selection.empty;
    return [
      { label: t("Recortar"), hint: "Ctrl+X", disabled: !temSelecao, onClick: () => document.execCommand("cut") },
      { label: t("Copiar"), hint: "Ctrl+C", disabled: !temSelecao, onClick: () => document.execCommand("copy") },
      {
        label: t("Colar"),
        hint: "Ctrl+V",
        onClick: async () => {
          const texto = await api.clipboard.read();
          if (texto) e?.chain().focus().insertContent(texto).run();
        },
      },
      { kind: "sep" },
      { label: t("Negrito"), hint: "Ctrl+B", disabled: !temSelecao, onClick: () => e?.chain().focus().toggleBold().run() },
      { label: t("Itálico"), hint: "Ctrl+I", disabled: !temSelecao, onClick: () => e?.chain().focus().toggleItalic().run() },
      { label: t("Código"), disabled: !temSelecao, onClick: () => e?.chain().focus().toggleCode().run() },
      { kind: "sep" },
      { label: t("Link para aula…"), hint: "[[ ]]", onClick: () => setLinking(true) },
      {
        label: t("Tabela 3×3"),
        onClick: () => e?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
    ];
  }

  function alternarModo() {
    // Voltando do markdown cru: o editor precisa reler o texto editado a mao.
    if (raw && editor) {
      emitido.current = value;
      editor.commands.setContent(toEditor(value));
    }
    setRaw((r) => !r);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex" }}>
        <button
          className="btn"
          style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 11 }}
          data-active={raw}
          onClick={alternarModo}
          title={t("Ver e editar o markdown exatamente como vai para o disco")}
        >
          markdown
        </button>
      </div>

      {raw ? (
        <textarea
          className="field mono-edit"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            emitido.current = e.target.value;
            onChange(e.target.value);
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
            if (raw) onChange(`${value}[[${slug}]]`);
            else editor?.chain().focus().insertContent(`[[${slug}]]`).run();
          }}
        />
      )}

      {erro && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
      <ContextMenu state={menu.state} onClose={menu.close} />
    </div>
  );
}
