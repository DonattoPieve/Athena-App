import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { api, mensagemDeErro } from "../lib/api";
import { athenaExtensions, splitFrontmatter, toLeitura } from "../lib/markdown";
import { tf } from "../lib/i18n";

/**
 * Leitura de uma nota. Mesmo pipeline do editor, com `editable: false` —
 * o que você lê aqui é o que o site renderiza, com a mesma folha de estilo.
 *
 * Os `[[wikilinks]]` viram links de verdade (`athena-wiki:slug`) e são
 * resolvidos no clique: o alvo é procurado em `Resumos/subjects/` e abre numa
 * aba. Link órfão avisa em vez de abrir nada.
 */
export function MarkdownView({
  source,
  onAbrir,
}: {
  source: string;
  onAbrir?: (rel: string) => void;
}) {
  const { front, body: cru } = splitFrontmatter(source);
  const body = toLeitura(cru);

  const editor = useEditor({
    extensions: athenaExtensions(""),
    content: body,
    editable: false,
    editorProps: { attributes: { class: "prose" } },
  });

  useEffect(() => {
    editor?.commands.setContent(body);
  }, [editor, body]);

  /**
   * Um handler no container, não um por link: o conteúdo é reconstruído a
   * cada troca de arquivo e prender listener em cada <a> vazaria.
   */
  async function aoClicar(e: React.MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href");
    if (!href) return;
    e.preventDefault();

    if (href.startsWith("athena-wiki:")) {
      const slug = decodeURIComponent(href.slice("athena-wiki:".length));
      try {
        const rel = await api.fs.resolveLink(slug);
        if (rel) onAbrir?.(rel);
        else alert(tf("Não existe página para [[{slug}]] — link órfão.", { slug }));
      } catch (err) {
        alert(mensagemDeErro(err));
      }
      return;
    }
    // Link externo abre no navegador do sistema, não dentro da janela.
    if (/^https?:/.test(href)) void api.fs.openUrl(href).catch(() => {});
  }

  return (
    <div onClick={aoClicar}>
      {front && (
        <pre className="frontmatter" title="frontmatter YAML">
          {front}
        </pre>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
