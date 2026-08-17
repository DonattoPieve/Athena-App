import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Conta do Athena (Supabase) — a MESMA sessao do `athena login`.
 *
 * Este arquivo nao inventa um login proprio: le e escreve o
 * `<vault>/.athena/session.json` no formato exato de
 * athena-web/scripts/lib/session.mjs, e le as credenciais do
 * `athena-web/.env.local`. Entrar pelo app e entrar pelo terminal sao a
 * mesma coisa, e sair num lugar desloga no outro.
 *
 * O que fica em disco e o refresh token, nunca a senha. A SERVICE_ROLE
 * continua sem existir no projeto — o app escreve como usuario normal e
 * apanha do RLS igual a todo mundo.
 *
 * ATENCAO: se o formato do session.json mudar la, muda aqui junto.
 */

/**
 * O createClient monta um cliente de realtime que exige `WebSocket` global. O
 * Node do Electron 31 (20.x) nao tem, e o login morria com "native WebSocket
 * not found" antes de tocar a rede. O Athena nao usa realtime em lugar nenhum:
 * o stub satisfaz a checagem e explode se alguem tentar usar de verdade.
 *
 * Mesma solucao de athena-web/scripts/lib/session.mjs — se um dia sair de la,
 * sai daqui junto.
 */
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = class {
    constructor() {
      throw new Error("realtime nao e usado no Athena");
    }
  };
}

export type Account = {
  id: string;
  name: string;
  email: string;
  /** URL publica do avatar, ou null. Vem de `profiles.avatar_url`. */
  avatarUrl: string | null;
  /**
   * Entrou pelo cache porque a rede falhou. O vault e local: ficar trancado
   * fora dele por falta de internet seria absurdo. Publish e pull ficam
   * bloqueados — o resto funciona.
   */
  offline?: boolean;
};

/**
 * Cache da ultima conta que entrou nesta maquina.
 *
 * Arquivo PROPRIO, nao dentro do session.json: aquele tem formato combinado
 * com o CLI do vault. Cache e coisa do app.
 */
function arquivoConta(): string {
  return path.join(PASTA_SESSAO, "app-conta.json");
}

function guardarConta(c: Account) {
  try {
    fs.mkdirSync(PASTA_SESSAO, { recursive: true });
    fs.writeFileSync(
      arquivoConta(),
      JSON.stringify({ id: c.id, name: c.name, email: c.email, avatarUrl: c.avatarUrl }, null, 2),
      "utf8",
    );
  } catch {
    // cache e conveniencia; falhar aqui nao pode derrubar um login que deu certo
  }
}

function contaEmCache(): Account | null {
  try {
    const c = JSON.parse(fs.readFileSync(arquivoConta(), "utf8"));
    if (!c?.email) return null;
    return { id: c.id ?? "", name: c.name ?? c.email, email: c.email, avatarUrl: c.avatarUrl ?? null };
  } catch {
    return null;
  }
}

/**
 * A falha foi de REDE ou a sessao morreu de verdade?
 *
 * A diferenca decide entre "siga offline" e "entre de novo". Errar para o lado
 * do offline com um token revogado seria pior: a pessoa acharia que esta
 * logada e o publish quebraria depois.
 */
function ehFalhaDeRede(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("network") ||
    m.includes("enotfound") ||
    m.includes("econnrefused") ||
    m.includes("etimedout") ||
    m.includes("timeout") ||
    m.includes("dns")
  );
}

const BUCKET = "avatars";

/**
 * Cliente com a sessao do disco ja carregada.
 *
 * O `refreshSession` roda o token e devolve a sessao, mas nao a instala no
 * cliente — sem o `setSession` o Storage sobe como anonimo e a policy recusa.
 * Foi assim que o primeiro upload voltou "new row violates row-level security".
 */
export async function clienteAutenticado(vaultRoot: string) {
  const file = sessionFile();
  if (!fs.existsSync(file)) throw new Error("Sem sessão nesta máquina.");
  const { refresh_token } = JSON.parse(fs.readFileSync(file, "utf8"));

  const supabase = makeClient(vaultRoot);
  const { data, error } = await supabase.auth.refreshSession({ refresh_token });
  if (error || !data.session || !data.user) throw new Error("Sessão expirada. Entre de novo.");
  saveSession(vaultRoot, data.session.refresh_token);
  await supabase.auth.setSession(data.session);
  // A sessao vai junto porque o `access_token` e o que o Worker do R2 pede
  // para provar de quem e o pedido (ver bootstrap.ts). Ele so existe aqui: o
  // cliente nao o expoe depois, e reler o arquivo daria o refresh token, que
  // e outra coisa.
  return { supabase, user: data.user, session: data.session };
}

