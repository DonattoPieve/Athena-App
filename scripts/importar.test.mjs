/**
 * Testa o arrastar de FORA para dentro do vault, com disco de verdade.
 *
 *   npm run test:importar
 *
 * A regra que este teste protege é uma só: `Notes/INATEL` é o material do
 * professor, e o app pode ACRESCENTAR ali, nunca substituir. Se um dia alguém
 * trocar o `COPYFILE_EXCL` por uma cópia comum, o PDF do professor passa a
 * poder ser trocado por um arrastar distraído — e nada na tela avisaria.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Vault } from "../electron/vault.ts";

let falhas = 0;
async function caso(nome, fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "athena-importar-"));
  const raiz = path.join(base, "vault");
  const fora = path.join(base, "fora");
  for (const d of ["Notes/INATEL/C09-Existente", "Notes/subjects", "Resumos/subjects"]) {
    fs.mkdirSync(path.join(raiz, ...d.split("/")), { recursive: true });
  }
  fs.writeFileSync(path.join(raiz, "CLAUDE.md"), "# vault de teste\n");
  fs.mkdirSync(fora, { recursive: true });

  try {
    await fn({ vault: new Vault(raiz), raiz, fora });
    console.log(`  ok  ${nome}`);
  } catch (e) {
    falhas++;
    console.error(`  FALHOU  ${nome}\n        ${e.message}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

const arquivo = (dir, nome, texto) => {
  const p = path.join(dir, nome);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, texto, "utf8");
  return p;
};

console.log("\nimportar material de fora — teste\n");

await caso("PDF solto vai para a pasta da matéria", async ({ vault, raiz, fora }) => {
  const de = arquivo(fora, "Aula 9.pdf", "conteudo");
  const r = await vault.importar("Notes/INATEL/C09-Existente", [de]);
  assert.equal(r.copiados, 1);
  assert.deepEqual(r.jaExistiam, []);
  const dentro = path.join(raiz, "Notes", "INATEL", "C09-Existente", "Aula 9.pdf");
  assert.equal(fs.readFileSync(dentro, "utf8"), "conteudo");
  // Copia, não move: o original continua onde estava.
  assert.equal(fs.existsSync(de), true, "o arquivo de origem sumiu");
});

await caso("pasta de matéria inteira entra em Notes/INATEL", async ({ vault, raiz, fora }) => {
  const m08 = path.join(fora, "M08-Materia-Nova");
  arquivo(m08, "01 - Introducao.pdf", "a");
  arquivo(m08, "02 - Continuacao.pdf", "b");
  arquivo(path.join(m08, "extras"), "tabela.png", "c");

  const r = await vault.importar("Notes/INATEL", [m08]);
  assert.equal(r.copiados, 3, `esperava 3 arquivos, veio ${r.copiados}`);
  const dentro = path.join(raiz, "Notes", "INATEL", "M08-Materia-Nova");
  assert.equal(fs.existsSync(path.join(dentro, "01 - Introducao.pdf")), true);
  assert.equal(fs.existsSync(path.join(dentro, "extras", "tabela.png")), true);
});

await caso("NUNCA sobrescreve material que já existe", async ({ vault, raiz, fora }) => {
  const alvo = path.join(raiz, "Notes", "INATEL", "C09-Existente", "Aula 4.pdf");
  fs.writeFileSync(alvo, "material-do-professor", "utf8");
  const de = arquivo(fora, "Aula 4.pdf", "arquivo-errado");

  const r = await vault.importar("Notes/INATEL/C09-Existente", [de]);
  assert.equal(r.copiados, 0);
  assert.deepEqual(r.jaExistiam, ["Aula 4.pdf"]);
  assert.equal(
    fs.readFileSync(alvo, "utf8"),
    "material-do-professor",
    "o material do professor foi substituído",
  );
});

await caso("pasta de mesmo nome também é recusada inteira", async ({ vault, raiz, fora }) => {
  const antigo = path.join(raiz, "Notes", "INATEL", "M08");
  arquivo(antigo, "velho.pdf", "velho");
  const novo = path.join(fora, "M08");
  arquivo(novo, "novo.pdf", "novo");

  const r = await vault.importar("Notes/INATEL", [novo]);
  assert.deepEqual(r.jaExistiam, ["M08"]);
  assert.equal(fs.existsSync(path.join(antigo, "novo.pdf")), false, "mesclou pastas");
  assert.equal(fs.readFileSync(path.join(antigo, "velho.pdf"), "utf8"), "velho");
});

await caso("Resumos/ recusa arquivo de fora", async ({ vault, fora }) => {
  const de = arquivo(fora, "pagina.md", "# nao");
  await assert.rejects(
    () => vault.importar("Resumos/subjects", [de]),
    /Resumos\/ nasce do ingest|Nao da para adicionar/,
  );
});

await caso("arquivo que já está no vault não é importado (isso é mover)", async ({ vault, raiz }) => {
  const dentro = arquivo(path.join(raiz, "Notes", "subjects"), "nota.md", "x");
  await assert.rejects(() => vault.importar("Notes/INATEL", [dentro]), /ja esta no vault/);
});

await caso("pasta que só existe no espelho é criada na hora", async ({ vault, raiz, fora }) => {
  const de = arquivo(fora, "aula.pdf", "z");
  const destino = "Notes/INATEL/T02-Redes"; // não existe no disco deste vault
  assert.equal(fs.existsSync(path.join(raiz, "Notes", "INATEL", "T02-Redes")), false);
  const r = await vault.importar(destino, [de]);
  assert.equal(r.copiados, 1);
  assert.equal(fs.existsSync(path.join(raiz, "Notes", "INATEL", "T02-Redes", "aula.pdf")), true);
});

await caso("caminho não pode escapar da raiz do vault", async ({ vault, fora }) => {
  const de = arquivo(fora, "x.pdf", "x");
  await assert.rejects(() => vault.importar("../fora", [de]), /fora do vault|Nao da para adicionar/);
});

await caso("onde dá para soltar, e onde não dá", async ({ vault }) => {
  assert.equal(vault.isImportavel("Notes"), true);
  assert.equal(vault.isImportavel("Notes/INATEL"), true);
  assert.equal(vault.isImportavel("Notes/INATEL/C09-x"), true);
  assert.equal(vault.isImportavel("Notes/subjects"), true);
  assert.equal(vault.isImportavel("Resumos"), false);
  assert.equal(vault.isImportavel("Resumos/subjects/C09-x"), false);
  assert.equal(vault.isImportavel(""), false);
  // Escrever continua proibido no INATEL: acrescentar é que passou a valer.
  assert.equal(vault.isWritable("Notes/INATEL/C09-x/aula.pdf"), false);
});

await caso("criar pasta e nota valem em Notes/INATEL", async ({ vault, raiz }) => {
  await vault.mkdir("Notes/INATEL/M08-Materia-Nova");
  assert.equal(fs.existsSync(path.join(raiz, "Notes", "INATEL", "M08-Materia-Nova")), true);
  await vault.create("Notes/INATEL/M08-Materia-Nova/leia-me.md", "# fontes");
  assert.equal(
    fs.readFileSync(path.join(raiz, "Notes", "INATEL", "M08-Materia-Nova", "leia-me.md"), "utf8"),
    "# fontes",
  );
});

await caso("criar não pode virar sobrescrever", async ({ vault, raiz }) => {
  const alvo = path.join(raiz, "Notes", "INATEL", "C09-Existente", "Aula 4.pdf");
  fs.writeFileSync(alvo, "material-do-professor", "utf8");
  await assert.rejects(() => vault.create("Notes/INATEL/C09-Existente/Aula 4.pdf", "lixo"), /Ja existe/);
  assert.equal(fs.readFileSync(alvo, "utf8"), "material-do-professor");
  await assert.rejects(() => vault.mkdir("Notes/INATEL/C09-Existente"), /Ja existe/);
});

await caso("editar continua proibido no INATEL, mesmo podendo criar", async ({ vault }) => {
  await assert.rejects(
    () => vault.write("Notes/INATEL/C09-Existente/qualquer.md", "x"),
    /Escrita bloqueada/,
  );
  await assert.rejects(() => vault.mkdir("Resumos/subjects/M08"), /Criar pasta bloqueado/);
});

console.log(falhas ? `\n${falhas} falha(s).\n` : "\nMaterial do professor a salvo.\n");
process.exit(falhas ? 1 : 0);
