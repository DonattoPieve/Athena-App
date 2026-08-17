import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { app } from "electron";
import { clienteAutenticado } from "./account";

/**
 * Primeiro uso — monta um vault Athena do zero, pela interface.
 *
 * Hoje, pra usar o Athena num PC novo, a pessoa precisa clonar o repo git,
 * rodar `npm i` dentro de `athena-web` e rodar `athena login` + `athena pull`
 * no terminal. Este arquivo faz as duas coisas que faltam pra eliminar isso:
 *
 *   - `criarVault`  — cria a estrutura de pastas vazia (o "esqueleto")
 *   - `baixarTudo`  — reimplementa o `athena-web/scripts/athena-pull.mjs`
 *                      (mesmas tabelas do Supabase, mesmo formato de arquivo)
 *                      sem depender do `athena-web` estar clonado
 *
 * REGRA DE OURO, em todo este arquivo: nunca sobrescrever nem apagar arquivo
 * do usuário. Pasta não-vazia faz `criarVault` recusar; arquivo que já existe
 * com conteúdo diferente do banco é reportado como conflito e NÃO é tocado —
 * mesmo por baixo, mais restrito que o `athena-pull.mjs` original, que troca
 * peça por peça só o que está sem `--force`, mas sobrescreve binário do R2
 * incondicionalmente. Aqui não: é sempre "nunca sem `--force`", porque não
 * existe `--force` nesta tela.
 */

/* ------------------------------------------------------------------ *
 * criarVault
 * ------------------------------------------------------------------ */

/** Pastas que todo vault precisa ter, mesmo vazias — ver CLAUDE.md. */
const PASTAS_DO_VAULT = [
  "raw/subjects",
  "raw/concepts",
  "raw/games",
  "raw/studies",
  "raw/INATEL",
  "raw/attachments",
  "wiki/subjects",
  "wiki/reviews",
];

/**
 * Onde moram os arquivos-modelo (`CLAUDE.md`, `COMANDOS.md`) que vão dentro
 * do vault novo.
 *
 * Mesmo truque do `iconePath()` em main.ts: `app.getAppPath()` aponta para a
 * raiz do projeto no dev e para dentro do `app.asar` no empacotado — e o
 * Electron faz o `fs` ler de dentro do asar como se fosse uma pasta comum.
 * Não precisa de `process.resourcesPath` nem de copiar nada para fora antes:
 * o mesmo caminho funciona nos dois casos, contanto que `build/esqueleto/**`
 * esteja em `build.files` do `package.json` (senão o asar empacotado não
 * carrega esta pasta e `criarVault` falha com uma mensagem clara).
 */
function caminhoEsqueleto(nome: string): string {
  return path.join(app.getAppPath(), "build", "esqueleto", nome);
}

/**
 * Cria a estrutura mínima do vault numa pasta VAZIA.
 *
 * Recusa pasta não-vazia: é a única guarda que existe contra "criar vault"
 * virar "misturar com o que já estava aqui" — muito mais barato recusar aqui
 * do que tentar adivinhar o que pode ou não ser mesclado.
 */
export async function criarVault(destino: string): Promise<void> {
  let existentes: string[];
  try {
    existentes = await fs.readdir(destino);
  } catch (e) {
    throw new Error(`Não consegui abrir "${destino}": ${(e as Error).message}`);
  }
  if (existentes.length > 0) {
    throw new Error(
      `A pasta "${destino}" não está vazia (${existentes.length} item(ns) dentro). ` +
        `Para não arriscar misturar com algo seu, o Athena só cria um vault numa pasta vazia. ` +
        `Escolha outra pasta, ou esvazie esta antes de tentar de novo.`,
    );
  }

  for (const rel of PASTAS_DO_VAULT) {
    await fs.mkdir(path.join(destino, rel), { recursive: true });
  }

  // log.md e index.md nascem em branco de propósito: as duas coisas não têm
  // fonte no banco (nem o athena-pull.mjs mexe nelas) — quem os preenche de
  // verdade é o uso: log.md a cada ingest, index.md a cada matéria nova.
  await fs.writeFile(
    path.join(destino, "log.md"),
    "# Log de ingests — Athena\n\n" +
      "Uma linha por página processada, sob o cabeçalho da data. Formato canônico\n" +
      "(definido no `CLAUDE.md`): página — fonte — situação da nota do aluno.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(destino, "index.md"),
    "# Índice — Athena\n\n" +
      "Mapa geral das matérias. Cada matéria tem seu próprio índice de aulas (MOC).\n\n" +
      "## Matérias\n\n",
    "utf8",
  );

  for (const nome of ["CLAUDE.md", "COMANDOS.md"]) {
    const origem = caminhoEsqueleto(nome);
    if (!fsSync.existsSync(origem)) {
      // Só acontece se o instalador saiu sem build/esqueleto/** empacotado —
      // bug de empacotamento, não algo que o usuário causou.
      throw new Error(
        `Não achei ${nome} para copiar (build/esqueleto/${nome}). ` +
          `O instalador deste app parece incompleto — reinstale ou avise quem mantém o Athena.`,
      );
    }
    await fs.copyFile(origem, path.join(destino, nome));
  }
}

