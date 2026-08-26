/**
 * Teste do Worker, sem Cloudflare e sem rede.
 *
 *   node worker/teste.mjs
 *
 * Roda o `src/index.js` de verdade contra um bucket de mentira e um Supabase
 * de mentira, e cobre o que realmente pode quebrar: quem não tem token, quem
 * tem token de outra conta, e nome de arquivo com acento e espaço — que é a
 * regra e a exceção do vault do INATEL.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import worker from "./src/index.js";

/* ---------- bucket de mentira ---------- */

const objetos = new Map();
function guardar(key, texto, sha256) {
  objetos.set(key, { corpo: Buffer.from(texto, "utf8"), sha256 });
}

const BUCKET = {
  async list({ prefix = "", cursor, include }) {
    void include;
    const todas = [...objetos.keys()].filter((k) => k.startsWith(prefix)).sort();
    // Página de 2 de propósito: sem isso o laço de paginação nunca roda.
    const inicio = cursor ? Number(cursor) : 0;
    const fatia = todas.slice(inicio, inicio + 2);
    const fim = inicio + fatia.length;
    return {
      objects: fatia.map((k) => ({
        key: k,
        size: objetos.get(k).corpo.byteLength,
        customMetadata: { sha256: objetos.get(k).sha256 },
      })),
      truncated: fim < todas.length,
      cursor: fim < todas.length ? String(fim) : undefined,
    };
  },
  async put(key, body, opcoes) {
    const pedacos = [];
    for await (const p of body) pedacos.push(Buffer.from(p));
    objetos.set(key, {
      corpo: Buffer.concat(pedacos),
      sha256: opcoes?.customMetadata?.sha256 ?? null,
    });
  },
  async delete(key) {
    objetos.delete(key);
  },
  async get(key) {
    const o = objetos.get(key);
    if (!o) return null;
    return {
      body: o.corpo,
      httpEtag: `"${o.sha256}"`,
      customMetadata: { sha256: o.sha256 },
      writeHttpMetadata(h) {
        h.set("content-type", "application/octet-stream");
      },
    };
  },
};

/* ---------- Supabase de mentira ---------- */

const CONTAS = { "token-A": "aaaa-1111", "token-B": "bbbb-2222" };
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/auth/v1/user")) {
    const auth = init?.headers?.authorization ?? "";
    const id = CONTAS[auth.replace(/^Bearer /, "")];
    return id
      ? new Response(JSON.stringify({ id }), { headers: { "content-type": "application/json" } })
      : new Response("{}", { status: 401 });
  }
  return fetchReal(url, init);
};

const env = { BUCKET, SUPABASE_URL: "https://exemplo.supabase.co", SUPABASE_ANON_KEY: "anon" };

const A = "aaaa-1111";
const B = "bbbb-2222";
guardar(`u/${A}/inatel/C09-Computacao-Grafica/10. Operações no Domínio do Espaço.pdf`, "pdf-A", "h1");
guardar(`u/${A}/inatel/E09-Microcontroladores/Lógicas Bit a Bit.pdf`, "pdf-A2", "h2");
guardar(`u/${A}/inatel/T02-Redes/01 - Introdução.pdf`, "pdf-A3", "h3");
guardar(`u/${A}/raw-attachments/colada.png`, "png-A", "h4");
guardar(`u/${B}/inatel/D01-Outra-Materia/aula.pdf`, "pdf-B", "h5");

const chamar = (caminho, token, init = {}) =>
  worker.fetch(
    new Request(`https://athena-r2.exemplo.workers.dev${caminho}`, {
      ...init,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    }),
    env,
  );

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

console.log("\nathena-r2 — teste\n");

await caso("/health responde sem token", async () => {
  const r = await worker.fetch(new Request("https://x/health"), env);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "ok");
});

await caso("sem token, 401", async () => {
  assert.equal((await chamar("/list?prefixo=inatel")).status, 401);
  assert.equal((await chamar("/f?k=qualquer")).status, 401);
});

await caso("token desconhecido, 401", async () => {
  assert.equal((await chamar("/list?prefixo=inatel", "token-X")).status, 401);
});

