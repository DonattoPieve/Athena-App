import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { app } from "electron";
import { clienteAutenticado } from "./account";
import type { TreeNode } from "./vault";
import {
  DENTRO_DO_VAULT,
  mesclarArvore,
  tocaOBucket,
  type Grupo,
  type ItemEspelho,
} from "./espelho";

/**
 * Material pesado sob demanda — o PDF só desce quando alguém precisa dele.
 *
 * O PROBLEMA QUE ISTO RESOLVE: `Notes/INATEL` tem 340 MB, e o primeiro uso num
 * PC novo baixava tudo antes de deixar a pessoa entrar. Numa rede lenta isso é
 * meia hora olhando uma barra — para material que, na prática, ela vai abrir
 * dois ou três arquivos.
 *
 * COMO FICA: o primeiro uso traz só o texto (páginas e notas, alguns MB). Cada
 * binário é buscado na PRIMEIRA vez que é aberto e gravado NO VAULT, no lugar
 * onde o arquivo sempre morou (`Notes/INATEL/...`). Da segunda em diante sai
 * do disco — e sem internet também, que era a exigência: uma vez visto, sempre
 * disponível.
 *
 * VAI PARA O VAULT, não para uma pasta escondida: assim o arquivo existe de
 * verdade — aparece no Explorer do Windows, o `ingest` do Claude Code o
 * encontra pelo caminho que o `CLAUDE.md` manda abrir, e a linha deixa de ser
 * "da nuvem" na árvore. O `%APPDATA%\athena-app\cache` continua sendo LIDO,
 * para quem baixou antes desta mudança não baixar tudo de novo.
 *
 * A ORDEM DE BUSCA é sempre a mesma, e o disco vem antes da rede:
 *
 *   1. o vault
 *   2. o cache antigo
 *   3. o Worker do R2 — e o que vier é gravado no vault
 *
 * O ESPELHO é o que torna tudo isso visível. Baixar sob demanda só funciona se
 * o arquivo APARECER antes de descer: num PC novo `Notes/INATEL` está vazio, e
 * uma árvore que lê só o disco não mostra nada — não há o que clicar, então o
 * download sob demanda nunca dispara e o material parece ter sumido. Por isso
 * `mesclarRemotos` junta a listagem do bucket desta conta na árvore: o arquivo
 * está lá, marcado como ainda-não-baixado, e abrir é o que o traz.
 *
 * O INGEST é a exceção, e é de propósito: quem lê o PDF ali é o Claude Code,
 * não o app, e o `CLAUDE.md` manda ele abrir `Notes/INATEL/...`. Cache não serve
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

/** Quem usa `materiais` nao precisa saber que a tabela mora no espelho. */
export type { Grupo, ItemEspelho };

/**
 * Id da conta logada — quem avisa é o main, no `abrirVaultDaConta`.
 *
 * O cache é POR CONTA de propósito. Duas contas na mesma máquina podem ter uma
 * aula no mesmo caminho (`C09-.../aula.pdf`), e com uma pasta só a segunda
 * leria o PDF que a primeira baixou — a separação que o Worker faz no bucket
 * cairia no disco. Sem conta (antes do login) nada é lido nem gravado.
 */
let uidAtual: string | null = null;

export function definirConta(uid: string | null) {
  if (uid === uidAtual) return;
  uidAtual = uid;
  esquecer();
}

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

/**
 * Pedidos iguais que chegam juntos viram UM.
 *
 * A arvore e carregada mais de uma vez na abertura (o escopo aberto e a lista
 * que a busca varre), e sem isto cada uma abriria a sua ida ao Worker — duas
 * chamadas identicas, e antes da porta unica do `account.ts` isso ainda
 * queimava o refresh token uma vez a mais.
 */
const emVoo = new Map<Grupo, Promise<ObjetoRemoto[]>>();

export async function listar(vaultRoot: string, grupo: Grupo): Promise<ObjetoRemoto[]> {
  const guardada = listagens.get(grupo);
  if (guardada) return guardada;

  const indo = emVoo.get(grupo);
  if (indo) return indo;

  const p = buscarListagem(vaultRoot, grupo).finally(() => {
    if (emVoo.get(grupo) === p) emVoo.delete(grupo);
  });
  emVoo.set(grupo, p);
  return p;
}

async function buscarListagem(vaultRoot: string, grupo: Grupo): Promise<ObjetoRemoto[]> {
  const worker = urlWorker(vaultRoot);
  if (!worker) throw new Error("O portão do R2 não foi publicado neste app.");

  const resp = await fetch(`${worker}/list?prefixo=${encodeURIComponent(grupo)}`, {
    headers: { authorization: `Bearer ${await tokenDaConta(vaultRoot)}` },
  });
  if (!resp.ok) throw await erroDoWorker(resp, "a listagem");
  const { objetos } = (await resp.json()) as { objetos: ObjetoRemoto[] };
  listagens.set(grupo, objetos ?? []);
  guardarListagem(grupo, objetos ?? []);
  return objetos ?? [];
}

