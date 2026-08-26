/**
 * Lança uma versão: confere, sobe o número, cria a tag e empurra.
 *
 *   npm run lancar            -> 1.0.18 vira 1.0.19
 *   npm run lancar minor      -> 1.1.0
 *   npm run lancar major      -> 2.0.0
 *   npm run lancar -- --seco  -> faz tudo menos o push
 *
 * POR QUE ISTO EXISTE. Publicar eram cinco passos manuais e cada um já falhou
 * pelo menos uma vez nesta máquina:
 *
 *   - a versão mora em DOIS arquivos (`package.json` e o `package-lock.json`,
 *     na raiz e em `packages[""]`), e o Action recusa o build se a tag não
 *     bater com o `package.json`. O `npm version` mexe nos dois de uma vez;
 *   - a tag tem que ser ANOTADA (`git tag -a`) — o `npm version` cria assim;
 *   - `git push --follow-tags` só leva tag alcançável pelos commits DAQUELE
 *     push. Commit já enviado + tag criada depois = "Everything up-to-date" e
 *     a tag fica no PC. Foi o que segurou a 1.0.13 por um dia. Aqui o commit
 *     da versão e a tag nascem juntos, então o push sempre leva os dois.
 *
 * O que ele NÃO faz: decidir por você. Árvore suja, branch errada ou teste
 * vermelho param o lançamento antes de mexer em qualquer coisa — é mais fácil
 * consertar agora do que despublicar um Release depois.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const SECO = args.includes("--seco");
const tipo = args.find((a) => ["patch", "minor", "major"].includes(a)) ?? "patch";

/**
 * Rodar `npm` daqui de dentro, sem `.cmd` e sem shell.
 *
 * No Windows o `npm` e um `npm.cmd`, e um `.cmd` nao roda sozinho: precisa de
 * um interpretador. As duas saidas obvias falham —
 *
 *   - `shell: true` funciona, mas o Node avisa (DEP0190) porque com shell os
 *     argumentos sao CONCATENADOS em vez de escapados;
 *   - `spawnSync("npm.cmd", ...)` sem shell falha com EINVAL: desde a correcao
 *     da CVE-2024-27980 o Node se recusa a executar `.cmd`/`.bat` assim.
 *
 * A terceira saida e a boa: o proprio npm nos diz onde ele mora. Quando este
 * script roda por `npm run lancar`, `npm_execpath` aponta para o `npm-cli.js`
 * — um arquivo .js comum, que o Node executa direto. Sem shell, sem aviso,
 * sem `.cmd`.
 *
 * O `?? "npm"` cobre a chamada direta (`node scripts/lancar.mjs`), onde essa
 * variavel nao existe: ai o shell e a unica opcao, e o aviso e o preco.
 */
const NPM_CLI = process.env.npm_execpath ?? null;

function rodar(cmd, argv, { silencioso = false } = {}) {
  const r = spawnSync(cmd, argv, {
    stdio: silencioso ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (silencioso && r.stderr) process.stderr.write(r.stderr);
    throw new Error(`falhou: ${cmd} ${argv.join(" ")}`);
  }
  return (r.stdout ?? "").trim();
}

/** `npm run typecheck` e afins — ver `NPM_CLI` acima. */
function npm(argv) {
  if (NPM_CLI) return rodar(process.execPath, [NPM_CLI, ...argv]);
  const r = spawnSync("npm", argv, { stdio: "inherit", shell: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`falhou: npm ${argv.join(" ")}`);
  return "";
}

function parar(mensagem) {
  console.error(`\n  ✗ ${mensagem}\n`);
  process.exit(1);
}

const versaoAtual = JSON.parse(readFileSync("package.json", "utf8")).version;
console.log(`\nlançar ${tipo} — versão atual ${versaoAtual}\n`);

/* ---------- guardas ---------- */

const branch = rodar("git", ["rev-parse", "--abbrev-ref", "HEAD"], { silencioso: true });
if (branch !== "main") parar(`você está na branch "${branch}". O release sai da main.`);

const sujo = rodar("git", ["status", "--porcelain"], { silencioso: true });
if (sujo) {
  parar(
    "há mudança não commitada. Commite (ou guarde) antes:\n\n" +
      sujo
        .split("\n")
        .map((l) => `      ${l}`)
        .join("\n"),
  );
}

// A tag nasce do `npm version`, que falha se ela já existir — mas a mensagem
// dele não diz o que fazer, e a essa altura o package.json já foi alterado.
const [maior, menor, remendo] = versaoAtual.split(".").map(Number);
const proxima =
  tipo === "major" ? `${maior + 1}.0.0`
  : tipo === "minor" ? `${maior}.${menor + 1}.0`
  : `${maior}.${menor}.${remendo + 1}`;
const tags = rodar("git", ["tag", "--list", `v${proxima}`], { silencioso: true });
if (tags) parar(`a tag v${proxima} já existe neste PC. Apague-a ou escolha outro tipo.`);

/* ---------- verificação ---------- */

console.log("→ typecheck e testes (é aqui que o release para, não no GitHub)\n");
npm(["run", "typecheck"]);
npm(["test"]);

/* ---------- versão, tag e push ---------- */

console.log(`\n→ ${versaoAtual} vira ${proxima}\n`);
// `-m` vira a mensagem do commit E da tag anotada.
npm(["version", tipo, "-m", "%s"]);

if (SECO) {
  console.log(`\n  ✓ v${proxima} commitada e tagueada. Falta empurrar:\n`);
  console.log("      git push --follow-tags\n");
  process.exit(0);
}

console.log("\n→ empurrando commit + tag\n");
rodar("git", ["push", "--follow-tags"]);

console.log(`\n  ✓ v${proxima} no ar. O Action builda e publica o instalador.`);
console.log("    Acompanhe em: https://github.com/DonattoPieve/Athena-App/actions\n");
