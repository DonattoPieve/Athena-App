/**
 * O protocolo que o app INSTALA é o mesmo que o seu vault usa?
 *
 *   npm run esqueleto:conferir       -> falha se divergirem
 *   npm run esqueleto:sincronizar    -> copia do vault para o app
 *
 * `build/esqueleto/CLAUDE.md` é o que o `bootstrap.criarVault()` copia para
 * dentro de todo vault novo. Ele nasceu como cópia manual do `CLAUDE.md` do
 * vault do Donatto, e nada os prende: editar as regras no vault (que é onde
 * faz sentido editar) e esquecer do esqueleto faz cada vault novo nascer com
 * o protocolo velho — e o defeito aparece semanas depois, num PC novo, como
 * "as páginas saem diferentes" sem ninguém saber por quê.
 *
 * A fonte é o VAULT. O app é espelho dela.
 *
 * Sem vault à vista (o CI, por exemplo) isto não é erro: não há com o que
 * comparar, e o script diz isso e sai com 0. É o que permite chamá-lo do
 * `npm test` sem quebrar o build do GitHub.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARQUIVOS = ["CLAUDE.md", "COMANDOS.md"];
const sincronizar = process.argv.includes("--sincronizar");

/** O mesmo caminho que o app usa — uma configuração, não um palpite. */
function vaultDoApp() {
  const daLinha = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (daLinha) return daLinha;
  const cfg = join(homedir(), "AppData", "Roaming", "athena-app", "athena-app.json");
  if (!existsSync(cfg)) return null;
  try {
    const { vaultPath, vaults } = JSON.parse(readFileSync(cfg, "utf8"));
    return vaultPath ?? Object.values(vaults ?? {})[0] ?? null;
  } catch {
    return null;
  }
}

const vault = vaultDoApp();
if (!vault || !existsSync(vault)) {
  console.log("\nesqueleto: nenhum vault nesta máquina — nada a comparar.\n");
  process.exit(0);
}

console.log(`\nesqueleto x vault (${vault})\n`);

let divergiram = 0;
for (const nome of ARQUIVOS) {
  const noApp = join(RAIZ, "build", "esqueleto", nome);
  const noVault = join(vault, nome);

  if (!existsSync(noVault)) {
    console.log(`  --  ${nome}: não existe no vault, pulando`);
    continue;
  }
  if (!existsSync(noApp)) {
    divergiram++;
    console.error(`  ✗   ${nome}: falta em build/esqueleto/ — vault novo nasceria sem ele`);
    continue;
  }

  const doVault = readFileSync(noVault, "utf8");
  const doApp = readFileSync(noApp, "utf8");
  if (doVault === doApp) {
    console.log(`  ok  ${nome}`);
    continue;
  }

  if (sincronizar) {
    writeFileSync(noApp, doVault);
    console.log(`  →   ${nome}: atualizado a partir do vault`);
    continue;
  }

  divergiram++;
  const linhas = (t) => t.split("\n").length;
  console.error(
    `  ✗   ${nome}: DIFERENTE do vault ` +
      `(vault: ${linhas(doVault)} linhas, app: ${linhas(doApp)})`,
  );
}

if (divergiram && !sincronizar) {
  console.error(
    "\n  O app instalaria um protocolo diferente do seu em todo vault novo.\n" +
      "  Se a versão do vault é a boa:  npm run esqueleto:sincronizar\n",
  );
  process.exit(1);
}
console.log(sincronizar ? "\nEsqueleto sincronizado.\n" : "\nO app instala o mesmo protocolo que você usa.\n");
