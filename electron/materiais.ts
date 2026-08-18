import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import { clienteAutenticado } from "./account";

/**
 * Material pesado sob demanda — o PDF só desce quando alguém precisa dele.
 *
 * O PROBLEMA QUE ISTO RESOLVE: `raw/INATEL` tem 340 MB, e o primeiro uso num
 * PC novo baixava tudo antes de deixar a pessoa entrar. Numa rede lenta isso é
 * meia hora olhando uma barra — para material que, na prática, ela vai abrir
 * dois ou três arquivos.
 *
 * COMO FICA: o primeiro uso traz só o texto (páginas e notas, alguns MB). Cada
 * binário é buscado na PRIMEIRA vez que é aberto e guardado em
 * `%APPDATA%\athena-app\cache`. Da segunda em diante sai do disco — e sem
 * internet também, que era a exigência: uma vez visto, sempre disponível.
 *
 * A ORDEM DE BUSCA é sempre a mesma, e o disco vem antes da rede:
 *
 *   1. o vault (quem já tinha tudo baixado continua lendo de lá)
 *   2. o cache
 *   3. o Worker do R2 — e o que vier é gravado no cache
 *
 * O INGEST é a exceção, e é de propósito: quem lê o PDF ali é o Claude Code,
 * não o app, e o `CLAUDE.md` manda ele abrir `raw/INATEL/...`. Cache não serve
 * — o arquivo precisa estar no caminho de verdade. Por isso `garantirNoVault`
 * baixa para dentro do vault antes de o comando rodar. Sem isso, num PC novo o
 * ingest geraria a página só com a nota do aluno: com cara de pronta e sem
 * lastro no que o professor cobrou.
 */

/* ------------------------------------------------------------------ *
 * O portão (Worker) — ver worker/README.md
 * ------------------------------------------------------------------ */

/**
 * Endereço do Worker, embutido no app.
 *
 * Preencha depois do `npx wrangler deploy` (o comando imprime a URL). Vazio, o
 * app segue funcionando e só avisa que o material não veio.
 */
const WORKER_PADRAO = "https://athena-r2.donatto-athena.workers.dev";

export function urlWorker(vaultRoot: string): string {
  const doArquivo = lerEnvLocal(path.join(vaultRoot, "athena-web", ".env.local"));
  const url = process.env.ATHENA_R2_WORKER || doArquivo.ATHENA_R2_WORKER || WORKER_PADRAO;
  return url.replace(/\/+$/, "");
}

function lerEnvLocal(arquivo: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fsSync.existsSync(arquivo)) return out;
  for (const linha of fsSync.readFileSync(arquivo, "utf8").split("\n")) {
    const l = linha.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  }
  return out;
}

export type ObjetoRemoto = {
  /** Chave completa no bucket, já com o `u/<id>/` na frente. */
  key: string;
  /** Caminho dentro da pasta local (`C09-.../aula.pdf`). */
  rel: string;
  size: number;
  /** sha256 curto que o publish gravou como metadado; null nos objetos antigos. */
  sha256: string | null;
};

/** Traduz a resposta do Worker para algo que faça sentido na tela. */
async function erroDoWorker(resp: Response, oque: string): Promise<Error> {
  if (resp.status === 401) return new Error("Sessão expirada. Entre de novo e repita.");
  if (resp.status === 403) return new Error("O Worker recusou: esse arquivo não é desta conta.");
  let detalhe = "";
  try {
    detalhe = ((await resp.json()) as { erro?: string }).erro ?? "";
  } catch {
    // resposta sem JSON (502 da Cloudflare, por exemplo) — o status já diz o bastante
  }
  return new Error(`${oque} falhou (HTTP ${resp.status}${detalhe ? `: ${detalhe}` : ""}).`);
}

export type Grupo = "inatel" | "raw-attachments";

/**
 * O token de acesso vale ~1 h; guardar por 30 min evita um `refreshSession`
 * (ida ao Supabase) a cada arquivo aberto, sem chegar perto do vencimento.
 */