/** Le o avatar do perfil. Falha aqui nao pode derrubar o login. */
async function avatarDe(supabase: SupabaseClient, id: string): Promise<string | null> {
  try {
    const { data } = await supabase.from("profiles").select("avatar_url").eq("id", id).maybeSingle();
    return (data?.avatar_url as string) ?? null;
  } catch {
    return null;
  }
}

/** Monta o Account a partir do usuario do Supabase, com o nome de vários lugares. */
async function contaDe(
  supabase: SupabaseClient,
  u: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
): Promise<Account> {
  const m = u.user_metadata ?? {};
  return {
    id: u.id,
    name:
      (m.name as string) ??
      (m.full_name as string) ??
      (m.user_name as string) ??
      u.email ??
      "",
    email: u.email ?? "",
    avatarUrl: await avatarDe(supabase, u.id),
  };
}

/**
 * O Supabase responde em ingles e em linguagem de API. Quem le e voce, no meio
 * de uma tentativa de login — a mensagem precisa dizer o que fazer a seguir.
 */
function emPortugues(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) {
    return "E-mail ou senha inválida, por favor tente novamente.";
  }
  if (m.includes("email not confirmed")) {
    return "Esta conta ainda não confirmou o e-mail. Procure a mensagem de confirmação do Supabase.";
  }
  if (m.includes("too many requests") || m.includes("rate limit")) {
    return "Tentativas demais em pouco tempo. Espere um minuto e tente de novo.";
  }
  if (m.includes("fetch failed") || m.includes("network") || m.includes("enotfound")) {
    return "Não consegui falar com o Supabase. Verifique sua conexão e tente de novo.";
  }
  // Os dois tropecos de configuracao do OAuth. Sem traduzir, a tela mostra
  // "Unsupported provider" e ninguem descobre que falta ligar um botao no
  // painel do Supabase.
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) {
    return "Esse provedor ainda não está ligado no Supabase (Authentication → Providers).";
  }
  if (m.includes("redirect") && (m.includes("not allowed") || m.includes("invalid"))) {
    return `O Supabase recusou o endereço de retorno. Adicione ${REDIRECT} em Authentication → URL Configuration → Redirect URLs.`;
  }
  return msg;
}

/**
 * Criar conta. O trigger `on_auth_user_created` do schema cria a linha em
 * `profiles` sozinho — o app nao escreve nessa tabela.
 *
 * Se o projeto exigir confirmacao de e-mail, o Supabase devolve usuario sem
 * sessao: nesse caso avisamos em vez de fingir que entrou.
 */


const SESSION_REL = path.join(".athena", "session.json");
const ENV_REL = path.join("athena-web", ".env.local");

/**
 * Credenciais publicas do Supabase, embutidas no app como ultimo recurso.
 *
 * Um vault criado pelo "Primeiro uso" (ver bootstrap.ts) nao tem `athena-web/`
 * clonado — sem isto, `readEnv` nunca acharia URL nem chave, e login virava
 * impossivel sem clonar o repo do site primeiro, exatamente o que o
 * bootstrap existe pra eliminar.
 *
 * E SEGURO embutir: e a chave "anon", protegida por RLS em toda tabela do
 * projeto — a MESMA que o athena-web hoje expoe no navegador de qualquer
 * visitante do site. Continua nao existindo SERVICE_ROLE em lugar nenhum
 * deste app (nem o projeto tem uma gerada pra uso externo).
 *
 * So entra em jogo quando o arquivo NAO existe. Se existir mas estiver
 * incompleto, o erro original abaixo continua valendo — misturar com o
 * padrao em silencio arriscaria logar/publicar numa conta diferente da que
 * a pessoa configurou de proposito.
 */
const SUPABASE_PADRAO = {
  url: "https://cxlfnpzdsaiyuazqdjtw.supabase.co",
  key:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4bGZucHpkc2FpeXVhenFkanR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU1NDcxMTgsImV4cCI6MjEwMTEyMzExOH0.ONCO582MyotpGgbZ3phvbYjVjuoxf2-MwBgBjtvV9WM",
};

