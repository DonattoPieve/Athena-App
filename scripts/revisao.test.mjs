/**
 * A fila de revisão da Home — quais páginas entram, e de que data.
 *
 *   npm run test:revisao
 *
 * A regra que este teste protege é a data. Ela vinha do mtime do arquivo, e
 * mtime é "quando este disco escreveu", não "quando a página foi gerada": o
 * `pull` reescreve tudo ao recriar o vault, copiar a pasta faz o mesmo, e o
 * sync de nuvem também. A Home passou a jurar que seis aulas de julho tinham
 * sido "geradas hoje" — apagando exatamente a informação que a fila existe
 * para dar, que é o que está velho.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Vault } from "../electron/vault.ts";
import { revisao } from "../electron/usage.ts";

const WIKI = "Resumos/subjects/C09-Computacao-Grafica";

let falhas = 0;
async function caso(nome, fn) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "athena-revisao-"));
  const criar = (rel, texto) => {
    const p = path.join(raiz, ...rel.split("/"));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, texto, "utf8");
    return p;
  };
  try {
    await fn({ vault: new Vault(raiz), criar });
    console.log(`  ok  ${nome}`);
  } catch (e) {
    falhas++;
    console.error(`  FALHOU  ${nome}\n        ${e.message}`);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

const pagina = (data, titulo) =>
  `---\nupdated: ${data}\nsource: "x.pdf"\n---\n\n# ${titulo}\n\ntexto\n`;

console.log("\nfila de revisão — teste\n");

await caso("a data vem do updated da página, não do mtime", async ({ vault, criar }) => {
  const p = criar(`${WIKI}/compressao.md`, pagina("2026-07-17", "Compressão de Imagens"));
  // Arquivo tocado agora, como o `pull` faz — a página continua sendo de julho.
  fs.utimesSync(p, new Date(), new Date());

  const [r] = await revisao(vault);
  assert.equal(r.titulo, "Compressão de Imagens");
  assert.equal(r.geradaEm.slice(0, 10), "2026-07-17", `veio ${r.geradaEm}`);
});

await caso("sem updated no texto, cai no mtime", async ({ vault, criar }) => {
  const p = criar(`${WIKI}/sem-frontmatter.md`, "# Aula solta\n\ntexto\n");
  const antiga = new Date("2026-05-02T10:00:00Z");
  fs.utimesSync(p, antiga, antiga);

  const [r] = await revisao(vault);
  assert.equal(r.geradaEm.slice(0, 10), "2026-05-02");
});

await caso("página já revisada sai da fila", async ({ vault, criar }) => {
  criar(`${WIKI}/compressao.md`, pagina("2026-07-17", "Compressão"));
  criar(`${WIKI}/compressao-review.md`, pagina("2026-07-18", "Compressão — review"));
  assert.deepEqual(await revisao(vault), []);
});

await caso("MOC e review não são aulas a revisar", async ({ vault, criar }) => {
  criar(`${WIKI}/C09-Computacao-Grafica.md`, pagina("2026-07-01", "Índice"));
  criar(`${WIKI}/x-review.md`, pagina("2026-07-01", "review órfão"));
  assert.deepEqual(await revisao(vault), []);
});

console.log(falhas ? `\n${falhas} falha(s).\n` : "\nA fila mostra a data certa.\n");
process.exit(falhas ? 1 : 0);