let token: { valor: string; ate: number } | null = null;

async function tokenDaConta(vaultRoot: string): Promise<string> {
  const agora = Date.now();
  if (token && token.ate > agora) return token.valor;
  const { session } = await clienteAutenticado(vaultRoot);
  token = { valor: session.access_token, ate: agora + 30 * 60 * 1000 };
  return token.valor;
}

/**
 * Listagem por grupo, guardada enquanto o app estiver aberto.
 *
 * Ela só muda quando alguém publica de outra máquina — e nesse caso o arquivo
 * novo aparece na próxima abertura do app. Reler a cada PDF aberto seria uma
 * ida à rede para responder sempre a mesma coisa.
 */
const listagens = new Map<Grupo, ObjetoRemoto[]>();

export async function listar(vaultRoot: string, grupo: Grupo): Promise<ObjetoRemoto[]> {
  const guardada = listagens.get(grupo);
  if (guardada) return guardada;

  const worker = urlWorker(vaultRoot);
  if (!worker) throw new Error("O portão do R2 não foi publicado neste app.");

  const resp = await fetch(`${worker}/list?prefixo=${encodeURIComponent(grupo)}`, {
    headers: { authorization: `Bearer ${await tokenDaConta(vaultRoot)}` },
  });
  if (!resp.ok) throw await erroDoWorker(resp, "a listagem");
  const { objetos } = (await resp.json()) as { objetos: ObjetoRemoto[] };
  listagens.set(grupo, objetos ?? []);
  return objetos ?? [];
}

/** Esquece as listagens — usado quando o vault (ou a conta) muda. */
export function esquecer() {
  listagens.clear();
  token = null;
}

async function baixar(vaultRoot: string, key: string): Promise<Buffer> {
  const worker = urlWorker(vaultRoot);
  // A chave vai em query: nome de arquivo do INATEL tem acento, espaço e
  // parêntese, e no caminho da URL isso passaria por normalização antes de
  // chegar no Worker.
  const resp = await fetch(`${worker}/f?k=${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${await tokenDaConta(vaultRoot)}` },
  });
  if (!resp.ok) throw await erroDoWorker(resp, `o download de "${key}"`);
  return Buffer.from(await resp.arrayBuffer());
}

/**
 * Grava um objeto no bucket pelo Worker — o caminho de subida da publicação.
 *
 * O `sha256` vai em cabeçalho porque é ele que o publish SEGUINTE lê na
 * listagem para decidir que o arquivo não mudou; sem o metadado, cada
 * publicação reenviaria os 340 MB do material do professor. Mesma convenção
 * que o `athena-publish.mjs` já gravava no S3.
 */
export async function subir(
  vaultRoot: string,
  key: string,
  bytes: Buffer,
  sha256: string,
  contentType: string,
): Promise<void> {
  const worker = urlWorker(vaultRoot);
  if (!worker) throw new Error("O portão do R2 não foi publicado neste app.");

  const resp = await fetch(`${worker}/f?k=${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${await tokenDaConta(vaultRoot)}`,
      "x-athena-sha256": sha256,
      "content-type": contentType,
    },
    body: bytes,
  });
  if (!resp.ok) throw await erroDoWorker(resp, `o envio de "${key}"`);
}

/* ------------------------------------------------------------------ *
 * Cache
 * ------------------------------------------------------------------ */

/**
 * Fica em `%APPDATA%\athena-app\cache`, não no `%TEMP%` do Windows.
 *
 * O `%TEMP%` é apagado sozinho — Limpeza de Disco, Sensor de Armazenamento —
 * e sumiria justamente no dia sem internet, que é quando o cache mais vale.
 */
export function pastaCache(): string {
  return path.join(app.getPath("userData"), "cache");
}