/* ------------------------------------------------------------------ *
 * Onde mora a sessao
 *
 * Era `<vault>/.athena/session.json`, dentro do vault, para o app e o
 * `athena login` do terminal compartilharem o MESMO arquivo. Isso deixou de
 * poder ser assim quando o vault passou a depender da conta: para saber qual
 * pasta abrir e preciso ja saber quem entrou, e a sessao nao pode morar dentro
 * da resposta. Agora ela fica com os dados do app (`%APPDATA%\athena-app`),
 * que ja e por usuario do Windows.
 *
 * O ESPELHO preserva o terminal: quando o vault ativo tem `athena-web/` (vault
 * do jeito antigo, com os scripts dentro), a mesma sessao e copiada para
 * `<vault>/.athena/session.json` e `athena publish`/`pull` continuam entrando
 * sozinhos, como sempre foi.
 * ------------------------------------------------------------------ */

let PASTA_SESSAO = "";
let ESPELHO: string | null = null;

/** Chamado uma vez, na subida do app, com `app.getPath("userData")`. */
export function configurarSessao(pastaDoApp: string) {
  PASTA_SESSAO = pastaDoApp;
}

/** Liga (ou desliga) a copia da sessao para dentro do vault ativo. */
export function espelharSessaoEm(vaultRoot: string | null) {
  ESPELHO =
    vaultRoot && fs.existsSync(path.join(vaultRoot, "athena-web")) ? vaultRoot : null;
  const atual = sessionFile();
  if (ESPELHO && fs.existsSync(atual)) {
    try {
      escreverEspelho(fs.readFileSync(atual, "utf8"));
    } catch {
      // espelho e conveniencia para o CLI; falhar aqui nao afeta o app
    }
  }
}

/**
 * Traz a sessao de um vault do jeito antigo para o lugar novo.
 *
 * Sem isto, quem ja usava o app seria deslogado na primeira abertura depois
 * desta mudanca — sessao valida no disco, ignorada por estar na pasta errada.
 */
export function importarSessaoAntiga(vaultRoot: string | null) {
  if (!vaultRoot || fs.existsSync(sessionFile())) return;
  const antigo = path.join(vaultRoot, SESSION_REL);
  if (!fs.existsSync(antigo)) return;
  try {
    fs.mkdirSync(PASTA_SESSAO, { recursive: true });
    fs.copyFileSync(antigo, sessionFile());
  } catch {
    // sem drama: cai na tela de login
  }
}

function escreverEspelho(conteudo: string) {
  if (!ESPELHO) return;
  fs.mkdirSync(path.join(ESPELHO, ".athena"), { recursive: true });
  fs.writeFileSync(path.join(ESPELHO, SESSION_REL), conteudo, { mode: 0o600 });
}

/** O `vaultRoot` das funcoes abaixo nao manda mais aqui — a sessao e do app. */
function sessionFile() {
  return path.join(PASTA_SESSAO, "session.json");
}

/** Le o .env.local do athena-web; sem ele, cai nas credenciais embutidas. */
function readEnv(vaultRoot: string): { url: string; key: string } {
  // Login acontece ANTES de existir vault (e ele que decide qual pasta abrir):
  // nesse momento so as credenciais embutidas existem, e sao as certas.
  if (!vaultRoot) return SUPABASE_PADRAO;
  const file = path.join(vaultRoot, ENV_REL);
  if (!fs.existsSync(file)) {
    return SUPABASE_PADRAO;
  }
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(`${ENV_REL} sem NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY.`);
  }
  return { url, key };
}

function makeClient(vaultRoot: string): SupabaseClient {
  const { url, key } = readEnv(vaultRoot);
  // Quem persiste a sessao e este modulo, no arquivo compartilhado com o CLI.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function hasSession(_vaultRoot?: string): boolean {
  return fs.existsSync(sessionFile());
}

function saveSession(_vaultRoot: string, refreshToken: string) {
  const file = sessionFile();
  const conteudo = JSON.stringify(
    { refresh_token: refreshToken, saved_at: new Date().toISOString() },
    null,
    2,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    conteudo,
    // Mesmo modo do CLI. No Windows o bit tem efeito limitado, mas manter
    // igual evita divergencia quando o vault for lido no Linux.
    { mode: 0o600 },
  );
  try {
    escreverEspelho(conteudo);
  } catch {
    // o espelho e para o CLI; se falhar, o app continua logado
  }
}

