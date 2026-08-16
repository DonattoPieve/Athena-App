/**
 * Testa a barra de progresso do ingest sem abrir o app.
 *
 *   npm run test:progresso
 *
 * As linhas abaixo são no formato que `describeTool()` produz em
 * electron/claude.ts — se aquele formato mudar, este teste quebra, que é
 * exatamente o aviso que se quer: a barra lê o transcript.
 */
import assert from "node:assert/strict";
import { progresso, rotuloAtual, temMarcos } from "../src/lib/progresso.ts";

const l = (texto) => ({ n: 0, level: "tool", text: texto });

const INGEST = [
  { n: 0, level: "info", text: "> athena C09 transformacoes-geometricas-parte-1" },
  l("Glob: C:\\Users\\donat\\Desktop\\Athena\\raw\\subjects\\C09-Computacao-Grafica"),
  l("Read: C:\\Users\\donat\\Desktop\\Athena\\raw\\INATEL\\C09-Computacao-Grafica\\Aula 4.pdf"),
  l("Write: C:\\Users\\donat\\Desktop\\Athena\\wiki\\subjects\\C09-Computacao-Grafica\\transformacoes.md"),
  l("Edit: C:\\Users\\donat\\Desktop\\Athena\\wiki\\subjects\\C09-Computacao-Grafica\\MOC.md"),
  l("bash: copy ... athena-web\\public\\materials\\C09-Computacao-Grafica\\aula-4.pdf"),
  l("Edit: C:\\Users\\donat\\Desktop\\Athena\\log.md"),
  l("Write: C:\\Users\\donat\\Desktop\\Athena\\.ingest-status"),
];

let falhas = 0;
function ok(nome, fn) {
  try {
    fn();
    console.log("ok   ", nome);
  } catch (e) {
    falhas++;
    console.error("FALHA", nome, "\n     ", e.message);
  }
}

ok("sobe em degraus, na ordem do CLAUDE.md", () => {
  const esperado = [4, 12, 28, 55, 68, 80, 90, 97];
  const visto = INGEST.map((_, i) => progresso(INGEST.slice(0, i + 1)).pct);
  assert.deepEqual(visto, esperado);
});

ok("nunca anda para tras quando o Claude relê um arquivo", () => {
  const comReleitura = [...INGEST, l("Read: ...\\raw\\INATEL\\C09\\Aula 4.pdf")];
  assert.equal(progresso(comReleitura).pct, 97);
});

ok("comando novo zera a barra", () => {
  const segundo = [...INGEST, { n: 0, level: "info", text: "> athena C11 outra-aula" }];
  assert.equal(progresso(segundo).pct, 4);
  assert.equal(rotuloAtual(segundo), "athena C11 outra-aula");
});

ok("nome da etapa acompanha a porcentagem", () => {
  assert.equal(progresso(INGEST.slice(0, 4)).nome, "escrevendo a página");
});

ok("delete e review não fingem porcentagem", () => {
  assert.equal(temMarcos("athena C09 aula"), true);
  assert.equal(temMarcos("athena delete C09"), false);
  assert.equal(temMarcos("review C09 aula"), false);
  assert.equal(temMarcos(null), false);
});

ok("barra do primeiro instante não é zero nem cheia", () => {
  const p = progresso([INGEST[0]]).pct;
  assert.ok(p > 0 && p < 20, `esperava um começo discreto, veio ${p}`);
});

console.log(falhas ? `\n${falhas} falha(s).` : "\nBarra de progresso de acordo com o fluxo.");
process.exit(falhas ? 1 : 0);
