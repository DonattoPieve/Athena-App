/**
 * Testa o espelho do R2 na árvore, sem abrir o app e sem rede.
 *
 *   npm run test:espelho
 *
 * O que está em jogo aqui é o caso que originou tudo: um PC novo, com a conta
 * certa, mostrando `Notes/INATEL` vazio. A regra é curta e as maneiras de
 * errá-la são silenciosas — arquivo do disco duplicado com o do bucket, pasta
 * criada duas vezes, ordem trocada.
 */
import assert from "node:assert/strict";
import { mesclarArvore, tocaOBucket, DENTRO_DO_VAULT } from "../electron/espelho.ts";

const item = (rel, emCache = false) => ({ rel, size: 10, emCache });

/** Acha um nó pelo `rel`, em qualquer profundidade. */
function achar(nos, rel) {
  for (const n of nos) {
    if (n.rel === rel) return n;
    const dentro = n.children ? achar(n.children, rel) : null;
    if (dentro) return dentro;
  }
  return null;
}

function contar(nos, rel) {
  let n = 0;
  const andar = (lista) => {
    for (const no of lista) {
      if (no.rel === rel) n++;
      if (no.children) andar(no.children);
    }
  };
  andar(nos);
  return n;
}

let falhas = 0;
async function caso(nome, fn) {
  try {
    await fn();
    console.log(`  ok  ${nome}`);
  } catch (e) {
    falhas++;
    console.error(`  FALHOU  ${nome}\n        ${e.message}`);
  }
}

console.log("\nespelho do R2 na árvore — teste\n");

await caso("PC novo: árvore vazia recebe o material da conta", async () => {
  const arvore = mesclarArvore(
    "Notes",
    [item("Notes/INATEL/C09-Computacao-Grafica/Aula 4.pdf")],
    [],
  );
  const pasta = achar(arvore, "Notes/INATEL");
  assert.ok(pasta, "faltou a pasta Notes/INATEL");
  assert.equal(pasta.dir, true);
  const arquivo = achar(arvore, "Notes/INATEL/C09-Computacao-Grafica/Aula 4.pdf");
  assert.ok(arquivo, "o PDF não apareceu na árvore");
  assert.equal(arquivo.remoto, true);
  assert.equal(arquivo.emCache, false);
});

await caso("o que está no disco não vira nó duplicado", async () => {
  const doDisco = [
    {
      name: "INATEL",
      rel: "Notes/INATEL",
      dir: true,
      children: [
        {
          name: "C09-Computacao-Grafica",
          rel: "Notes/INATEL/C09-Computacao-Grafica",
          dir: true,
          children: [
            { name: "Aula 4.pdf", rel: "Notes/INATEL/C09-Computacao-Grafica/Aula 4.pdf", dir: false },
          ],
        },
      ],
    },
  ];
  const arvore = mesclarArvore(
    "Notes",
    [
      item("Notes/INATEL/C09-Computacao-Grafica/Aula 4.pdf"),
      item("Notes/INATEL/C09-Computacao-Grafica/Aula 5.pdf"),
    ],
    doDisco,
  );
  assert.equal(contar(arvore, "Notes/INATEL/C09-Computacao-Grafica/Aula 4.pdf"), 1);
  assert.equal(contar(arvore, "Notes/INATEL/C09-Computacao-Grafica"), 1, "a pasta foi criada de novo");
  // O que já estava no disco continua sendo do disco: nada de nuvem em cima.
  assert.equal(achar(arvore, "Notes/INATEL/C09-Computacao-Grafica/Aula 4.pdf").remoto, undefined);
  assert.equal(achar(arvore, "Notes/INATEL/C09-Computacao-Grafica/Aula 5.pdf").remoto, true);
});

await caso("dois arquivos da mesma matéria dividem uma pasta só", async () => {
  const arvore = mesclarArvore(
    "Notes",
    [item("Notes/INATEL/T02-Redes/01.pdf"), item("Notes/INATEL/T02-Redes/02.pdf")],
    [],
  );
  assert.equal(contar(arvore, "Notes/INATEL/T02-Redes"), 1);
  assert.equal(achar(arvore, "Notes/INATEL/T02-Redes").children.length, 2);
});

await caso("anexo cai em Notes/attachments, não no INATEL", async () => {
  const arvore = mesclarArvore("Notes", [item("Notes/attachments/colada.png")], []);
  assert.ok(achar(arvore, "Notes/attachments/colada.png"));
  assert.equal(achar(arvore, "Notes/INATEL"), null);
});

await caso("já baixado uma vez aparece marcado (abre sem internet)", async () => {
  const arvore = mesclarArvore("Notes", [item("Notes/INATEL/C09/a.pdf", true)], []);
  assert.equal(achar(arvore, "Notes/INATEL/C09/a.pdf").emCache, true);
});

await caso("pasta antes de arquivo, e ordem alfabética dentro de cada uma", async () => {
  const arvore = mesclarArvore(
    "Notes",
    [
      item("Notes/INATEL/B-materia/z.pdf"),
      item("Notes/INATEL/B-materia/a.pdf"),
      item("Notes/INATEL/A-materia/x.pdf"),
    ],
    [{ name: "solto.md", rel: "Notes/solto.md", dir: false }],
  );
  assert.deepEqual(arvore.map((n) => n.name), ["INATEL", "solto.md"]);
  const inatel = achar(arvore, "Notes/INATEL");
  assert.deepEqual(inatel.children.map((n) => n.name), ["A-materia", "B-materia"]);
  assert.deepEqual(
    achar(arvore, "Notes/INATEL/B-materia").children.map((n) => n.name),
    ["a.pdf", "z.pdf"],
  );
});

await caso("nome com acento, espaço e parêntese passa intacto", async () => {
  const rel = "Notes/INATEL/C09-Computacao-Grafica/10. Operações no Domínio do Espaço (v2).pdf";
  const arvore = mesclarArvore("Notes", [item(rel)], []);
  const no = achar(arvore, rel);
  assert.ok(no, "o arquivo com acento sumiu");
  assert.equal(no.name, "10. Operações no Domínio do Espaço (v2).pdf");
});

await caso("item de fora do escopo pedido é ignorado", async () => {
  const arvore = mesclarArvore("Resumos", [item("Notes/INATEL/C09/a.pdf")], []);
  assert.deepEqual(arvore, [], "material do INATEL vazou para a árvore de Resumos");
});

await caso("sem nada no bucket, a árvore do disco volta como estava", async () => {
  const doDisco = [{ name: "solto.md", rel: "Notes/solto.md", dir: false }];
  assert.equal(mesclarArvore("Notes", [], doDisco), doDisco);
});

await caso("Resumos/ não vai à rede; Notes/ e Notes/INATEL vão", async () => {
  assert.equal(tocaOBucket("Resumos"), false);
  assert.equal(tocaOBucket("Notes"), true);
  // Escopo mais fundo que a pasta do grupo continua valendo: a árvore pode ser
  // pedida a partir de dentro do INATEL.
  assert.equal(tocaOBucket("Notes/INATEL"), true);
  assert.equal(tocaOBucket("Notes/subjects"), false);
});

await caso("a tabela de grupos é a mesma dos dois lados", async () => {
  assert.deepEqual(Object.keys(DENTRO_DO_VAULT).sort(), ["inatel", "raw-attachments"]);
});

console.log(falhas ? `\n${falhas} falha(s).\n` : "\nEspelho de acordo com o bucket.\n");
process.exit(falhas ? 1 : 0);
