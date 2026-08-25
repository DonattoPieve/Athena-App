/**
 * As guardas da TELA concordam com as guardas do DISCO?
 *
 *   npm run test:guardas
 *
 * O menu de contexto do Explorer decide sozinho o que oferecer, porque o
 * renderer não pode importar o `vault.ts` (é código do main, com `fs` dentro).
 * São duas implementações da mesma regra, e elas já divergiram duas vezes: na
 * 1.0.9 e de novo na 1.0.12, sempre com o mesmo sintoma — item de menu cinza,
 * sem explicação, para uma ação que o app conseguiria fazer.
 *
 * Este teste é o que impede a terceira vez. Ele roda as duas sobre a mesma
 * lista de caminhos e falha na primeira discordância, dizendo qual é qual.
 *
 * Caminho com barra invertida fica de fora de propósito: o `vault.ts`
 * normaliza com `path.sep`, que é `\` no Windows e `/` no Linux, então a
 * resposta depende de onde o teste roda — e um teste que muda de resposta com
 * o sistema operacional não prova nada.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Vault } from "../electron/vault.ts";
import { apagavel, gravavel, recebeDeFora } from "../src/lib/guardas.ts";

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "athena-guardas-"));
const vault = new Vault(raiz);

/** Um par por regra: o que a tela responde, e quem responde o mesmo no main. */
const REGRAS = [
  { nome: "editar (gravavel / isWritable)", tela: gravavel, disco: (r) => vault.isWritable(r) },
  { nome: "acrescentar (recebeDeFora / isImportavel)", tela: recebeDeFora, disco: (r) => vault.isImportavel(r) },
  { nome: "apagar (apagavel / isDeletable)", tela: apagavel, disco: (r) => vault.isDeletable(r) },
];

const CAMINHOS = [
  "",
  ".",
  "Notes",
  "Notes/subjects",
  "Notes/subjects/C09-Computacao-Grafica",
  "Notes/subjects/C09-Computacao-Grafica/aula.md",
  "Notes/concepts/entropia.md",
  "Notes/games/quiz.md",
  "Notes/studies/plano.md",
  "Notes/attachments/figura.png",
  // Pasta que a pessoa criou por conta própria: nasce dentro de Notes/ e não
  // está em lista nenhuma. Era exatamente aqui que a tela dizia "não" e o
  // main dizia "sim".
  "Notes/Ideias",
  "Notes/Ideias/rascunho.md",
  "Notes/INATEL",
  "Notes/INATEL/C09-Computacao-Grafica",
  "Notes/INATEL/C09-Computacao-Grafica/12. Compressão de Imagens.pdf",
  "Notes/INATELzinho/x.md", // prefixo parecido NÃO é a pasta protegida
  "Resumos",
  "Resumos/subjects",
  "Resumos/subjects/C09-Computacao-Grafica/compressao.md",
  "Resumos/reviews/c09-review.md",
  "athena-web",
  "athena-web/public/materials/C09/aula.pdf",
  "CLAUDE.md",
  "log.md",
  "fora-do-vault.md",
  "../fora",
  "/Notes/subjects/nota.md",
];

console.log("\nguardas da tela x guardas do disco — teste\n");

let falhas = 0;
for (const { nome, tela, disco } of REGRAS) {
  const divergentes = CAMINHOS.filter((rel) => tela(rel) !== disco(rel));
  if (divergentes.length === 0) {
    console.log(`  ok  ${nome}`);
    continue;
  }
  falhas++;
  console.error(`  FALHOU  ${nome}`);
  for (const rel of divergentes) {
    console.error(`        "${rel}": tela=${tela(rel)} disco=${disco(rel)}`);
  }
}

// A tabela do README/handoff diz que ACRESCENTAR e APAGAR são mais largas que
// EDITAR. Se um dia alguém apertar a regra larga sem perceber, isto avisa.
try {
  assert.equal(gravavel("Notes/INATEL/C09/aula.pdf"), false, "editar no INATEL tem que ser não");
  assert.equal(recebeDeFora("Notes/INATEL/C09"), true, "acrescentar no INATEL tem que ser sim");
  assert.equal(apagavel("Resumos/subjects/x.md"), true, "apagar em Resumos tem que ser sim");
  assert.equal(gravavel("Resumos/subjects/x.md"), false, "editar em Resumos tem que ser não");
  console.log("  ok  as três permissões continuam sendo três coisas diferentes");
} catch (e) {
  falhas++;
  console.error(`  FALHOU  as três permissões\n        ${e.message}`);
}

fs.rmSync(raiz, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} falha(s).\n` : "\nTela e disco de acordo.\n");
process.exit(falhas ? 1 : 0);