export function logout(_vaultRoot?: string) {
  const file = sessionFile();
  if (fs.existsSync(file)) fs.rmSync(file);
  // Sem isto o modo offline ressuscitaria a conta de quem acabou de sair.
  if (fs.existsSync(arquivoConta())) fs.rmSync(arquivoConta());
  // Sair no app tem que sair no terminal tambem — sempre foi o mesmo login.
  if (ESPELHO) {
    const espelho = path.join(ESPELHO, SESSION_REL);
    if (fs.existsSync(espelho)) fs.rmSync(espelho);
  }
  ESPELHO = null;
}

/**
 * Quem esta logado nesta maquina, ou null.
 * Rotaciona o refresh token, porque o Supabase invalida o anterior a cada uso.
 */
export async function status(vaultRoot: string): Promise<Account | null> {
  const file = sessionFile();
  if (!fs.existsSync(file)) return null;

  let refresh_token: string;
  try {
    refresh_token = JSON.parse(fs.readFileSync(file, "utf8")).refresh_token;
  } catch {
    return null;
  }
  if (!refresh_token) return null;

  const supabase = makeClient(vaultRoot);

  let data;
  try {
    const r = await supabase.auth.refreshSession({ refresh_token });
    if (r.error) throw new Error(r.error.message);
    data = r.data;
  } catch (e) {
    // Sem rede o vault continua no disco. Entrar pelo cache e o certo aqui;
    // devolver null jogaria a pessoa numa tela de login que tambem precisa
    // de rede — ou seja, porta trancada por fora.
    const cache = ehFalhaDeRede(e) ? contaEmCache() : null;
    return cache ? { ...cache, offline: true } : null;
  }
  if (!data.session || !data.user) return null;

  saveSession(vaultRoot, data.session.refresh_token);
  await supabase.auth.setSession(data.session);
  const conta = await contaDe(supabase, data.user);
  guardarConta(conta);
  return conta;
}

export async function signUp(
  vaultRoot: string,
  email: string,
  password: string,
  nome: string,
): Promise<Account | null> {
  const supabase = makeClient(vaultRoot);
  const { data, error } = await supabase.auth
    .signUp({ email, password, options: { data: { name: nome } } })
    .catch((e: Error) => ({ data: null, error: e as unknown as { message: string } }));

  if (error) throw new Error(emPortugues(error.message));
  if (!data?.session || !data.user) return null; // precisa confirmar o e-mail
  saveSession(vaultRoot, data.session.refresh_token);
  await supabase.auth.setSession(data.session);
  return contaDe(supabase, data.user);
}

/**
 * Troca de e-mail e de senha usam a sessao atual. O Supabase costuma exigir
 * confirmacao no e-mail NOVO antes de valer — por isso o retorno diz se ja
 * valeu ou se ha um e-mail esperando confirmacao.
 */
export async function updateAccount(
  vaultRoot: string,
  campos: { email?: string; password?: string; nome?: string },
): Promise<{ pendente: boolean }> {
  const file = sessionFile();
  if (!fs.existsSync(file)) throw new Error("Sem sessao nesta maquina.");
  const { refresh_token } = JSON.parse(fs.readFileSync(file, "utf8"));

  const supabase = makeClient(vaultRoot);
  const sessao = await supabase.auth.refreshSession({ refresh_token });
  if (sessao.error || !sessao.data.session) {
    throw new Error("Sessao expirada. Entre de novo.");
  }
  saveSession(vaultRoot, sessao.data.session.refresh_token);

  const { data, error } = await supabase.auth.updateUser({
    ...(campos.email ? { email: campos.email } : {}),
    ...(campos.password ? { password: campos.password } : {}),
    ...(campos.nome ? { data: { name: campos.nome } } : {}),
  });
  if (error) throw new Error(emPortugues(error.message));

  // e-mail novo so vale depois da confirmacao; ate la o antigo continua.
  const pendente = !!campos.email && data.user?.email !== campos.email;
  return { pendente };
}

/* ------------------------------------------------------------------ *
 * Foto de perfil
 * ------------------------------------------------------------------ */

const TIPOS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Mesmo teto do bucket. Checar aqui da erro em portugues em vez de HTTP 413. */
const TETO = 2 * 1024 * 1024;