await caso("grupo fora da lista, 400", async () => {
  assert.equal((await chamar("/list?prefixo=materials", "token-A")).status, 400);
  assert.equal((await chamar("/list?prefixo=", "token-A")).status, 400);
});

await caso("lista só o que é da conta, paginando até o fim", async () => {
  const r = await chamar("/list?prefixo=inatel", "token-A");
  assert.equal(r.status, 200);
  const { objetos: lista } = await r.json();
  assert.equal(lista.length, 3, `esperava 3, veio ${lista.length}`);
  assert.ok(lista.every((o) => o.key.startsWith(`u/${A}/`)));
  assert.ok(lista.some((o) => o.rel === "T02-Redes/01 - Introdução.pdf"));
  assert.equal(lista[0].sha256, "h1");
});

await caso("a conta B não enxerga nada da conta A", async () => {
  const { objetos: lista } = await (await chamar("/list?prefixo=inatel", "token-B")).json();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].rel, "D01-Outra-Materia/aula.pdf");
});

await caso("baixa arquivo com acento e espaço no nome", async () => {
  const key = `u/${A}/inatel/C09-Computacao-Grafica/10. Operações no Domínio do Espaço.pdf`;
  const r = await chamar(`/f?k=${encodeURIComponent(key)}`, "token-A");
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "pdf-A");
  assert.equal(r.headers.get("x-athena-sha256"), "h1");
});

await caso("pedir arquivo de outra conta dá 403", async () => {
  const key = `u/${A}/inatel/T02-Redes/01 - Introdução.pdf`;
  const r = await chamar(`/f?k=${encodeURIComponent(key)}`, "token-B");
  assert.equal(r.status, 403);
});

await caso("chave inventada dentro da própria conta dá 404", async () => {
  const r = await chamar(`/f?k=${encodeURIComponent(`u/${A}/inatel/nao-existe.pdf`)}`, "token-A");
  assert.equal(r.status, 404);
});

await caso("passeio por pasta (../) não escapa da conta", async () => {
  const r = await chamar(`/f?k=${encodeURIComponent(`u/${B}/../${A}/inatel/x.pdf`)}`, "token-B");
  // A chave não começa com `u/<B>/` depois do `..`? Começa — mas o R2 trata a
  // chave como texto, não como caminho: não existe objeto com esse nome.
  assert.ok(r.status === 403 || r.status === 404, `veio ${r.status}`);
});

/* ---------- gravar (o publish do app) ---------- */

await caso("grava na própria conta e lê de volta", async () => {
  const key = `u/${A}/raw-attachments/nova imagem (1).png`;
  const r = await chamar(`/f?k=${encodeURIComponent(key)}`, "token-A", {
    method: "PUT",
    body: "conteudo-novo",
    headers: { "x-athena-sha256": "hnovo", "content-type": "image/png" },
  });
  assert.equal(r.status, 200, await r.text());

  const volta = await chamar(`/f?k=${encodeURIComponent(key)}`, "token-A");
  assert.equal(await volta.text(), "conteudo-novo");
  assert.equal(volta.headers.get("x-athena-sha256"), "hnovo");
});

await caso("não grava na pasta de outra conta", async () => {
  const key = `u/${A}/inatel/invadido.pdf`;
  const r = await chamar(`/f?k=${encodeURIComponent(key)}`, "token-B", {
    method: "PUT",
    body: "lixo",
  });
  assert.equal(r.status, 403);
  assert.equal(objetos.has(key), false, "gravou mesmo com 403");
});

await caso("gravar sem token dá 401", async () => {
  const r = await chamar(`/f?k=${encodeURIComponent(`u/${A}/inatel/x.pdf`)}`, null, {
    method: "PUT",
    body: "lixo",
  });
  assert.equal(r.status, 401);
});

