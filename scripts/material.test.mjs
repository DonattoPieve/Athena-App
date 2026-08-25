/**
 * O botão "Material de origem" leva a um arquivo que existe?
 *
 *   npm run test:material
 *
 * O frontmatter da página diz `sourceHref: "/materials/C09-.../aula.pdf"` —
 * o caminho da CÓPIA que o site serve, criada pelo ingest em
 * `athena-web/public/materials/`. Essa pasta não está no `Notes/` e o Worker
 * do R2 não serve aquele prefixo, então ela só existe na máquina onde o
 * ingest rodou. Enquanto a tela montava o caminho a partir dela, o botão
 * abria no PC do Donatto e falhava em qualquer outro.
 *
 * O que este teste protege: a tradução para `Notes/INATEL/<matéria>/`, que é
 * onde o arquivo do professor mora de verdade — inclusive quando ele ainda
 * está só na conta, sem ter descido para este disco.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Vault } from "../electron/vault.ts";

const PAGINA = "Resumos/subjects/C09-Computacao-Grafica/compressao-de-imagens-parte-1.md";
const SOURCE = "12. Compressão de Imagens (Parte 1).pdf";
const HREF = "/materials/C09-Computacao-Grafica/compressao-de-imagens-parte-1.pdf";
const NO_VAULT = "Notes/INATEL/C09-Computacao-Grafica/12. Compressão de Imagens (Parte 1).pdf";

let falhas = 0;
async function caso(nome, fn) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "athena-material-"));
  try {
    await fn({ vault: new Vault(raiz), raiz, criar: (rel) => criar(raiz, rel) });
    console.log(`  ok  ${nome}`);
  } catch (e) {
    falhas++;
    console.error(`  FALHOU  ${nome}\n        ${e.message}`);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
}

function criar(raiz, rel) {
  const p = path.join(raiz, ...rel.split("/"));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "pdf de mentira");
}

console.log("\nmaterial de origem — teste\n");

await caso("acha o PDF do professor pelo nome do frontmatter", async ({ vault, criar }) => {
  criar(NO_VAULT);
  criar("Notes/INATEL/C09-Computacao-Grafica/11. Operações no Domínio da Frequência.pdf");
  assert.equal(await vault.materialDaPagina(PAGINA, SOURCE, HREF), NO_VAULT);
});

await caso("PC novo: nada no disco, o arquivo está na conta", async ({ vault }) => {
  // É o caso que quebrava. A pasta da matéria nem existe no disco; o espelho
  // do bucket é a única prova de que o arquivo existe.
  const achado = await vault.materialDaPagina(PAGINA, SOURCE, HREF, [
    NO_VAULT,
    "Notes/INATEL/T02-Redes/01. Introdução.pdf",
  ]);
  assert.equal(achado, NO_VAULT);
});

await caso("casa por slug quando o nome do frontmatter mudou", async ({ vault, criar }) => {
  // O `source` aponta para um nome que não existe mais; o slug do arquivo
  // ainda contém o slug da página, que é como a cópia do site foi nomeada.
  const real = "Notes/INATEL/C09-Computacao-Grafica/12 - Compressao de Imagens - Parte 1.pdf";
  criar(real);
  assert.equal(await vault.materialDaPagina(PAGINA, "nome-que-nao-existe.pdf", HREF), real);
});

await caso("ignora arquivo que não é material", async ({ vault, criar }) => {
  criar("Notes/INATEL/C09-Computacao-Grafica/compressao-de-imagens-parte-1.txt");
  assert.equal(await vault.materialDaPagina(PAGINA, SOURCE, HREF), null);
});

await caso("vault antigo: cai na cópia do site se ela existir", async ({ vault, criar }) => {
  criar("athena-web/public/materials/C09-Computacao-Grafica/compressao-de-imagens-parte-1.pdf");
  assert.equal(
    await vault.materialDaPagina(PAGINA, SOURCE, HREF),
    "athena-web/public/materials/C09-Computacao-Grafica/compressao-de-imagens-parte-1.pdf",
  );
});

await caso("sem material em lugar nenhum devolve null", async ({ vault }) => {
  // null é o que faz a tela mostrar o nome sem botão, em vez de um botão que
  // não abre nada.
  assert.equal(await vault.materialDaPagina(PAGINA, SOURCE, HREF), null);
});

await caso("página fora de uma matéria não inventa material", async ({ vault, criar }) => {
  criar(NO_VAULT);
  assert.equal(await vault.materialDaPagina("Resumos/avulsa.md", SOURCE, HREF), null);
});

await caso("matéria com espaço no nome da pasta também casa", async ({ vault, criar }) => {
  const real = "Notes/INATEL/C14 - Engenharia de Software/03. Requisitos.pdf";
  criar(real);
  const achado = await vault.materialDaPagina(
    "Resumos/subjects/C14-Engenharia-de-Software/requisitos.md",
    "03. Requisitos.pdf",
    "/materials/C14-Engenharia-de-Software/requisitos.pdf",
  );
  assert.equal(achado, real);
});

console.log(falhas ? `\n${falhas} falha(s).\n` : "\nO link do material aponta para arquivo que existe.\n");
process.exit(falhas ? 1 : 0);
