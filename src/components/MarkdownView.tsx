import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { athenaExtensions, splitFrontmatter, toEditor } from "../lib/markdown";

/**
 * Leitura de uma nota. Mesmo pipeline do editor, com `editable: false` —
 * o que voce le aqui e o que o site renderiza, com a mesma folha de estilo.
 */
export function MarkdownView({ source }: { source: string }) {
  const { front, body: cru } = splitFrontmatter(source);
  // Imagem da nota (`![[x.png]]`) e da pagina gerada (`/attachments/...`)
  // viram URL que a janela consegue carregar.
  const body = toEditor(cru);

  const editor = useEditor({
    extensions: athenaExtensions(""),
    content: body,
    editable: false,
    editorProps: { attributes: { class: "prose" } },
  });

  useEffect(() => {
    editor?.commands.setContent(body);
  }, [editor, body]);

  return (
    <>
      {front && (
        <pre className="frontmatter" title="frontmatter YAML">
          {front}
        </pre>
      )}
      <EditorContent editor={editor} />
    </>
  );
}
