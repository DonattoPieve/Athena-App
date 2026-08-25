/**
 * As guardas do vault, do lado da tela.
 *
 * ESTE ARQUIVO É UMA CÓPIA DE PROPÓSITO. As regras de verdade moram no
 * `electron/vault.ts` — é ele que recusa a operação — e o renderer não pode
 * importá-lo (é código do main, com `fs` dentro). Mas o menu de contexto
 * precisa saber a resposta ANTES de perguntar: item que aparece habilitado e
 * falha depois é ruim, e item cinza que o app conseguiria fazer é o pior de
 * todos — foi o defeito da 1.0.9 e de novo o da 1.0.12.
 *
 * O que impede a cópia de envelhecer é o `scripts/guardas.test.mjs`: ele roda
 * as duas implementações sobre a mesma lista de caminhos e falha quando elas
 * discordarem. Mudou a regra aqui, o teste cobra a de lá — e vice-versa.
 *
 * | esta função    | o par no vault.ts | o que autoriza              |
 * |----------------|-------------------|-----------------------------|
 * | `gravavel`     | `isWritable`      | editar, renomear, mover     |
 * | `recebeDeFora` | `isImportavel`    | criar, arrastar do Windows  |
 * | `apagavel`     | `isDeletable`     | apagar (lixeira do Windows) |
 */

const NOTAS = "Notes";
const RESUMOS = "Resumos";
/** Dentro de `Notes/`, o que o app lê mas não edita — o material do professor. */
const SOMENTE_LEITURA = ["Notes/INATEL"];

/** Mesma normalização do `vault.ts`: sem barra inicial, sempre com `/`. */
function normalizar(rel: string): string {
  return rel.replace(/\\/g, "/").replace(/^\/+/, "");
}

function dentroDe(rel: string, base: string): boolean {
  return rel === base || rel.startsWith(base + "/");
}

/**
 * EDITAR: a regra estreita — `Notes/` inteiro, menos `Notes/INATEL/`.
 *
 * Alterar o material do professor corrompe em silêncio a fonte que o ingest
 * lê, e o estrago só aparece na página gerada, semanas depois.
 */
export function gravavel(rel: string): boolean {
  const norm = normalizar(rel);
  if (!dentroDe(norm, NOTAS)) return false;
  return !SOMENTE_LEITURA.some((p) => dentroDe(norm, p));
}

/**
 * ACRESCENTAR: a regra larga — `Notes/` inteiro, INATEL incluído.
 *
 * Vale lá porque acrescentar nunca sobrescreve: arquivo com nome que já existe
 * é recusado, não substituído (ver `importar` no vault.ts). É assim que uma
 * matéria nova entra no vault sem abrir o Explorer do Windows por fora.
 */
export function recebeDeFora(rel: string): boolean {
  return dentroDe(normalizar(rel), NOTAS);
}

/**
 * APAGAR: larga também, e ainda pega `Resumos/`.
 *
 * `Resumos/` é somente leitura para escrita (quem escreve lá é o ingest), mas
 * tirar do disco uma página que não deveria estar lá é legítimo — sem isto a
 * única saída era abrir o Explorer do Windows. E apagar é visível: vai para a
 * lixeira, e o que ficou na nuvem volta no próximo clique.
 */
export function apagavel(rel: string): boolean {
  const norm = normalizar(rel);
  return recebeDeFora(norm) || dentroDe(norm, RESUMOS);
}
