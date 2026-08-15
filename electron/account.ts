import * as fs from "node:fs";
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

export type Account = { name: string; email: string };

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

function sessionFile(vaultRoot: string) {
  return path.join(vaultRoot, SESSION_REL);
}

/** Le o .env.local do athena-web sem validar nada alem do que usamos. */
function readEnv(vaultRoot: string): { url: string; key: string } {
  const file = path.join(vaultRoot, ENV_REL);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Nao achei ${ENV_REL} no vault. E de la que saem a URL e a chave publicavel do Supabase.`,
    );
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

export function hasSession(vaultRoot: string): boolean {
  return fs.existsSync(sessionFile(vaultRoot));
}

function saveSession(vaultRoot: string, refreshToken: string) {
  const file = sessionFile(vaultRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ refresh_token: refreshToken, saved_at: new Date().toISOString() }, null, 2),
    // Mesmo modo do CLI. No Windows o bit tem efeito limitado, mas manter
    // igual evita divergencia quando o vault for lido no Linux.
    { mode: 0o600 },
  );
}

export function logout(vaultRoot: string) {
  const file = sessionFile(vaultRoot);
  if (fs.existsSync(file)) fs.rmSync(file);
}

/**
 * Quem esta logado nesta maquina, ou null.
 * Rotaciona o refresh token, porque o Supabase invalida o anterior a cada uso.
 */
export async function status(vaultRoot: string): Promise<Account | null> {
  const file = sessionFile(vaultRoot);
  if (!fs.existsSync(file)) return null;

  let refresh_token: string;
  try {
    refresh_token = JSON.parse(fs.readFileSync(file, "utf8")).refresh_token;
  } catch {
    return null;
  }
  if (!refresh_token) return null;

  const supabase = makeClient(vaultRoot);
  const { data, error } = await supabase.auth.refreshSession({ refresh_token });
  if (error || !data.session || !data.user) return null;

  saveSession(vaultRoot, data.session.refresh_token);
  return {
    name: (data.user.user_metadata?.name as string) ?? data.user.email ?? "",
    email: data.user.email ?? "",
  };
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
  if (!data?.session) return null; // precisa confirmar o e-mail
  saveSession(vaultRoot, data.session.refresh_token);
  return {
    name: (data.user?.user_metadata?.name as string) ?? data.user?.email ?? "",
    email: data.user?.email ?? "",
  };
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
  const file = sessionFile(vaultRoot);
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
  return {
    name: (data.user.user_metadata?.name as string) ?? data.user.email ?? "",
    email: data.user.email ?? "",
  };
}
