import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "tiptap-markdown";

/**
 * MARKDOWN E A FONTE DA VERDADE
 * -----------------------------
 * O Tiptap e so a superficie de edicao. O que vai para o disco continua sendo
 * `.md`, porque o passo 1 do CLAUDE.md procura a nota crua por nome de arquivo
 * e o ingest le markdown. Nada de HTML no vault.
 *
 * A lista de extensoes nao e decorativa: **o que nao estiver aqui e perdido no
 * salvamento**. Sem TableKit, uma tabela de registradores vira uma linha unica
 * de texto colado ("BitNomeFuncao0INT0..."). Antes de remover qualquer
 * extensao, rode `npm run test:md`.
 */
export function athenaExtensions(placeholder: string) {
  return [
    StarterKit,
    // Tabela de bits e o formato nativo das notas de E09 — obrigatorio.
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Imagem colada. `athena://` porque a janela roda em http no dev e o
    // Chromium recusa file:// vindo dessa origem.
    //
    // `inline: true` nao e detalhe: como bloco, o serializador escrevia o
    // embed sem separacao e a imagem saia colada no que vinha depois
    // (`![[quadro.png]]## Registrador`), que no ciclo seguinte virava um
    // cabecalho escapado. Dentro de um paragrafo, o markdown sai certo.
    Image.configure({ inline: true, allowBase64: false }),
    Placeholder.configure({ placeholder }),
    Markdown.configure({
      html: false, // vault e markdown puro; HTML nao entra
      tightLists: true,
      transformPastedText: true, // colar markdown vira formatacao de verdade
    }),
  ];
}

/**
 * O serializador escapa colchetes, e `\[\[aula\]\]` NAO e wikilink para o
 * Obsidian nem para o site — vira texto morto e o no some do grafo. Como o
 * vault inteiro depende de `[[...]]`, desfazemos esse escape especifico.
 */
export function unescapeWikilinks(md: string): string {
  return md.replace(/\\\[\\\[/g, "[[").replace(/\\\]\\\]/g, "]]");
}

/**
 * IMAGEM: `![[arquivo.png]]` no disco, athena:// na tela.
 * -------------------------------------------------------
 * O CLAUDE.md §150 manda a nota crua usar o embed do Obsidian e procura o
 * arquivo em `raw/attachments/` — entao e esse o formato que grava. Dentro do
 * editor isso vira uma URL que o Chromium sabe carregar. As duas funcoes
 * abaixo sao inversas: mudar uma exige mudar a outra.
 */
const ATTACH_DIR = "raw/attachments";

export function embedsParaSrc(md: string): string {
  return md.replace(/!\[\[([^\]]+?)\]\]/g, (_m, nome: string) => {
    const src = `athena://file/${ATTACH_DIR}/${encodeURIComponent(nome.trim())}`;
    return `![${nome.trim()}](${src})`;
  });
}

export function srcParaEmbeds(md: string): string {
  const re = new RegExp(`!\\[[^\\]]*\\]\\(athena://file/${ATTACH_DIR}/([^)]+)\\)`, "g");
  return md.replace(re, (_m, nome: string) => `![[${decodeURIComponent(nome)}]]`);
}

/** O tiptap-markdown nao declara o tipo do proprio storage no `Storage` do v3. */
type MarkdownStorage = { markdown: { getMarkdown(): string } };

/** Markdown pronto para o disco: sem escape de wikilink, com embed do Obsidian. */
export function toMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as MarkdownStorage;
  return srcParaEmbeds(unescapeWikilinks(storage.markdown.getMarkdown()));
}

/**
 * As paginas GERADAS usam caminho absoluto do site (`/attachments/...`), que
 * dentro da janela apontaria para lugar nenhum. Na leitura, aponta pra copia
 * local — a mesma pasta que alimenta o upload pro R2.
 */
export function siteAssetsParaSrc(md: string): string {
  return md.replace(
    /!\[([^\]]*)\]\(\/(attachments|materials)\/([^)]+)\)/g,
    (_m, alt: string, tipo: string, resto: string) =>
      `![${alt}](athena://file/athena-web/public/${tipo}/${encodeURI(resto)})`,
  );
}

/** Markdown do disco pronto para o editor. */
export function toEditor(md: string): string {
  return siteAssetsParaSrc(embedsParaSrc(md));
}

/** Separa o frontmatter YAML do corpo — o editor renderiza so o corpo. */
export function splitFrontmatter(md: string): { front: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { front: null, body: md };
  return { front: m[1], body: md.slice(m[0].length) };
}