/* ------------------------------------------------------------------ *
 * baixarTudo — o `athena pull`, sem terminal
 * ------------------------------------------------------------------ */

export type ResultadoBootstrap = {
  criados: number;
  iguais: number;
  /** Arquivos que já existiam com conteúdo diferente do banco — não tocados. */
  conflitos: string[];
  /** O Worker do R2 não respondeu (ou não foi publicado): PDFs/anexos não vieram. */
  semR2: boolean;
};

/**
 * Puxa `subjects`, `pages` e `notes` do Supabase e os binários (`raw/INATEL`,
 * `raw/attachments`) do R2 — as MESMAS tabelas e o MESMO formato de arquivo
 * de `athena-web/scripts/athena-pull.mjs`, reimplementados aqui porque o
 * objetivo deste recurso é justamente não depender do `athena-web` clonado.
 *
 * `onLinha` recebe o progresso, linha a linha — o app manda isso pro monitor
 * da sessão, igual o publish/pull de terminal já fazem hoje (ver publish.ts).
 */
export async function baixarTudo(
  destino: string,
  onLinha: (s: string) => void,
): Promise<ResultadoBootstrap> {
  const stats: ResultadoBootstrap = { criados: 0, iguais: 0, conflitos: [], semR2: false };

  const { supabase, user, session } = await clienteAutenticado(destino);
  const nome = (user.user_metadata as Record<string, unknown> | undefined)?.name ?? user.email;
  onLinha(`Puxando da conta de ${nome}.`);

  const [{ data: subjects, error: e1 }, { data: pages, error: e2 }, { data: notes, error: e3 }] =
    await Promise.all([
      supabase.from("subjects").select("id, slug").order("slug"),
      supabase
        .from("pages")
        .select("subject_id, slug, content, frontmatter, is_review")
        .order("slug"),
      supabase.from("notes").select("subject_id, filename, content").order("filename"),
    ]);
  for (const e of [e1, e2, e3]) {
    if (e) throw new Error(`Falhou ao ler o banco: ${e.message}`);
  }

  if (!subjects || subjects.length === 0) {
    onLinha("O banco está vazio — nada a puxar. O vault fica com a estrutura, sem conteúdo.");
    return stats;
  }

  const slugPorId = new Map<string, string>(subjects.map((s) => [s.id as string, s.slug as string]));
  onLinha(
    `Banco: ${subjects.length} matéria(s), ${pages?.length ?? 0} página(s), ${notes?.length ?? 0} nota(s).`,
  );

  const WIKI = path.join(destino, "wiki", "subjects");
  // As questões de revisão moram em `wiki/reviews/<matéria>/`. O banco guarda
  // matéria e slug, não pasta: sem olhar `is_review` aqui, a revisão seria
  // recriada em `wiki/subjects/` e o publish seguinte recusaria tudo com
  // "slug repetido no vault", vendo o mesmo `-review` nos dois lugares.
  const REVIEWS = path.join(destino, "wiki", "reviews");
  const RAW = path.join(destino, "raw", "subjects");

  for (const p of pages ?? []) {
    const materia = slugPorId.get(p.subject_id as string);
    if (!materia) continue;
    const fm = (p.frontmatter ?? {}) as Record<string, unknown>;
    const conteudo = Object.keys(fm).length
      ? serializarComFrontmatter(p.content as string, fm)
      : (p.content as string);

    const pasta = p.is_review ? "wiki/reviews" : "wiki/subjects";
    await gravar(
      path.join(p.is_review ? REVIEWS : WIKI, materia, `${p.slug}.md`),
      conteudo,
      `${pasta}/${materia}/${p.slug}.md`,
      (atual) => mesmoConteudo(atual, p.content as string, fm),
      stats,
      onLinha,
    );
  }

  for (const n of notes ?? []) {
    const materia = slugPorId.get(n.subject_id as string);
    if (!materia) continue;
    await gravar(
      path.join(RAW, materia, n.filename as string),
      n.content as string,
      `raw/subjects/${materia}/${n.filename}`,
      (atual) => atual === n.content,
      stats,
      onLinha,
    );
  }

  // ---------- binários, pelo Worker ----------
  // Depois do texto, de propósito: se a rede cair no meio do material do
  // professor, wiki/ e notas já estão no disco e a próxima tentativa só
  // completa o que falta (nada aqui sobrescreve o que já foi baixado igual).
  const worker = urlWorker(destino);
  if (!worker) {
    stats.semR2 = true;
    onLinha(
      "O portão do R2 (Worker) ainda não foi publicado — raw/INATEL (material do " +
        "professor) e raw/attachments (imagens coladas nas notas) NÃO foram baixados. " +
        "As páginas e as notas de aula funcionam normalmente; falta só isso.",
    );
  } else {
    const grupos: { prefixo: string; rotulo: string; destino: string }[] = [
      { prefixo: "inatel", rotulo: "raw/INATEL", destino: path.join(destino, "raw", "INATEL") },
      {
        prefixo: "raw-attachments",
        rotulo: "raw/attachments",
        destino: path.join(destino, "raw", "attachments"),
      },
    ];

    for (const { prefixo, rotulo, destino: baseDestino } of grupos) {
      let objetos: ObjetoRemoto[];
      try {
        objetos = await listarNoWorker(worker, session.access_token, prefixo);
      } catch (e) {
        // Uma pasta que falha não pode derrubar a outra, nem o pull inteiro: o
        // texto já está no disco e o resto ainda pode vir.
        stats.semR2 = true;
        onLinha(`  ! ${rotulo}: ${(e as Error).message}`);
        continue;
      }

      for (const obj of objetos) {
        if (!obj.rel) continue;
        const caminho = path.join(baseDestino, ...obj.rel.split("/"));
        const rotuloArq = `${rotulo}/${obj.rel}`;

        if (fsSync.existsSync(caminho)) {
          // Compara pelo mesmo hash que o publish gravou como metadado. Só cai
          // no tamanho quando o objeto subiu antes desse metadado existir — aí
          // a folga é a mesma que o `athena pull --dry-run` já aceitava.
          const local = await fs.readFile(caminho);
          const igual = obj.sha256
            ? sha256Curto(local) === obj.sha256
            : local.byteLength === obj.size;
          if (igual) {
            stats.iguais++;
          } else {
            stats.conflitos.push(rotuloArq);
            onLinha(`  ! ${rotuloArq} já existe com conteúdo diferente — não sobrescrito`);
          }
          continue;
        }

        await fs.mkdir(path.dirname(caminho), { recursive: true });
        const bytes = await baixarNoWorker(worker, session.access_token, obj.key);
        await fs.writeFile(caminho, bytes);
        stats.criados++;
        onLinha(`  ↓ ${rotuloArq} (${bytesLegivel(obj.size)})`);
      }
    }
  }

  onLinha(
    `\n${stats.criados} criado(s), ${stats.iguais} já igual(is)` +
      (stats.conflitos.length ? `, ${stats.conflitos.length} conflito(s) — veja acima.` : "."),
  );
  return stats;
}

