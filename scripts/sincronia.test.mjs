/**
 * Quem vence quando o disco e o banco discordam.
 *
 *   npm run test:sincronia
 *
 * O caso que deu origem a isto: regerar uma página no notebook, publicar, e o
 * outro computador ficar com a versão velha para sempre — o pull dizia
 * "conflito" e seguia. Pior: publicar do PC atrasado mandava a versão velha
 * de volta para o banco, e a nova sumia.
 *
 * As duas regras que este teste protege, e que puxam para lados opostos:
 * o que é comprovadamente mais novo na conta ENTRA, e o que é mais novo aqui
 * NÃO É PERDIDO — nem sobrescrito em silêncio, nem escondido.
 */
import assert from "node:assert/strict";
import { decidir } from "../electron/sincronia.ts";

let falhas = 0;
function caso(nome, fn) {
  try {
    fn();
    console.log(`  ok  ${nome}`);
  } catch (e) {
    falhas++;
    console.error(`  FALHOU  ${nome}\n        ${e.message}`);
  }
}

console.log("\ndisco x banco — teste\n");

caso("não existe aqui: cria", () => {
  assert.deepEqual(decidir({ existe: false, igual: false }), { acao: "criar" });
});

caso("mesmo conteúdo: não mexe", () => {
  assert.deepEqual(decidir({ existe: true, igual: true }), { acao: "igual" });
});

caso("a da conta é mais nova: atualiza", () => {
  assert.deepEqual(
    decidir({ existe: true, igual: false, updatedLocal: "2026-07-17", updatedBanco: "2026-08-26" }),
    { acao: "atualizar", local: "2026-07-17", banco: "2026-08-26" },
  );
});

caso("a daqui é mais nova: mantém e avisa", () => {
  assert.deepEqual(
    decidir({ existe: true, igual: false, updatedLocal: "2026-08-26", updatedBanco: "2026-07-17" }),
    { acao: "local-mais-novo", local: "2026-08-26", banco: "2026-07-17" },
  );
});

caso("mesma data e conteúdo diferente: conflito, o disco fica", () => {
  // Empate de data não é empate de conteúdo — mas ninguém sabe qual é o novo,
  // e chutar aqui é justamente o que o "nunca sobrescrever" evitava.
  assert.equal(
    decidir({ existe: true, igual: false, updatedLocal: "2026-08-26", updatedBanco: "2026-08-26" })
      .acao,
    "conflito",
  );
});

caso("sem data de um dos lados: conflito", () => {
  // Nota do aluno não tem data no banco. Comparar data com o nada daria
  // sempre o mesmo vencedor — isso é palpite, não desempate.
  for (const par of [
    { updatedLocal: "2026-08-26", updatedBanco: null },
    { updatedLocal: null, updatedBanco: "2026-08-26" },
    { updatedLocal: null, updatedBanco: null },
    { updatedLocal: "", updatedBanco: "2026-08-26" },
  ]) {
    assert.equal(decidir({ existe: true, igual: false, ...par }).acao, "conflito", JSON.stringify(par));
  }
});

caso("data em formato estranho não desempata", () => {
  assert.equal(
    decidir({
      existe: true,
      igual: false,
      updatedLocal: "26/08/2026",
      updatedBanco: "2026-08-26",
    }).acao,
    "conflito",
  );
});

console.log(falhas ? `\n${falhas} falha(s).\n` : "\nO desempate está de pé nos dois sentidos.\n");
process.exit(falhas ? 1 : 0);