await caso("apaga o proprio arquivo", async () => {
  const key = `u/${A}/inatel/E09-Microcontroladores/Lógicas Bit a Bit.pdf`;
  assert.equal(objetos.has(key), true);
  const r = await chamar(`/f?k=${encodeURIComponent(key)}`, "token-A", { method: "DELETE" });
  assert.equal(r.status, 200, await r.text());
  assert.equal(objetos.has(key), false, "o objeto continuou no bucket");
  assert.equal((await chamar(`/f?k=${encodeURIComponent(key)}`, "token-A")).status, 404);
  // Devolve o objeto ao bucket de mentira: o caso de ponta a ponta la embaixo
  // conta os tres arquivos da conta A.
  guardar(key, "pdf-A2", "h2");
});

await caso("NAO apaga arquivo de outra conta", async () => {
  const key = `u/${B}/inatel/D01-Outra-Materia/aula.pdf`;
  const r = await chamar(`/f?k=${encodeURIComponent(key)}`, "token-A", { method: "DELETE" });
  assert.equal(r.status, 403);
  assert.equal(objetos.has(key), true, "apagou mesmo com 403");
});

await caso("apagar sem token dá 401", async () => {
  const key = `u/${A}/inatel/T02-Redes/01 - Introdução.pdf`;
  const r = await chamar(`/f?k=${encodeURIComponent(key)}`, null, { method: "DELETE" });
  assert.equal(r.status, 401);
  assert.equal(objetos.has(key), true, "apagou sem token");
});

await caso("método fora da lista continua 405", async () => {
  const r = await chamar(`/f?k=${encodeURIComponent(`u/${A}/inatel/x.pdf`)}`, "token-A", {
    method: "POST",
    body: "x",
  });
  assert.equal(r.status, 405);
});

/* ---------- ponta a ponta: o mesmo caminho que o app faz ---------- */

await caso("app baixa pelo HTTP de verdade, com o nome intacto", async () => {
  const servidor = createServer(async (req, res) => {
    const resp = await worker.fetch(
      new Request(`https://x${req.url}`, { headers: req.headers }),
      env,
    );
    res.writeHead(resp.status, Object.fromEntries(resp.headers));
    res.end(Buffer.from(await resp.arrayBuffer()));
  });
  await new Promise((ok) => servidor.listen(0, ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;

  try {
    const lista = await fetchReal(`${base}/list?prefixo=inatel`, {
      headers: { authorization: "Bearer token-A" },
    }).then((r) => r.json());

    for (const o of lista.objetos) {
      const r = await fetchReal(`${base}/f?k=${encodeURIComponent(o.key)}`, {
        headers: { authorization: "Bearer token-A" },
      });
      assert.equal(r.status, 200, `${o.rel}: HTTP ${r.status}`);
      const bytes = Buffer.from(await r.arrayBuffer());
      assert.equal(bytes.byteLength, o.size, `${o.rel}: tamanho diferente do listado`);
    }
    assert.equal(lista.objetos.length, 3);
  } finally {
    // Fechar de verdade, e ESPERAR. O `fetch` do Node deixa o socket aberto
    // (keep-alive), entao um `close()` solto devolve na hora com a conexao
    // ainda viva — e no Windows o processo morria logo depois com
    // `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`, um aborto do
    // libuv. O teste imprimia "Tudo certo" e mesmo assim saia com erro, o que
    // derrubava o `npm test` inteiro por um problema que nao era do Worker.
    servidor.closeAllConnections?.();
    await new Promise((ok) => servidor.close(ok));
  }
});

console.log(falhas ? `\n${falhas} falha(s).\n` : "\nTudo certo.\n");

// `exitCode` em vez de `process.exit()`: deixa o Node fechar o que ainda
// estiver aberto em vez de arrancar o processo no meio — foi essa pressa que
// disparava o aborto do libuv.
process.exitCode = falhas ? 1 : 0;

// Rede tem tempo proprio: se um socket keep-alive segurar o processo, saia
// assim mesmo. O veredito ja foi impresso, e travar o `npm test` esperando um
// socket ocioso seria pior que sair. `unref` para este timer nao ser motivo
// de o processo continuar vivo.
setTimeout(() => process.exit(process.exitCode ?? 0), 3000).unref();