/** `raw/INATEL/C09-x/aula.pdf` -> { grupo: "inatel", rel: "C09-x/aula.pdf" } */
function partirRel(relVault: string): { grupo: Grupo; rel: string } | null {
  const limpo = relVault.replace(/\\/g, "/").replace(/^\/+/, "");
  const m = /^raw\/INATEL\/(.+)$/.exec(limpo);
  if (m) return { grupo: "inatel", rel: m[1] };
  const a = /^raw\/attachments\/(.+)$/.exec(limpo);
  if (a) return { grupo: "raw-attachments", rel: a[1] };
  return null;
}

/**
 * Devolve um caminho local legível para um arquivo do vault, buscando na rede
 * se preciso. `null` quando não é material remoto ou não existe em lugar nenhum.
 *
 * É o que o protocolo `athena://file/...` chama quando não acha o arquivo no
 * disco — ou seja, abrir um PDF na interface já basta para trazê-lo.
 */
export async function garantirParaLeitura(
  vaultRoot: string,
  relVault: string,
): Promise<string | null> {
  const alvo = partirRel(relVault);
  if (!alvo) return null;

  const noCache = path.join(pastaCache(), alvo.grupo, ...alvo.rel.split("/"));
  if (fsSync.existsSync(noCache)) return noCache;

  const objetos = await listar(vaultRoot, alvo.grupo);
  const obj = objetos.find((o) => o.rel === alvo.rel);
  if (!obj) return null;

  const bytes = await baixar(vaultRoot, obj.key);
  await fs.mkdir(path.dirname(noCache), { recursive: true });
  // Grava em arquivo temporário e renomeia: se o app fechar no meio do
  // download, o cache não fica com meio PDF que depois passaria por bom.
  const parcial = `${noCache}.parcial`;
  await fs.writeFile(parcial, bytes);
  await fs.rename(parcial, noCache);
  return noCache;
}

/**
 * Põe no VAULT (não no cache) o material daquela matéria que ainda não está lá.
 *
 * É o que o ingest precisa: quem abre o arquivo é o Claude Code, seguindo o
 * caminho escrito no `CLAUDE.md`. Aproveita o que já estiver no cache — copiar
 * do disco é instantâneo e não gasta rede.
 *
 * Devolve quantos arquivos trouxe. Falha de rede não derruba o ingest: o
 * comando roda com o que houver, e a linha de aviso fica no log da sessão.
 */
export async function garantirNoVault(
  vaultRoot: string,
  code: string,
  onLinha: (s: string) => void,
): Promise<number> {
  let objetos: ObjetoRemoto[];
  try {
    objetos = await listar(vaultRoot, "inatel");
  } catch (e) {
    onLinha(`Não consegui conferir o material do professor: ${(e as Error).message}`);
    return 0;
  }

  // A pasta da matéria começa pelo código em todos os formatos que existem no
  // vault ("C09-Computacao-Grafica", "C14 - Engenharia de Software").
  const daMateria = objetos.filter((o) => o.rel.startsWith(code));
  if (daMateria.length === 0) return 0;

  const base = path.join(vaultRoot, "raw", "INATEL");
  const faltando = daMateria.filter(
    (o) => !fsSync.existsSync(path.join(base, ...o.rel.split("/"))),
  );
  if (faltando.length === 0) return 0;

  const mb = faltando.reduce((a, o) => a + o.size, 0) / 1024 ** 2;
  onLinha(
    `Material de ${code}: ${faltando.length} arquivo(s) faltando (${mb.toFixed(1)} MB). Baixando antes de rodar.`,
  );

  let trouxe = 0;
  for (const o of faltando) {
    const destino = path.join(base, ...o.rel.split("/"));
    await fs.mkdir(path.dirname(destino), { recursive: true });
    try {
      const noCache = path.join(pastaCache(), "inatel", ...o.rel.split("/"));
      if (fsSync.existsSync(noCache)) {
        await fs.copyFile(noCache, destino);
      } else {
        await fs.writeFile(destino, await baixar(vaultRoot, o.key));
      }
      trouxe++;
      onLinha(`  ↓ raw/INATEL/${o.rel}`);
    } catch (e) {
      onLinha(`  ! raw/INATEL/${o.rel}: ${(e as Error).message}`);
    }
  }
  return trouxe;
}
