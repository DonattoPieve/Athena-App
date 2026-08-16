/**
 * Print de varias telas de uma vez, sem Electron.
 *
 * Mesma ideia do preview.mjs, com uma ponte falsa mais completa e um clique
 * no icone da barra lateral antes de cada print. Serve para conferir de olho
 * o que mudou em varias telas na mesma passada — depois de mexer em texto de
 * interface, por exemplo.
 *
 *   node scripts/telas.mjs            -> todas
 *   node scripts/telas.mjs config     -> so uma
 *   node scripts/telas.mjs --en       -> as mesmas telas em ingles
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(RAIZ, "dist", "renderer");
const PORTA = 8901;

/** titulo do botao na barra lateral -> nome do arquivo do print */
const TELAS_PT = {
  config: "Configurações",
  glossario: "Glossário",
  comandos: "Comandos do Athena",
  perfil: "Perfil — Teste",
  /** Nao e botao do rail: abre a pagina da wiki pela arvore. */
  leitura: null,
  /** Nao e botao do rail: abre o monitor da sessao pela lupa. */
  serial: null,
};

const TELAS_EN = {
  ...TELAS_PT,
  config: "Settings",
  glossario: "Glossary",
  comandos: "Athena commands",
  perfil: "Profile — Teste",
};

const argv = process.argv.slice(2);
const EN = argv.includes("--en");
const TELAS = EN ? TELAS_EN : TELAS_PT;
const pedidas = argv.filter((a) => a !== "--en");
const alvos = pedidas.length ? pedidas : Object.keys(TELAS);

const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const servidor = createServer(async (req, res) => {
  const rel = (req.url ?? "/").split("?")[0];
  const arq = join(DIST, rel === "/" ? "index.html" : rel);
  try {
    const buf = await readFile(arq);
    res.writeHead(200, { "Content-Type": TIPOS[extname(arq)] ?? "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => servidor.listen(PORTA, ok));

const PAGINA = `---
source: aula-01.pdf
sourceHref: /materials/aula-01.pdf
updated: 2026-08-14
---

# Introducao a linguagem C

C e uma linguagem compilada e de tipagem estatica.

## Ponteiros

Um **ponteiro** guarda um endereco de memoria.

## Memoria

O **heap** e reservado em tempo de execucao.
`;

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 860 } });
if (EN) await pagina.addInitScript(`localStorage.setItem("athena-lang", "en")`);
pagina.on("pageerror", (e) => console.error("[pageerror]", e.message));

await pagina.addInitScript(`
  const nada = () => () => {};
  const vazio = async () => [];
  const arvore = [{
    name: "programacao", rel: "wiki/programacao", dir: true, children: [
      { name: "introducao-a-linguagem-c.md", rel: "wiki/programacao/introducao-a-linguagem-c.md", dir: false },
    ],
  }];
  window.athena = {
    vault: { get: async () => ({ path: "C:\\\\Users\\\\donat\\\\Desktop\\\\Athena", claudeBin: "claude" }),
             pick: async () => ({ path: "" }), onChange: nada },
    config: { setClaudeBin: async () => true },
    win: { close: async () => true, toggleMaximize: async () => true },
    fs: {
      tree: async () => arvore, subjects: vazio, describe: async () => null, lessons: vazio,
      read: async () => ${JSON.stringify(PAGINA)},
      write: async () => {}, slug: async (s) => s, reveal: async () => {}, mkdir: async () => {},
      create: async () => {}, rename: async (r) => r, trash: async () => true,
      openExternal: async () => true, pasteImage: async () => "", resolveLink: async () => null,
      openUrl: async () => true, buscar: vazio,
      home: async () => ({ subjects: [], paginas: [], notas: 0, eventos: [], logConflitado: false }),
      glossario: async () => ([
        { termo: "Ponteiro", contexto: "Variavel que guarda um endereco de memoria.",
          refs: [{ titulo: "Introducao a linguagem C", rel: "wiki/programacao/introducao-a-linguagem-c.md" }] },
        { termo: "Heap", contexto: "Regiao de memoria reservada em tempo de execucao.",
          refs: [{ titulo: "Introducao a linguagem C", rel: "wiki/programacao/introducao-a-linguagem-c.md" }] },
      ]),
    },
    clipboard: { read: async () => "", write: async () => true },
    account: {
      status: async () => ({ id: "1", name: "Teste", email: "donatto@gec.inatel.br" }),
      login: async () => ({}), signUp: async () => null, oauth: async () => ({}),
      oauthCancel: async () => true, avatarPick: async () => null, avatarRemove: async () => ({}),
      assumirVault: async () => true, logout: async () => true, update: async () => ({ pendente: false }),
    },
    session: {
      snapshot: async () => ({
        state: null, queue: [], authNeeded: false,
        lines: [
          { n: 1, level: "log", text: "$ athena generate programacao/introducao-a-linguagem-c" },
          { n: 2, level: "tool", text: "  lendo raw/programacao/aula-01.pdf" },
          { n: 3, level: "assistant", text: "Pagina gerada." },
          { n: 4, level: "log", text: "OK" },
        ],
      }),
      start: async () => ({}), reply: async () => {}, cancel: async () => {},
      clear: async () => true, onEvent: nada,
    },
    publish: { available: async () => ({ publish: true, pull: true }), run: async () => ({ ok: true, output: "", canForce: false }),
               onLine: nada, onState: nada, autoPublish: async () => true, autoPull: async () => true },
    status: { get: async () => "OK", onChange: nada },
    claude: { openLogin: async () => true,
              whoami: async () => ({ email: "donattopieve1@gmail.com", org: null, arquivo: "C:\\\\Users\\\\donat\\\\.claude.json", existe: true }) },
  };
`);

await pagina.goto(`http://127.0.0.1:${PORTA}/`);
await pagina.waitForTimeout(1200);

for (const chave of alvos) {
  if (!(chave in TELAS)) {
    console.error(`tela desconhecida: ${chave}`);
    continue;
  }
  const titulo = TELAS[chave];
  if (chave === "serial") {
    await pagina.locator(".lupa-sessao").click();
  } else if (titulo === null) {
    // As pastas comecam fechadas: abre a materia antes de achar a aula.
    await pagina.getByText("programacao", { exact: true }).first().click();
    await pagina.waitForTimeout(200);
    await pagina.getByText("introducao-a-linguagem-c", { exact: false }).first().click();
  } else {
    await pagina.locator(`.rail button[title^="${titulo}"]`).click();
  }
  await pagina.waitForTimeout(600);
  const caminho = `/tmp/tela-${chave}${EN ? "-en" : ""}.png`;
  await pagina.screenshot({ path: caminho, fullPage: false });
  console.log(caminho);
}

await navegador.close();
servidor.close();