/** Escreve respeitando a regra de ouro: nunca sobrescreve o que já existe e diverge. */
async function gravar(
  caminho: string,
  conteudo: string,
  rotulo: string,
  comparar: (atual: string) => boolean,
  stats: ResultadoBootstrap,
  onLinha: (s: string) => void,
): Promise<void> {
  if (!fsSync.existsSync(caminho)) {
    await fs.mkdir(path.dirname(caminho), { recursive: true });
    await fs.writeFile(caminho, conteudo, "utf8");
    stats.criados++;
    onLinha(`  + ${rotulo}`);
    return;
  }

  const atual = await fs.readFile(caminho, "utf8");
  if (comparar(atual)) {
    stats.iguais++;
    return;
  }

  stats.conflitos.push(rotulo);
  onLinha(`  ! ${rotulo} já existe com conteúdo diferente do banco — não sobrescrito`);
}

/* ------------------------------------------------------------------ *
 * Frontmatter — sem gray-matter/js-yaml
 *
 * Nenhum dos dois é dependência de PRODUÇÃO deste app: `gray-matter` não
 * está em node_modules (não dá pra rodar `npm i` agora pra trazê-lo), e o
 * único `js-yaml` presente veio junto do `electron-builder` — devDependency
 * cujo pacote o instalador final não leva. Usar qualquer um dos dois aqui
 * funcionaria em dev e quebraria silenciosamente no `.exe` empacotado.
 *
 * O frontmatter do Athena é sempre plano — `updated`, `source`, `sourceHref`,
 * `type`, todos string ou data (ver CLAUDE.md/COMANDOS.md) — então dá pra
 * escrever e reler à mão, sem um parser de YAML de verdade.
 * ------------------------------------------------------------------ */

/** Mesma normalização de data do athena-pull.mjs: sempre 'YYYY-MM-DD'. */
function paraTexto(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(s) ? s.slice(0, 10) : s;
}