/** `avatars/<uid>/arquivo` — as policies leem o uid da primeira pasta. */
function caminhoDoObjeto(url: string): string | null {
  const i = url.indexOf(`/${BUCKET}/`);
  return i === -1 ? null : url.slice(i + BUCKET.length + 2).split("?")[0];
}

/**
 * Sobe a foto e aponta `profiles.avatar_url` para ela.
 *
 * Nome unico a cada envio, e o anterior e apagado depois. Sobrescrever um nome
 * fixo seria mais simples, mas a URL publica e cacheada pelo Chromium e pelo
 * navegador do site: a pessoa trocaria a foto e continuaria vendo a antiga.
 */
export async function avatarUpload(vaultRoot: string, arquivo: string): Promise<Account> {
  const ext = path.extname(arquivo).toLowerCase();
  const contentType = TIPOS[ext];
  if (!contentType) {
    throw new Error("Formato não aceito. Use PNG, JPG, WEBP ou GIF.");
  }
  const bytes = fs.readFileSync(arquivo);
  if (bytes.byteLength > TETO) {
    throw new Error(
      `A imagem tem ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB e o limite é 2 MB.`,
    );
  }

  const { supabase, user } = await clienteAutenticado(vaultRoot);
  const anterior = await avatarDe(supabase, user.id);
  const destino = `${user.id}/${Date.now()}${ext}`;

  const up = await supabase.storage.from(BUCKET).upload(destino, bytes, { contentType });
  if (up.error) throw new Error(emPortugues(up.error.message));

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(destino);
  const gravou = await supabase
    .from("profiles")
    .update({ avatar_url: pub.publicUrl })
    .eq("id", user.id);
  if (gravou.error) {
    // Sem a linha em `profiles` a imagem virava lixo invisivel no bucket.
    await supabase.storage.from(BUCKET).remove([destino]);
    throw new Error(emPortugues(gravou.error.message));
  }

  const velho = anterior && caminhoDoObjeto(anterior);
  if (velho && velho !== destino) {
    // Falhar aqui e desperdicio de bytes, nao erro do usuario.
    await supabase.storage.from(BUCKET).remove([velho]).catch(() => {});
  }

  return { ...(await contaDe(supabase, user)), avatarUrl: pub.publicUrl };
}

export async function avatarRemove(vaultRoot: string): Promise<Account> {
  const { supabase, user } = await clienteAutenticado(vaultRoot);
  const atual = await avatarDe(supabase, user.id);

  const gravou = await supabase.from("profiles").update({ avatar_url: null }).eq("id", user.id);
  if (gravou.error) throw new Error(emPortugues(gravou.error.message));

  const alvo = atual && caminhoDoObjeto(atual);
  if (alvo) await supabase.storage.from(BUCKET).remove([alvo]).catch(() => {});

  return { ...(await contaDe(supabase, user)), avatarUrl: null };
}

/* ------------------------------------------------------------------ *
 * Entrar com GitHub / Google
 * ------------------------------------------------------------------ */

export type Provedor = "github" | "google";

/**
 * Porta FIXA de proposito. O Supabase so redireciona para URLs que estao na
 * allowlist do projeto (Authentication > URL Configuration > Redirect URLs), e
 * porta sorteada obrigaria a cadastrar um curinga la. Uma porta fixa e uma
 * linha na allowlist:
 *
 *   http://127.0.0.1:53682/callback
 */
const PORTA_OAUTH = 53682;
const REDIRECT = `http://127.0.0.1:${PORTA_OAUTH}/callback`;
const ESPERA_MS = 3 * 60 * 1000;

/**
 * O fluxo PKCE guarda o "code verifier" no storage do cliente entre abrir o
 * navegador e trocar o codigo pela sessao. O Node nao tem localStorage — este
 * Map faz o papel, e some junto com o login. Nao pode ser o mesmo cliente do
 * login por senha: aquele nao persiste nada de proposito.
 */
function clienteOAuth(vaultRoot: string): SupabaseClient {
  const { url, key } = readEnv(vaultRoot);
  const mem = new Map<string, string>();
  return createClient(url, key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      },
    },
  });
}

