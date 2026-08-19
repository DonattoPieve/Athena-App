import { mergeAttributes, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Image from "@tiptap/extension-image";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

/**
 * Bloco de codigo colorido, com a linguagem visivel.
 *
 * O `data-lang` no <pre> e o que permite o CSS escrever a etiqueta ("c",
 * "python") no canto do bloco — sem ele, so o autor da nota sabe em que
 * linguagem aquilo esta. As cores sao as mesmas do athena-web (VS Code
 * Dark+), aplicadas pelas classes .hljs-* que o lowlight gera.
 */
const CodeBlock = CodeBlockLowlight.extend({
  renderHTML({ node, HTMLAttributes }) {
    const lang = node.attrs.language as string | null;
    return [
      "pre",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, lang ? { "data-lang": lang } : {}),
      ["code", { class: lang ? `language-${lang}` : null }, 0],
    ];
  },
}).configure({ lowlight });

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
    // codeBlock desligado no kit: o nosso e o mesmo no ("codeBlock"), com
    // realce e etiqueta de linguagem. Dois registrando o mesmo nome quebra.
    StarterKit.configure({
      codeBlock: false,
      // Sem declarar o protocolo, o sanitizador do Link joga fora o href do
      // wikilink e ele vira texto sem clique.
      link: { protocols: ["athena-wiki"] },
    }),
    CodeBlock,
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
 * arquivo em `Notes/attachments/` — entao e esse o formato que grava. Dentro do
 * editor isso vira uma URL que o Chromium sabe carregar. As duas funcoes
 * abaixo sao inversas: mudar uma exige mudar a outra.
 */
const ATTACH_DIR = "Notes/attachments";

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

/**
 * `[[aula|Titulo]]` vira link clicavel — SO NA LEITURA.
 *
 * No editor isto nao pode acontecer: o wikilink e texto que precisa voltar
 * igual para o disco, e virar link o transformaria em `[Titulo](...)` no
 * salvamento. Por isso a conversao mora aqui e nao em toEditor().
 *
 * O `!` na frente e embed de imagem e ja foi tratado antes — dai o lookbehind.
 */
export function toLeitura(md: string): string {
  return toEditor(md).replace(
    /(?<!!)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (_m, alvo: string, titulo?: string) =>
      `[${(titulo ?? alvo).trim()}](athena-wiki:${encodeURIComponent(alvo.trim())})`,
  );
}

/** Separa o frontmatter YAML do corpo — o editor renderiza so o corpo. */
export function splitFrontmatter(md: string): { front: string | null; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { front: null, body: md };
  return { front: m[1], body: md.slice(m[0].length) };
}