/** Esquece as listagens — usado quando o vault (ou a conta) muda. */
export function esquecer() {
  listagens.clear();
  emVoo.clear();
  token = null;
}

/* ------------------------------------------------------------------ *
 * O espelho — o que a conta tem no bucket, visto de dentro do vault
 * ------------------------------------------------------------------ */

/**
 * A última listagem que deu certo, gravada no cache da conta.
 *
 * É o que faz o espelho sobreviver ao avião. Sem ela, abrir o app sem internet
 * mostraria `Notes/INATEL` vazio — inclusive os PDFs que já estão no cache
 * desta máquina e abririam na hora. O arquivo é pequeno (nome, tamanho e hash)
 * e vale por conta, na mesma pasta do cache.
 */
function arquivoDaListagem(grupo: Grupo): string {
  return path.join(pastaCache(), `listagem-${grupo}.json`);
}

function guardarListagem(grupo: Grupo, objetos: ObjetoRemoto[]) {
  try {
    fsSync.mkdirSync(pastaCache(), { recursive: true });
    fsSync.writeFileSync(arquivoDaListagem(grupo), JSON.stringify(objetos), "utf8");
  } catch {
    // Disco cheio ou pasta sem permissão: o espelho desta sessão continua
    // funcionando pela rede; só o modo offline fica sem ele.
  }
}

function listagemGuardada(grupo: Grupo): ObjetoRemoto[] | null {
  try {
    const salvo = JSON.parse(fsSync.readFileSync(arquivoDaListagem(grupo), "utf8"));
    return Array.isArray(salvo) ? (salvo as ObjetoRemoto[]) : null;
  } catch {
    return null;
  }
}

/**
 * Tudo que existe no bucket DESTA conta, em caminho de vault.
 *
 * Sem rede cai na última listagem gravada, que é o certo aqui: a alternativa é
 * a árvore encolher no dia sem internet, escondendo até o que está no cache.
 *
 * A queda NÃO vale para o publish — `listar` continua estourando quando a rede
 * falha, de propósito. Publicar com listagem velha faria o publish achar que o
 * arquivo já está no bucket e pular o envio, e o material nunca subiria.
 */
export async function espelho(vaultRoot: string): Promise<ItemEspelho[]> {
  const itens: ItemEspelho[] = [];
  for (const grupo of Object.keys(DENTRO_DO_VAULT) as Grupo[]) {
    let objetos: ObjetoRemoto[] | null = null;
    try {
      objetos = await listar(vaultRoot, grupo);
    } catch {
      objetos = listagemGuardada(grupo);
    }
    if (!objetos) continue;
    for (const o of objetos) {
      const partes = o.rel.split("/");
      itens.push({
        rel: `${DENTRO_DO_VAULT[grupo]}/${o.rel}`,
        size: o.size,
        emCache: fsSync.existsSync(path.join(pastaCache(), grupo, ...partes)),
      });
    }
  }
  return itens;
}

/**
 * A arvore do disco MAIS o que a conta tem no bucket.
 *
 * E a peca que faltava para um PC novo: num vault recem-criado `Notes/INATEL`
 * nasce vazio, e o material so desce quando alguem abre o arquivo — o que
 * ninguem consegue fazer numa pasta que a tela mostra vazia.
 *
 * Falhar aqui devolve a arvore do disco intacta. Rede fora com cache vazio e
 * situacao normal, e ela nao pode virar erro numa arvore que, no fundo, e so a
 * lateral do app. A regra da mesclagem em si mora em `espelho.ts`, testada.
 */