function pagina(titulo: string, texto: string, cor: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Athena</title></head>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0A0A0C;
color:#E8E6EE;font:15px/1.5 system-ui,Segoe UI,sans-serif">
<div style="text-align:center;max-width:420px;padding:24px">
<div style="font-size:34px;font-weight:600;color:${cor};margin-bottom:10px">${titulo}</div>
<p style="color:#9A93AA;margin:0">${texto}</p></div></body></html>`;
}

/**
 * Tentativa de OAuth em andamento.
 *
 * Fechar a aba do navegador nao avisa ninguem: sem isto o servidor local ficava
 * de pe ate o timeout de 3 minutos, segurando a porta e a promessa. A proxima
 * tentativa batia em EADDRINUSE e a tela ficava travada esperando um retorno
 * que nunca vinha.
 */
let oauthEmAndamento: (() => void) | null = null;

/** Desiste da tentativa atual, se houver. Idempotente de proposito. */
export function oauthCancel(): boolean {
  const cancelar = oauthEmAndamento;
  oauthEmAndamento = null;
  cancelar?.();
  return true;
}

/**
 * Abre o provedor no navegador do sistema e espera o retorno num servidor
 * local. Fica no navegador, e nao numa janela do Electron, porque Google e
 * GitHub recusam login dentro de webview embutida — e porque assim a pessoa
 * ve a barra de endereco de verdade antes de digitar a senha.
 */
export async function oauthLogin(
  vaultRoot: string,
  provider: Provedor,
  abrir: (url: string) => void,
): Promise<Account> {
  // Clicar em Google e depois em GitHub e comum; a porta e uma so.
  oauthCancel();
  const supabase = clienteOAuth(vaultRoot);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    throw new Error(
      emPortugues(error?.message ?? "Não consegui montar o endereço de login."),
    );
  }

  const code = await new Promise<string>((resolve, reject) => {
    const servidor = http.createServer((req, res) => {
      const u = new URL(req.url ?? "/", REDIRECT);
      if (u.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const codigo = u.searchParams.get("code");
      const erro = u.searchParams.get("error_description") ?? u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        codigo
          ? pagina("Pronto", "Pode fechar esta aba e voltar para o Athena.", "#8B5CF6")
          : pagina("Não deu", erro ?? "O provedor não devolveu um código.", "#e24b4a"),
      );
      fechar();
      codigo ? resolve(codigo) : reject(new Error(erro ?? "Login cancelado."));
    });

    const relogio = setTimeout(() => {
      fechar();
      reject(new Error("O login demorou demais. Tente de novo."));
    }, ESPERA_MS);

    function fechar() {
      clearTimeout(relogio);
      oauthEmAndamento = null;
      servidor.close();
      // Conexao keep-alive do navegador segura o close(); sem isto a porta
      // continua ocupada depois de cancelar.
      servidor.closeAllConnections?.();
    }

    // Quem desiste e a tela, quando a pessoa volta para o campo de e-mail.
    oauthEmAndamento = () => {
      fechar();
      reject(new Error("Login por provedor cancelado."));
    };

    servidor.on("error", (e: NodeJS.ErrnoException) => {
      fechar();
      reject(
        new Error(
          e.code === "EADDRINUSE"
            ? `A porta ${PORTA_OAUTH} está ocupada. Feche a outra tentativa de login e repita.`
            : e.message,
        ),
      );
    });

    servidor.listen(PORTA_OAUTH, "127.0.0.1", () => abrir(data.url));
  });

  const troca = await supabase.auth.exchangeCodeForSession(code);
  if (troca.error || !troca.data.session || !troca.data.user) {
    throw new Error(emPortugues(troca.error?.message ?? "Não consegui concluir o login."));
  }
  saveSession(vaultRoot, troca.data.session.refresh_token);
  await supabase.auth.setSession(troca.data.session);
  const conta = await contaDe(supabase, troca.data.user);
  guardarConta(conta);
  return conta;
}

export async function login(
  vaultRoot: string,
  email: string,
  password: string,
): Promise<Account> {
  const supabase = makeClient(vaultRoot);
  const { data, error } = await supabase.auth
    .signInWithPassword({ email, password })
    // Falha de rede vira excecao, nao `error` — sem isto o usuario recebe
    // "fetch failed" cru vindo do undici.
    .catch((e: Error) => ({ data: null, error: e as unknown as { message: string } }));

  if (error || !data?.session || !data?.user) {
    throw new Error(emPortugues(error?.message ?? "Não consegui entrar."));
  }
  saveSession(vaultRoot, data.session.refresh_token);
  await supabase.auth.setSession(data.session);
  return contaDe(supabase, data.user);
}
