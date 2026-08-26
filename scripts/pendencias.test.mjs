/**
 * O que o professor postou e ainda não virou página.
 *
 *   npm run test:pendencias
 *
 * A regra que este teste protege: aula com página NÃO pode aparecer como
 * pendente (a lista viraria ruído e ninguém olharia mais), e aula sem página
 * NÃO pode sumir da lista (é o trabalho que a pessoa não sabe que tem).
 *
 * O caso difícil é o nome: o material vem numerado ("12. Compressão de
 * Imagens (Parte 1).pdf") e a página não ("compressao-de-imagens-parte-1.md").
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Vault, slugDaAula } from "../electron/vault.ts";

let falhas = 0;
async function caso(nome, fn) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "athena-pendencias-"));
  try {
    await fn({ vault: new Vault(raiz), criar: (rel) => criar(raiz, rel) });
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
  fs.writeFileSync(p, "x");
}

const MATERIA = "Notes/INATEL/C09-Computacao-Grafica";
const WIKI = "Resumos/subjects/C09-Computacao-Grafica";

console.log("\naulas sem página — teste\n");

await caso("o número do arquivo não entra no slug da aula", async () => {
  assert.equal(slugDaAula("12. Compressão de Imagens (Parte 1).pdf"), "compressao-de-imagens-parte-1");
  assert.equal(slugDaAula("Transformações Geométricas.pptx"), "transformacoes-geometricas");
  // "3d" não é numeração: cortar aqui inventaria outra aula.
  assert.equal(slugDaAula("3d-Projecoes.pdf"), "3d-projecoes");
});

await caso("aula com página não aparece; aula sem página aparece", async ({ vault, criar }) => {
  criar(`${MATERIA}/12. Compressão de Imagens (Parte 1).pdf`);
  criar(`${MATERIA}/13. Compressão de Imagens (Parte 2).pdf`);
  criar(`${WIKI}/compressao-de-imagens-parte-1.md`);

  const [p] = await vault.pendencias();
  assert.equal(p.code, "C09");
  assert.deepEqual(
    p.materiais.map((m) => m.slug),
    ["compressao-de-imagens-parte-2"],
  );
});

await caso("matéria inteira processada some da lista", async ({ vault, criar }) => {
  criar(`${MATERIA}/12. Compressão de Imagens (Parte 1).pdf`);
  criar(`${WIKI}/compressao-de-imagens-parte-1.md`);
  assert.deepEqual(await vault.pendencias(), []);
});

await caso("MOC e review não contam como aula feita", async ({ vault, criar }) => {
  // O MOC tem o nome da matéria e o review termina em -review: se qualquer um
  // dos dois contasse, uma aula não processada sumiria da lista.
  criar(`${MATERIA}/01. Introdução.pdf`);
  criar(`${WIKI}/C09-Computacao-Grafica.md`);
  criar(`${WIKI}/introducao-review.md`);

  const [p] = await vault.pendencias();
  assert.deepEqual(
    p.materiais.map((m) => m.slug),
    ["introducao"],
  );
});

await caso("PC novo: a matéria só existe na nuvem", async ({ vault }) => {
  // Sem o espelho a lista viria vazia — dizendo "não falta nada" no exato
  // momento em que falta tudo.
  const pend = await vault.pendencias([
    `${MATERIA}/12. Compressão de Imagens (Parte 1).pdf`,
    `${MATERIA}/extras/tabela.png`,
  ]);
  assert.equal(pend.length, 1);
  assert.deepEqual(
    pend[0].materiais.map((m) => m.nome),
    ["12. Compressão de Imagens (Parte 1).pdf"],
  );
});

await caso("disco e nuvem não duplicam a mesma aula", async ({ vault, criar }) => {
  criar(`${MATERIA}/12. Compressão de Imagens (Parte 1).pdf`);
  const pend = await vault.pendencias([`${MATERIA}/12. Compressão de Imagens (Parte 1).pdf`]);
  assert.equal(pend[0].materiais.length, 1);
});

await caso("só arquivo de material entra", async ({ vault, criar }) => {
  criar(`${MATERIA}/leia-me.txt`);
  criar(`${MATERIA}/anotacao.md`);
  assert.deepEqual(await vault.pendencias(), []);
});

await caso("vault vazio não inventa pendência", async ({ vault }) => {
  assert.deepEqual(await vault.pendencias(), []);
});

console.log(falhas ? `\n${falhas} falha(s).\n` : "\nA lista do que falta bate com o disco.\n");
process.exit(falhas ? 1 : 0);