function valorYaml(v: string): string {
  if (v === "") return "''";
  // Sem aspas quando o valor é "seguro" (letras, números, data, caminho).
  // Com aspas simples quando tem algo que confundiria o parser (dois-pontos,
  // acento, aspas) — igual à cautela que um YAML de verdade tomaria.
  if (/^[A-Za-z0-9_/:.-]+$/.test(v)) return v;
  return `'${v.replace(/'/g, "''")}'`;
}

function serializarComFrontmatter(conteudo: string, fm: Record<string, unknown>): string {
  const linhas = Object.entries(fm).map(([k, v]) => `${k}: ${valorYaml(paraTexto(v))}`);
  return `---\n${linhas.join("\n")}\n---\n${conteudo}`;
}

/** Lê de volta um `---\n...\n---\nconteúdo`. Só entende `chave: valor` plano. */
function parseFrontmatter(raw: string): { data: Record<string, string>; content: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { data: {}, content: raw };
  const data: Record<string, string> = {};
  for (const linha of m[1].split(/\r?\n/)) {
    const mm = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(linha);
    if (!mm) continue;
    let v = mm[2].trim();
    if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
    else if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\"/g, '"');
    data[mm[1]] = v;
  }
  return { data, content: m[2] };
}

/** Compara ignorando formatação: só o corpo e os VALORES do frontmatter importam. */
function mesmoConteudo(
  localRaw: string,
  corpoBanco: string,
  fmBanco: Record<string, unknown>,
): boolean {
  const { content, data } = parseFrontmatter(localRaw);
  if (content.trim() !== corpoBanco.trim()) return false;
  const normalizar = (o: Record<string, unknown>) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(o ?? {})
          .map(([k, v]) => [k, paraTexto(v)])
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  return normalizar(data) === normalizar(fmBanco);
}

/* ------------------------------------------------------------------ *
 * O portão do R2 — um Worker da Cloudflare, e nenhuma credencial aqui
 *
 * Antes este arquivo assinava a requisição do R2 à mão (SigV4) com a access
 * key + secret lidas do `.env.local` do athena-web. Funcionava numa máquina só
 * — a que tinha esse arquivo — que era exatamente o problema do PC novo. E não
 * dava para resolver embutindo a chave no instalador: chave do R2 é simétrica,
 * a mesma que lê também escreve e apaga no bucket inteiro, e não existe versão
 * "pública só de leitura" dela (ao contrário da chave anon do Supabase, que é
 * segura porque o RLS a segura em toda tabela).
 *
 * A saída é `worker/` (ver worker/README.md): o bucket entra no Worker por
 * binding, o app manda o access token da conta, e o Worker só devolve objeto
 * cuja chave comece com `u/<id-da-conta>/`. Aqui não fica segredo nenhum — a
 * URL do Worker é pública e sozinha não abre nada.
 * ------------------------------------------------------------------ */

/**
 * Endereço do Worker, embutido no app.
 *
 * Preencha depois do `npx wrangler deploy` (o comando imprime a URL). Vazio, o
 * app segue funcionando e só avisa que o material do professor não veio — um
 * instalador sem esta linha é um instalador com um recurso a menos, não um
 * instalador quebrado.
 */
const WORKER_PADRAO = "https://athena-r2.donatto-athena.workers.dev";

/**
 * Dá para apontar para outro Worker sem recompilar: variável de ambiente, ou
 * `ATHENA_R2_WORKER=` no `.env.local` de quem ainda tem o athena-web clonado.
 * Serve para testar um deploy novo antes de trocar o do instalador.
 */
function urlWorker(vaultRoot: string): string {
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

type ObjetoRemoto = {
  /** Chave completa no bucket, já com o `u/<id>/` na frente. */
  key: string;
  /** Caminho dentro da pasta local (`C09-.../aula.pdf`). */
  rel: string;
  size: number;
  /** sha256 curto que o publish gravou como metadado; null nos objetos antigos. */
  sha256: string | null;
};

/** Mesmo hash do `athena-web/scripts/lib/r2.mjs` — 32 primeiros hex do sha256. */
function sha256Curto(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

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

async function listarNoWorker(
  worker: string,
  token: string,
  prefixo: string,
): Promise<ObjetoRemoto[]> {
  const resp = await fetch(`${worker}/list?prefixo=${encodeURIComponent(prefixo)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw await erroDoWorker(resp, "a listagem");
  const { objetos } = (await resp.json()) as { objetos: ObjetoRemoto[] };
  return objetos ?? [];
}

async function baixarNoWorker(worker: string, token: string, key: string): Promise<Buffer> {
  // A chave vai em query: nome de arquivo do INATEL tem acento, espaço e
  // parêntese, e no caminho da URL isso passaria por normalização antes de
  // chegar no Worker.
  const resp = await fetch(`${worker}/f?k=${encodeURIComponent(key)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw await erroDoWorker(resp, `o download de "${key}"`);
  return Buffer.from(await resp.arrayBuffer());
}

function bytesLegivel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
