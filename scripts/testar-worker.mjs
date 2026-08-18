/**
 * Prova que o portão do R2 funciona de ponta a ponta, do jeito que o app faz.
 *
 *   node scripts/testar-worker.mjs [caminho-do-vault]
 *
 * Sem argumento, lê o vault do `athena-app.json` (a mesma configuração que o
 * app usa). Renova a sessão do Supabase com o refresh token do vault, chama o
 * Worker e baixa o primeiro arquivo de cada grupo, conferindo o hash.
 *
 * Não usa credencial do R2 — se este teste passa, um PC novo funciona.
 *
 * O refresh token roda a cada uso (o Supabase invalida o anterior), então o
 * novo é gravado de volta no `session.json` na hora, igual o app e o CLI
 * fazem. Sem isso o teste deslogaria a máquina.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";

const WORKER = process.env.ATHENA_R2_WORKER ?? "https://athena-r2.donatto-athena.workers.dev";
const SUPABASE_URL = "https://cxlfnpzdsaiyuazqdjtw.supabase.co";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4bGZucHpkc2FpeXVhenFkanR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NDcxMTgsImV4cCI6MjEwMTEyMzExOH0.ONCO582MyotpGgbZ3phvbYjVjuoxf2-MwBgBjtvV9WM";

function vaultPadrao() {
  const cfg = join(homedir(), "AppData", "Roaming", "athena-app", "athena-app.json");
  if (existsSync(cfg)) {
    const v = JSON.parse(readFileSync(cfg, "utf8")).vaultPath;
    if (v) return v;
  }
  return join(homedir(), "Desktop", "Athena");
}

const vault = process.argv[2] ?? vaultPadrao();
const arquivoSessao = join(vault, ".athena", "session.json");
console.log(`vault:  ${vault}`);
console.log(`worker: ${WORKER}\n`);

if (!existsSync(arquivoSessao)) {
  console.error("Sem sessão neste vault. Rode `athena login` primeiro.");
  process.exit(1);
}

/* ---------- 1. troca o refresh token por um access token ---------- */
const { refresh_token } = JSON.parse(readFileSync(arquivoSessao, "utf8"));
const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
  method: "POST",
  headers: { apikey: ANON, "content-type": "application/json" },
  body: JSON.stringify({ refresh_token }),
});
if (!r.ok) {
  console.error(`Não consegui renovar a sessão (HTTP ${r.status}). Rode \`athena login --force\`.`);
  process.exit(1);
}
const sessao = await r.json();
writeFileSync(
  arquivoSessao,
  JSON.stringify({ refresh_token: sessao.refresh_token, saved_at: new Date().toISOString() }, null, 2),
);
const token = sessao.access_token;
console.log(`conta:  ${sessao.user?.email} (${sessao.user?.id})\n`);

/* ---------- 2. o Worker está de pé? ---------- */
const saude = await fetch(`${WORKER}/health`);
console.log(`/health -> ${saude.status} ${await saude.text()}`);

/* ---------- 3. sem token tem que recusar ---------- */
const semToken = await fetch(`${WORKER}/list?prefixo=inatel`);
console.log(`/list sem token -> ${semToken.status} (tem que ser 401)`);

/* ---------- 4. listar e baixar ---------- */
let falhas = semToken.status === 401 ? 0 : 1;

for (const grupo of ["inatel", "raw-attachments"]) {
  const resp = await fetch(`${WORKER}/list?prefixo=${grupo}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    console.error(`\n${grupo}: listagem falhou (HTTP ${resp.status}) ${await resp.text()}`);
    falhas++;
    continue;
  }
  const { objetos } = await resp.json();
  const bytes = objetos.reduce((a, o) => a + o.size, 0);
  console.log(`\n${grupo}: ${objetos.length} objeto(s), ${(bytes / 1048576).toFixed(1)} MB`);
  if (!objetos.length) {
    console.error("  vazio — rode `node athena-web/scripts/athena-publish.mjs` no vault.");
    falhas++;
    continue;
  }

  // O de nome mais complicado, que é onde codificação costuma quebrar.
  const alvo = [...objetos].sort((a, b) => b.rel.length - a.rel.length)[0];
  const arq = await fetch(`${WORKER}/f?k=${encodeURIComponent(alvo.key)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!arq.ok) {
    console.error(`  falhou ao baixar ${alvo.rel}: HTTP ${arq.status}`);
    falhas++;
    continue;
  }
  const corpo = Buffer.from(await arq.arrayBuffer());
  const hash = createHash("sha256").update(corpo).digest("hex").slice(0, 32);
  const ok = corpo.byteLength === alvo.size && (!alvo.sha256 || hash === alvo.sha256);
  console.log(`  baixou ${alvo.rel}`);
  console.log(`  ${(corpo.byteLength / 1048576).toFixed(2)} MB, hash ${ok ? "confere" : "DIFERENTE"}`);
  if (!ok) falhas++;
}

/* ---------- 5. gravar: o caminho da publicação ---------- */
// Grava um arquivo minúsculo de teste. Fica no bucket (o portão não apaga, de
// propósito) — daí o nome começar com ponto e dizer o que é: nada do vault o
// enxerga, e quem abrir o bucket entende na hora por que ele está lá.
{
  const key = `u/${sessao.user.id}/raw-attachments/.teste-de-escrita-do-app.txt`;
  const corpo = `escrito pelo teste em ${new Date().toISOString()}`;
  const hash = createHash("sha256").update(corpo).digest("hex").slice(0, 32);

  const posto = await fetch(`${WORKER}/f?k=${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "x-athena-sha256": hash,
      "content-type": "text/plain",
    },
    body: corpo,
  });
  console.log(`\nescrita: PUT -> ${posto.status}`);
  if (!posto.ok) {
    console.error(`  falhou: ${await posto.text()}`);
    console.error("  (se deu 405, o Worker no ar é o antigo — rode `npx wrangler deploy` em worker/)");
    falhas++;
  } else {
    const volta = await fetch(`${WORKER}/f?k=${encodeURIComponent(key)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const texto = await volta.text();
    const ok = texto === corpo && volta.headers.get("x-athena-sha256") === hash;
    console.log(`  releu igual e com o hash certo: ${ok ? "sim" : "NÃO"}`);
    if (!ok) falhas++;
  }
}

console.log(falhas ? `\n${falhas} problema(s).\n` : "\nPortão funcionando, leitura e escrita.\n");
process.exit(falhas ? 1 : 0);
