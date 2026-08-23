/**
 * athena-r2 — o portão do bucket.
 *
 * O bucket do R2 é privado, e continua privado. Este Worker é a única porta
 * por onde o app entra nele: recebe o token de acesso do Supabase (o mesmo do
 * login), descobre de quem é, e só entrega objeto que esteja debaixo da pasta
 * daquela conta.
 *
 * POR QUE ELE EXISTE: chave do R2 é simétrica — a mesma credencial que lê
 * também escreve e apaga, no bucket inteiro, e não existe versão "só leitura
 * pública" dela. Embutir isso no instalador seria entregar o bucket a quem
 * baixasse o app. Aqui a credencial não existe em lugar nenhum: o `r2_buckets`
 * do wrangler.jsonc liga o bucket ao Worker por binding, e a Cloudflare
 * resolve a autorização por dentro. Não há segredo do R2 no código, nem nas
 * vars, nem na máquina de ninguém.
 *
 * A ÚNICA REGRA DE ACESSO: a chave do objeto tem que começar com
 * `u/<id-do-usuário>/`. Simples de propósito — o dono está escrito na própria
 * chave, então não existe consulta que possa devolver "sim" por engano, nem
 * tabela que alguém possa envenenar registrando a chave de outra pessoa.
 * Conta A vê `u/A/...` e mais nada; conta B, `u/B/...`.
 *
 * Rotas (todas exigem `Authorization: Bearer <access_token>`):
 *
 *   GET  /list?prefixo=inatel       -> JSON com os objetos daquele grupo
 *   GET  /f?k=<chave>               -> o arquivo
 *   HEAD /f?k=<chave>               -> só os cabeçalhos (inclui x-athena-sha256)
 *   PUT  /f?k=<chave>               -> grava o arquivo
 *   DELETE /f?k=<chave>             -> apaga o arquivo (uma chave por vez)
 *   GET  /health                    -> "ok" (sem token)
 *
 * O PUT existe para o app poder PUBLICAR sem credencial do R2 — mesma regra do
 * GET, e é a regra que torna isso seguro: só grava debaixo de `u/<id>/`, então
 * ninguém escreve por cima do arquivo de outra conta. Apagar não existe de
 * propósito: o `athena publish` nunca removeu binário, e um bug do lado do
 * cliente não pode virar perda de material.
 */

/** Grupos que o app pode pedir. Fechado de propósito: nada de prefixo livre. */
const GRUPOS = new Set(["inatel", "raw-attachments"]);

/**
 * Cache de token -> id do usuário.
 *
 * Um `athena pull` baixa dezenas de arquivos, e cada pedido traria uma ida ao
 * Supabase só para reperguntar quem é o mesmo usuário do pedido anterior. O
 * isolate do Worker sobrevive entre requisições, então o cache corta isso para
 * praticamente uma consulta por sessão.
 *
 * Cinco minutos é curto por escolha: token revogado no Supabase para de valer
 * aqui em minutos, sem precisar de nenhum aviso do outro lado.
 */
const TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function usuarioDoToken(env, token) {
  const agora = Date.now();
  const emCache = cache.get(token);
  if (emCache && emCache.ate > agora) return emCache.id;

  // Limpeza preguiçosa: sem isto o Map cresceria a cada token novo.
  if (cache.size > 500) {
    for (const [k, v] of cache) if (v.ate <= agora) cache.delete(k);
  }

  const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return null;

  const user = await resp.json();
  if (!user?.id) return null;

  cache.set(token, { id: user.id, ate: agora + TTL_MS });
  return user.id;
}

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") return new Response("ok");
    if (!["GET", "HEAD", "PUT", "DELETE"].includes(request.method)) {
      return json({ erro: "Só GET, HEAD, PUT ou DELETE." }, 405);
    }

    const auth = request.headers.get("authorization") ?? "";
    const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    if (!token) return json({ erro: "Falta o token da conta." }, 401);

    const uid = await usuarioDoToken(env, token);
    if (!uid) return json({ erro: "Token inválido ou expirado. Entre de novo." }, 401);

    const meu = `u/${uid}/`;

    /* ---------- listar ---------- */
    if (url.pathname === "/list") {
      const grupo = url.searchParams.get("prefixo") ?? "";
      if (!GRUPOS.has(grupo)) return json({ erro: `Grupo desconhecido: ${grupo}` }, 400);

      const prefixo = `${meu}${grupo}/`;
      const objetos = [];
      let cursor;
      let truncado = true;

      while (truncado) {
        const lote = await env.BUCKET.list({ prefix: prefixo, cursor, include: ["customMetadata"] });
        for (const o of lote.objects) {
          objetos.push({
            key: o.key,
            // O caminho dentro da pasta local — `inatel/C09-x/aula.pdf` do
            // bucket vira `C09-x/aula.pdf` dentro de `raw/INATEL`.
            rel: o.key.slice(prefixo.length),
            size: o.size,
            sha256: o.customMetadata?.sha256 ?? null,
          });
        }
        truncado = lote.truncated;
        cursor = lote.truncated ? lote.cursor : undefined;
      }

      return json({ prefixo, objetos });
    }

    /* ---------- gravar ---------- */
    if (url.pathname === "/f" && request.method === "PUT") {
      const key = url.searchParams.get("k") ?? "";
      if (!key) return json({ erro: "Falta ?k=<chave>." }, 400);
      if (!key.startsWith(meu)) return json({ erro: "Esse caminho não é desta conta." }, 403);
      if (!request.body) return json({ erro: "Corpo vazio." }, 400);

      // O sha256 vem do cliente e serve para o publish seguinte saber que o
      // arquivo não mudou — é a mesma convenção que o athena-publish.mjs já
      // gravava como metadado no S3.
      const sha256 = request.headers.get("x-athena-sha256") ?? undefined;
      const contentType = request.headers.get("content-type") ?? undefined;

      try {
        await env.BUCKET.put(key, request.body, {
          httpMetadata: contentType ? { contentType } : undefined,
          customMetadata: sha256 ? { sha256 } : undefined,
        });
      } catch (e) {
        return json({ erro: `O R2 recusou a gravação: ${e.message}` }, 502);
      }
      return json({ ok: true, key });
    }

    /* ---------- apagar ---------- */
    if (url.pathname === "/f" && request.method === "DELETE") {
      const key = url.searchParams.get("k") ?? "";
      if (!key) return json({ erro: "Falta ?k=<chave>." }, 400);
      if (!key.startsWith(meu)) return json({ erro: "Esse arquivo não é desta conta." }, 403);

      // Uma chave por pedido, e nunca por prefixo: quem quiser apagar uma
      // pasta manda um pedido por arquivo. Apagar por prefixo transformaria um
      // erro de digitacao em perda de uma materia inteira num pedido so.
      try {
        await env.BUCKET.delete(key);
      } catch (e) {
        return json({ erro: `O R2 recusou a remoção: ${e.message}` }, 502);
      }
      return json({ ok: true, key });
    }

    /* ---------- baixar ---------- */
    if (url.pathname === "/f") {
      // A chave vai em query, não no caminho: nome de arquivo do INATEL tem
      // acento, espaço e parêntese, e no caminho isso passa por normalização
      // de URL antes de chegar aqui. Em `?k=` chega exatamente como saiu.
      const key = url.searchParams.get("k") ?? "";
      if (!key) return json({ erro: "Falta ?k=<chave>." }, 400);
      if (!key.startsWith(meu)) return json({ erro: "Esse arquivo não é desta conta." }, 403);

      const obj = await env.BUCKET.get(key);
      if (!obj) return json({ erro: "Arquivo não está no bucket." }, 404);

      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      headers.set("cache-control", "private, no-store");
      if (obj.customMetadata?.sha256) headers.set("x-athena-sha256", obj.customMetadata.sha256);

      return new Response(request.method === "HEAD" ? null : obj.body, { headers });
    }

    return json({ erro: "Rota desconhecida." }, 404);
  },
};