export async function mesclarRemotos(
  vaultRoot: string,
  escopo: string,
  arvore: TreeNode[],
): Promise<TreeNode[]> {
  const base = escopo.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  // `Resumos/` e texto e desce inteiro no pull — ir a rede ali seria gasto
  // sem resposta.
  if (!tocaOBucket(base)) return arvore;
  try {
    return mesclarArvore(base, await espelho(vaultRoot), arvore);
  } catch {
    return arvore;
  }
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

/**
 * Chaves do bucket que correspondem a um caminho do vault.
 *
 * Arquivo casa exato; PASTA casa por prefixo, e e assim que apagar uma materia
 * inteira funciona. Devolve vazio para caminho que nao mora no bucket
 * (`Notes/subjects`, por exemplo) — la quem manda e o Supabase.
 */
export async function chavesDe(vaultRoot: string, relVault: string): Promise<string[]> {
  const alvo = partirRel(relVault);
  if (!alvo) {
    // Pode ser a raiz de um grupo inteiro (`Notes/INATEL`): ai nao ha `rel`,
    // e o que casa e tudo daquele grupo.
    const limpo = relVault.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    for (const [grupo, base] of Object.entries(DENTRO_DO_VAULT) as [Grupo, string][]) {
      if (limpo === base) return (await listar(vaultRoot, grupo)).map((o) => o.key);
    }
    return [];
  }
  const objetos = await listar(vaultRoot, alvo.grupo);
  return objetos
    .filter((o) => o.rel === alvo.rel || o.rel.startsWith(alvo.rel + "/"))
    .map((o) => o.key);
}

/**
 * Apaga um objeto do bucket, pelo Worker.
 *
 * Quem chama e so o "Apagar" do explorer, depois da confirmacao — o publish
 * continua proibido de remover binario. Uma chave por pedido, de proposito:
 * ver o comentario da rota em `worker/src/index.js`.
 */
export async function apagar(vaultRoot: string, key: string): Promise<void> {
  const worker = urlWorker(vaultRoot);
  if (!worker) throw new Error("O portão do R2 não foi publicado neste app.");

  const resp = await fetch(`${worker}/f?k=${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${await tokenDaConta(vaultRoot)}` },
  });
  // 404 e sucesso para quem queria o arquivo fora do bucket: ja nao esta la.
  if (resp.status === 405) {
    // O portao publicado ainda e o de antes da rota DELETE. Sem esta linha o
    // erro seria "HTTP 405", que nao diz a ninguem o que fazer.
    throw new Error(
      "O portão do R2 publicado ainda não sabe apagar. Rode `npm run worker:deploy` " +
        "na pasta do app e tente de novo. Nada foi apagado.",
    );
  }
  if (!resp.ok && resp.status !== 404) throw await erroDoWorker(resp, `a remoção de "${key}"`);

  // Tira da listagem em memoria E da salva: sem isto a arvore continuaria
  // mostrando o arquivo como "na nuvem" ate o app ser reaberto.
  for (const [grupo, objetos] of listagens) {
    const sobrou = objetos.filter((o) => o.key !== key);
    if (sobrou.length !== objetos.length) {
      listagens.set(grupo, sobrou);
      guardarListagem(grupo, sobrou);
    }
  }
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
  return path.join(app.getPath("userData"), "cache", uidAtual ?? "sem-conta");
}

/** `Notes/INATEL/C09-x/aula.pdf` -> { grupo: "inatel", rel: "C09-x/aula.pdf" } */
function partirRel(relVault: string): { grupo: Grupo; rel: string } | null {
  const limpo = relVault.replace(/\\/g, "/").replace(/^\/+/, "");
  for (const [grupo, base] of Object.entries(DENTRO_DO_VAULT) as [Grupo, string][]) {
    if (limpo.startsWith(base + "/")) return { grupo, rel: limpo.slice(base.length + 1) };
  }
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

  const partes = alvo.rel.split("/");
  const noVault = path.join(vaultRoot, ...DENTRO_DO_VAULT[alvo.grupo].split("/"), ...partes);
  if (fsSync.existsSync(noVault)) return noVault;

  // Cache de quem baixou antes desta mudanca: aproveita em vez de baixar de
  // novo. Nada novo e escrito la.
  const noCache = path.join(pastaCache(), alvo.grupo, ...partes);
  if (fsSync.existsSync(noCache)) return noCache;

  const objetos = await listar(vaultRoot, alvo.grupo);
  const obj = objetos.find((o) => o.rel === alvo.rel);
  if (!obj) return null;

  const bytes = await baixar(vaultRoot, obj.key);
  await fs.mkdir(path.dirname(noVault), { recursive: true });

  // Grava fora da vista e so entao renomeia para o lugar final.
  //
  // O temporario NAO pode ser `<arquivo>.pdf.parcial` ao lado do destino: o
  // watcher do vault avisa a tela na hora, e o arquivo pela metade aparecia na
  // arvore com nome de arquivo de verdade. Em `.athena/` ele fica invisivel
  // (a arvore pula tudo que comeca com ponto) e o rename continua atomico,
  // porque e o mesmo disco — se o app fechar no meio, sobra lixo escondido,
  // nunca meio PDF passando por bom.
  const guardado = path.join(
    vaultRoot,
    ".athena",
    "parciais",
    `${createHash("sha1").update(obj.key).digest("hex").slice(0, 16)}.parcial`,
  );
  await fs.mkdir(path.dirname(guardado), { recursive: true });
  try {
    await fs.writeFile(guardado, bytes);
    await fs.rename(guardado, noVault);
  } catch (e) {
    await fs.rm(guardado, { force: true }).catch(() => {});
    throw e;
  }
  return noVault;
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

  const base = path.join(vaultRoot, "Notes", "INATEL");
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
      onLinha(`  ↓ Notes/INATEL/${o.rel}`);
    } catch (e) {
      onLinha(`  ! Notes/INATEL/${o.rel}: ${(e as Error).message}`);
    }
  }
  return trouxe;
}
