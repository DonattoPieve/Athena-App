/**
 * Teste de ida e volta do editor: markdown -> Tiptap -> markdown.
 *
 * Existe porque a falha deste editor e SILENCIOSA. Se uma extensao sumir da
 * lista em src/lib/markdown.ts, o conteudo correspondente nao da erro: ele e
 * achatado no salvamento. Sem TableKit, por exemplo, a tabela de registradores
 * vira "BitNomeFuncao0INT0habilita..." — uma linha unica, sem aviso nenhum.
 *
 * Importa o modulo de verdade (o Node 22 tira os tipos sozinho), entao testa a
 * configuracao que o app usa — nao uma copia que envelhece em paralelo.
 *
 * Rodar: npm run test:md
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
global.getComputedStyle = dom.window.getComputedStyle;

const { Editor } = await import("@tiptap/core");
const { athenaExtensions, toEditor, toMarkdown } = await import(
  new URL("../src/lib/markdown.ts", import.meta.url).href
);

const SOURCE = `# Interrupcoes externas

> Materia: [[E09-Microcontroladores]]

Texto com **negrito**, *italico*, \`PORTB\` e [link](https://exemplo.com).

![[quadro-eimsk.png]]

## Registrador EIMSK

| Bit | Nome | Funcao |
| --- | --- | --- |
| 0 | INT0 | habilita a interrupcao externa 0 |
| 1 | INT1 | habilita a interrupcao externa 1 |

- item de lista
- outro item

1. primeiro
2. segundo

- [ ] tarefa aberta
- [x] tarefa feita

\`\`\`c
EICRA |= (1 << ISC01);   // borda de descida
\`\`\`

---

Fim.
`;

const el = dom.window.document.createElement("div");
dom.window.document.body.appendChild(el);
const editor = new Editor({
  element: el,
  extensions: athenaExtensions(""),
  content: toEditor(SOURCE),
});

const out = toMarkdown(editor);

editor.commands.setContent(toEditor(out));
const out2 = toMarkdown(editor);

const checks = [
  ["cabecalho h1", () => out.includes("# Interrupcoes externas")],
  ["cabecalho h2", () => out.includes("## Registrador EIMSK")],
  ["wikilink sem escape", () => out.includes("[[E09-Microcontroladores]]") && !out.includes("\\[\\[")],
  // O embed do Obsidian tem que voltar como embed: `![](athena://...)` no
  // disco seria uma imagem que so o app enxerga, invisivel pro ingest.
  ["imagem volta como ![[embed]]", () => out.includes("![[quadro-eimsk.png]]")],
  ["nenhum athena:// vazou pro disco", () => !out.includes("athena://")],
  ["citacao", () => /^> Materia:/m.test(out)],
  ["negrito e italico", () => out.includes("**negrito**") && out.includes("*italico*")],
  ["codigo inline", () => out.includes("`PORTB`")],
  ["link", () => out.includes("[link](https://exemplo.com)")],
  ["tabela em pipes", () => out.includes("| Bit | Nome | Funcao |")],
  ["linhas da tabela", () => out.includes("| 0 | INT0 | habilita a interrupcao externa 0 |")],
  ["lista com marcador", () => /^- item de lista$/m.test(out)],
  ["lista numerada", () => /^1\. primeiro$/m.test(out)],
  ["tarefas", () => out.includes("- [ ] tarefa aberta") && out.includes("- [x] tarefa feita")],
  ["bloco de codigo com linguagem", () => out.includes("```c")],
  ["linha divisoria", () => /^---$/m.test(out)],
  // Sem isto, abrir e salvar sem editar nada mexeria no arquivo a cada vez.
  ["formato estavel no 2o ciclo", () => out2.trim() === out.trim()],
];

let falhou = false;
for (const [nome, fn] of checks) {
  const ok = fn();
  if (!ok) falhou = true;
  console.log(`${ok ? "ok  " : "FALHA"}  ${nome}`);
}

if (falhou) {
  console.log("\n--- markdown gerado ---\n" + out);
  console.error("\nO editor perdeu conteudo. Confira a lista de extensoes em src/lib/markdown.ts.");
  process.exit(1);
}
console.log("\nIda e volta preservou tudo.");
