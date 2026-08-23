import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { clienteAutenticado } from "./account";
import {
  apagar,
  chavesDe,
  esquecer,
  listar,
  subir,
  type Grupo,
  type ObjetoRemoto,
} from "./materiais";

/**
 * O `athena publish`, sem terminal — espelha `Resumos/`, `Notes/subjects/` e o
 * `log.md` para o Supabase, e os binários para o R2 pelo Worker.
 *
 * É o CAMINHO DE IDA do que o `bootstrap.ts` traz de volta, e existe pelo mesmo
 * motivo: num PC que só instalou o app não há `athena-web/` clonado, então o
 * `athena-web/scripts/athena-publish.mjs` (que `publish.ts` roda hoje) não
 * existe — e nem o Node para rodá-lo. A lógica difícil daquele script está
 * reimplementada aqui: mesmas tabelas, mesmas colunas, mesma slugificação,
 * mesma remoção de órfãos, mesmo parsing do `log.md`.
 *
 * É um ESPELHO: o que não existe mais no disco sai do banco. O bucket é a
 * exceção deliberada — binário nunca é apagado (o Worker nem tem rota de
 * DELETE), porque um bug daqui não pode virar perda de material do professor.
 */

/* ------------------------------------------------------------------ *
 * Frontmatter — sem gray-matter/js-yaml
 *
 * Mesma restrição do bootstrap.ts: nenhum dos dois é dependência de PRODUÇÃO
 * deste app, então usá-los funcionaria em dev e quebraria no `.exe`
 * empacotado. O frontmatter do Athena é sempre plano (`updated`, `source`,
 * `sourceHref`, `type` — string ou data), e este parser é o INVERSO exato do
 * serializador do bootstrap: o que o pull escreve, o publish relê igual.
 * ------------------------------------------------------------------ */

type Frontmatter = Record<string, string>;

function separarFrontmatter(raw: string): { data: Frontmatter; content: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { data: {}, content: raw };
  const data: Frontmatter = {};
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

/**
 * Mesma slugificação do CLAUDE.md: minúsculo, sem acento, sem pontuação,
 * espaço vira hífen. É o que liga a nota crua (`Notes/subjects/...`) à aula.
 */
function slugify(nome: string): string {
  return nome
    .replace(/\.md$/i, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Título = primeiro "# " do markdown; sem isso, o slug humanizado.
 * O `[ \t]*` tolera indentação antes do `#` — um tab acidental no início do
 * arquivo derrubava o título no fallback (mesmo bug do lib/wiki.ts).
 */
function tituloDe(conteudo: string, slug: string): string {
  const m = /^[ \t]*#\s+(.+)$/m.exec(conteudo);
  if (m) return m[1].trim();
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "C09 — Computação Gráfica" -> "Computação Gráfica" (mesma regra do site). */
function semCodigo(titulo: string): string {
  return titulo.replace(/^\s*[A-Za-z]\d{2}\s*[—-]\s*/, "");
}

/** `updated` só vale como data se for 'YYYY-MM-DD'; o resto vira null. */
function dataIso(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/* ------------------------------------------------------------------ *
 * Leitura do disco
 * ------------------------------------------------------------------ */

type PaginaLocal = {
  slug: string;
  title: string;
  content: string;
  frontmatter: Frontmatter;
  note_updated: string | null;
  source: string | null;
  source_href: string | null;
  is_moc: boolean;
  is_review: boolean;
};

type MateriaLocal = {
  slug: string;
  code: string;
  name: string;
  pages: PaginaLocal[];
};

type NotaLocal = { slug: string; filename: string; content: string };

type Evento = {
  ingested_on: string;
  ordem: number;
  kind: "ingest" | "removal" | "outro";
  page_slug: string | null;
  source: string | null;
  note_status: string | null;
  raw_line: string;
};

async function pastas(dir: string): Promise<string[]> {
  if (!fsSync.existsSync(dir)) return [];
  const e = await fs.readdir(dir, { withFileTypes: true });
  return e
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
}

async function markdowns(dir: string): Promise<string[]> {
  if (!fsSync.existsSync(dir)) return [];
  const e = await fs.readdir(dir);
  return e.filter((f) => f.endsWith(".md")).sort();
}

/**
 * Lista recursiva de arquivos, com recursão escrita à mão de propósito.
 *
 * O `readdir(..., { recursive: true })` devolve o diretório do item em
 * `parentPath` no Node 22 e em `path` no Node 20 — e o Electron carrega o seu
 * próprio Node, que não é o mesmo em toda versão do app. Quando isso saía
 * errado, a chave no bucket embaralhava as pastas: arquivo subia no lugar de
 * outro. Recursão explícita dá o mesmo resultado em qualquer versão.
 */
async function arquivosDe(dir: string): Promise<string[]> {
  if (!fsSync.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const caminho = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await arquivosDe(caminho)));
    else if (e.isFile()) out.push(caminho);
  }
  return out;
}

/**
 * Lê o `log.md` e devolve um evento por linha.
 *
 * O log é a única fonte do HISTÓRICO: `pages` guarda o estado atual e não sabe
 * dizer que uma aula foi refeita três vezes nem que uma página sumiu em tal
 * dia. Linha que não casa com o formato canônico entra crua, sem adivinhação —
 * o histórico velho é irregular, e perder uma linha por causa da regex seria
 * pior que guardá-la como está.
 */
async function lerLog(arquivo: string): Promise<Evento[]> {
  if (!fsSync.existsSync(arquivo)) return [];

  const eventos: Evento[] = [];
  let data: string | null = null;
  let ordem = 0;

  for (const linha of (await fs.readFile(arquivo, "utf8")).split("\n")) {
    const cabecalho = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(linha);
    if (cabecalho) {
      data = cabecalho[1];
      ordem = 0;
      continue;
    }

    const item = /^\s*-\s+(.*\S)\s*$/.exec(linha);
    if (!item || !data) continue;

    const corpo = item[1];
    const pos = ordem++;
    const canonico = /^`([^`]+)`\s*—\s*fonte:\s*`([^`]*)`\s*—\s*nota do aluno:\s*(.+)$/.exec(corpo);

    if (canonico) {
      eventos.push({
        ingested_on: data,
        ordem: pos,
        kind: "ingest",
        page_slug: canonico[1].trim(),
        source: canonico[2].trim() || null,
        note_status: canonico[3].trim(),
        raw_line: corpo,
      });
    } else {
      eventos.push({
        ingested_on: data,
        ordem: pos,
        kind: /^removid[ao]/i.test(corpo) ? "removal" : "outro",
        page_slug: null,
        source: null,
        note_status: null,
        raw_line: corpo,
      });
    }
  }

  return eventos;
}

/* ------------------------------------------------------------------ *
 * Binários
 * ------------------------------------------------------------------ */

const TIPOS: Record<string, string> = {
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function tipoDe(caminho: string): string {
  return TIPOS[path.extname(caminho).toLowerCase()] ?? "application/octet-stream";
}

function bytesLegivel(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Mesmo hash do lib/r2.mjs: sha256 hex cortado em 32 — é o que o Worker devolve. */
function shaCurto(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

/* ------------------------------------------------------------------ *
 * publicar
 * ------------------------------------------------------------------ */

export async function publicar(
  vaultRoot: string,
  onLinha: (s: string) => void,
): Promise<{ ok: boolean; erro?: string }> {
  try {
    await espelhar(vaultRoot, onLinha);
    return { ok: true };
  } catch (e) {
    // Sem `process.exit`: quem chama decide o que fazer com a falha, e o que já
    // foi gravado FICA gravado — texto primeiro, binário depois, de propósito
    // (ver o comentário da etapa 6).
    return { ok: false, erro: (e as Error).message };
  }
}

async function espelhar(vaultRoot: string, onLinha: (s: string) => void): Promise<void> {
  const RESUMOS = path.join(vaultRoot, "Resumos", "subjects");
  // As revisões saíram de dentro da pasta da matéria para `Resumos/reviews/<MATERIA>/`.
  // Para o BANCO nada mudou: a revisão continua sendo página da mesma matéria,
  // com o mesmo slug e `is_review` verdadeiro. Só o lugar no disco é outro.
  const REVIEWS = path.join(vaultRoot, "Resumos", "reviews");
  const NOTAS = path.join(vaultRoot, "Notes", "subjects");

  if (!fsSync.existsSync(RESUMOS)) {
    throw new Error(
      `Não achei Resumos/subjects em ${RESUMOS}. Este vault não tem conteúdo para publicar.`,
    );
  }

  /* ---------- 1. lê o disco ---------- */
  const local: MateriaLocal[] = [];
  const slugVisto = new Map<string, string>(); // slug -> matéria onde apareceu

  for (const dirSlug of await pastas(RESUMOS)) {
    const dir = path.join(RESUMOS, dirSlug);
    const dirReviews = path.join(REVIEWS, dirSlug);

    // Aula e revisão viram uma lista só, cada item carregando o próprio
    // caminho: sem isso a revisão seria procurada na pasta da matéria.
    const entradas = [
      ...(await markdowns(dir)).map((f) => ({ file: f, caminho: path.join(dir, f) })),
      ...(await markdowns(dirReviews)).map((f) => ({ file: f, caminho: path.join(dirReviews, f) })),
    ].sort((x, y) => x.file.localeCompare(y.file));

    // O MOC (`<materia>.md`) é procurado só na pasta da matéria: é de lá que sai
    // o nome legível, e um arquivo de mesmo nome em `reviews/` não é o índice.
    const moc = path.join(dir, `${dirSlug}.md`);
    let nomeMateria = dirSlug;
    if (fsSync.existsSync(moc)) {
      const { content } = separarFrontmatter(await fs.readFile(moc, "utf8"));
      nomeMateria = semCodigo(tituloDe(content, dirSlug));
    }

    const pages: PaginaLocal[] = [];
    for (const { file, caminho } of entradas) {
      const pageSlug = file.replace(/\.md$/, "");

      if (slugVisto.has(pageSlug)) {
        // Recusa a publicação INTEIRA, antes de gravar qualquer coisa: com
        // `onConflict: user_id,slug`, publicar assim mesmo faria a segunda
        // página sobrescrever a primeira em silêncio.
        throw new Error(
          `Slug repetido no vault: "${pageSlug}" aparece em ${slugVisto.get(pageSlug)} e em ${dirSlug}. ` +
            `O banco exige slug único por conta (mesma regra dos [[wikilinks]] do CLAUDE.md). ` +
            `Renomeie uma das duas e publique de novo. Nada foi publicado.`,
        );
      }
      slugVisto.set(pageSlug, dirSlug);

      const { content, data } = separarFrontmatter(await fs.readFile(caminho, "utf8"));
      pages.push({
        slug: pageSlug,
        title: tituloDe(content, pageSlug),
        content,
        frontmatter: data,
        note_updated: dataIso(data.updated),
        source: data.source ? String(data.source) : null,
        source_href: data.sourceHref ? String(data.sourceHref) : null,
        is_moc: pageSlug === dirSlug,
        is_review: /-review$/i.test(pageSlug) || data.type === "review",
      });
    }

    local.push({ slug: dirSlug, code: dirSlug.split("-")[0], name: nomeMateria, pages });
  }

  /* ---------- 1b. lê as notas cruas ---------- */
  // A nota só pode ser publicada se a matéria existir (`notes.subject_id` é
  // obrigatório). Matéria em `Notes/` sem nenhuma página em `Resumos/` ainda não
  // existe no banco — avisa e segue, em vez de derrubar a publicação.
  const notasPorMateria = new Map<string, NotaLocal[]>();
  const notasSemMateria: string[] = [];

  for (const dirSlug of await pastas(NOTAS)) {
    const files = await markdowns(path.join(NOTAS, dirSlug));
    if (files.length === 0) continue;

    if (!local.some((s) => s.slug === dirSlug)) {
      notasSemMateria.push(`${dirSlug} (${files.length})`);
      continue;
    }

    const notas: NotaLocal[] = [];
    for (const file of files) {
      notas.push({
        slug: slugify(file),
        filename: file,
        content: await fs.readFile(path.join(NOTAS, dirSlug, file), "utf8"),
      });
    }
    notasPorMateria.set(dirSlug, notas);
  }

  const totalPaginas = local.reduce((n, s) => n + s.pages.length, 0);
  const totalNotas = [...notasPorMateria.values()].reduce((n, l) => n + l.length, 0);
  onLinha(`Disco: ${local.length} matéria(s), ${totalPaginas} página(s), ${totalNotas} nota(s).`);

  if (notasSemMateria.length) {
    onLinha(
      `  aviso: nota sem matéria publicada, ignorada: ${notasSemMateria.join(", ")} ` +
        `(rode o ingest de alguma aula dessa matéria e as notas sobem junto)`,
    );
  }

  /* ---------- 2. autentica ---------- */
  const { supabase, user } = await clienteAutenticado(vaultRoot);
  const nome = (user.user_metadata as Record<string, unknown> | undefined)?.name ?? user.email;
  onLinha(`Publicando na conta de ${nome}.`);

  /* ---------- 2b. guarda contra máquina desatualizada ---------- */
  /*
   * O publish é espelho: o que não está no disco é apagado do banco. Numa
   * máquina só isso é o comportamento certo. Com duas vira armadilha — abrir um
   * vault ainda vazio (ou desatualizado) e publicar dali faria o espelho
   * concluir que todas as outras aulas foram removidas, e apagá-las. Como o git
   * deixou de ser backup do conteúdo, isso seria perda de verdade.
   *
   * A guarda não tenta adivinhar intenção: só recusa a desproporção. Apagar uma
   * aula passa; apagar metade do vault para. Aqui ela não tem `--force`, porque
   * esta função não recebe um "eu sei o que estou fazendo" de ninguém — a saída
   * é puxar do banco primeiro (Primeiro uso / pull) e publicar depois.
   */
  const { count } = await supabase.from("pages").select("*", { count: "exact", head: true });
  const remoto = count ?? 0;
  if (remoto >= 4 && totalPaginas < remoto / 2) {
    throw new Error(
      `Parei sem publicar nada: o disco tem ${totalPaginas} página(s) e o banco tem ${remoto}. ` +
        `Como a publicação é um espelho, continuar apagaria ${remoto - totalPaginas} página(s) do banco. ` +
        `Isso quase sempre quer dizer que esta máquina está desatualizada — puxe o conteúdo do banco ` +
        `antes de publicar.`,
    );
  }

  /* ---------- 3. upsert das matérias ---------- */
  const idPorMateria = new Map<string, string>();
  for (const s of local) {
    const { data, error } = await supabase
      .from("subjects")
      .upsert(
        { user_id: user.id, code: s.code, slug: s.slug, name: s.name },
        { onConflict: "user_id,slug" },
      )
      .select("id")
      .single();

    if (error) throw new Error(`Falhou na matéria ${s.slug}: ${error.message}`);
    idPorMateria.set(s.slug, (data as { id: string }).id);
  }

  /* ---------- 4. upsert das páginas ---------- */
  for (const s of local) {
    const subject_id = idPorMateria.get(s.slug);
    for (const p of s.pages) {
      const { error } = await supabase
        .from("pages")
        .upsert({ user_id: user.id, subject_id, ...p }, { onConflict: "user_id,slug" });
      if (error) throw new Error(`Falhou na página ${s.slug}/${p.slug}: ${error.message}`);
    }
  }

  /* ---------- 4b. upsert das notas ---------- */
  for (const [materia, notas] of notasPorMateria) {
    const subject_id = idPorMateria.get(materia);
    for (const n of notas) {
      const { error } = await supabase
        .from("notes")
        .upsert({ user_id: user.id, subject_id, ...n }, { onConflict: "user_id,subject_id,slug" });
      if (error) throw new Error(`Falhou na nota ${materia}/${n.slug}: ${error.message}`);
    }
  }

  /* ---------- 4c. espelha o log.md ---------- */
  const eventos = await lerLog(path.join(vaultRoot, "log.md"));
  if (eventos.length) {
    const { error } = await supabase
      .from("ingests")
      .upsert(
        eventos.map((e) => ({ user_id: user.id, ...e })),
        { onConflict: "user_id,ingested_on,ordem" },
      );
    if (error) throw new Error(`Falhou ao publicar o histórico de ingests: ${error.message}`);
  }

  // Espelho também aqui: linha apagada do log.md some do site.
  const chavesLog = new Set(eventos.map((e) => `${e.ingested_on}|${e.ordem}`));
  const { data: eventosRemotos, error: errLog } = await supabase
    .from("ingests")
    .select("id, ingested_on, ordem");
  if (errLog) throw new Error(`Não consegui listar o histórico remoto: ${errLog.message}`);

  const eventosOrfaos = ((eventosRemotos ?? []) as { id: string; ingested_on: string; ordem: number }[])
    .filter((e) => !chavesLog.has(`${e.ingested_on}|${e.ordem}`));
  if (eventosOrfaos.length) {
    const { error } = await supabase
      .from("ingests")
      .delete()
      .in("id", eventosOrfaos.map((e) => e.id));
    if (error) throw new Error(`Não consegui remover eventos órfãos: ${error.message}`);
  }

  /* ---------- 5. remove o que sumiu do disco ---------- */
  // Sempre com os NOMES, nunca só a contagem: remoção costuma ser renomeação, e
  // ver o nome é o que distingue "renomeei" de "perdi".
  const slugsLocais = new Set(slugVisto.keys());
  const { data: paginasRemotas, error: errPages } = await supabase.from("pages").select("id, slug");
  if (errPages) throw new Error(`Não consegui listar as páginas remotas: ${errPages.message}`);

  const paginasOrfas = ((paginasRemotas ?? []) as { id: string; slug: string }[]).filter(
    (p) => !slugsLocais.has(p.slug),
  );
  if (paginasOrfas.length) {
    const { error } = await supabase
      .from("pages")
      .delete()
      .in("id", paginasOrfas.map((p) => p.id));
    if (error) throw new Error(`Não consegui remover páginas órfãs: ${error.message}`);
    for (const p of paginasOrfas) onLinha(`  removida: ${p.slug}`);
  }

  // A nota é identificada por (matéria, slug) — o mesmo nome pode existir em
  // duas matérias, e comparar só o slug apagaria a nota errada.
  const chavesNotas = new Set<string>();
  for (const [materia, notas] of notasPorMateria) {
    const sid = idPorMateria.get(materia);
    for (const n of notas) chavesNotas.add(`${sid}:${n.slug}`);
  }

  const { data: notasRemotas, error: errNotes } = await supabase
    .from("notes")
    .select("id, slug, subject_id");
  if (errNotes) throw new Error(`Não consegui listar as notas remotas: ${errNotes.message}`);

  const notasOrfas = ((notasRemotas ?? []) as { id: string; slug: string; subject_id: string }[])
    .filter((n) => !chavesNotas.has(`${n.subject_id}:${n.slug}`));
  if (notasOrfas.length) {
    const { error } = await supabase
      .from("notes")
      .delete()
      .in("id", notasOrfas.map((n) => n.id));
    if (error) throw new Error(`Não consegui remover notas órfãs: ${error.message}`);
    for (const n of notasOrfas) onLinha(`  nota removida: ${n.slug}`);
  }

  const slugsMateria = new Set(local.map((s) => s.slug));
  const { data: materiasRemotas, error: errSubjects } = await supabase
    .from("subjects")
    .select("id, slug");
  if (errSubjects) throw new Error(`Não consegui listar as matérias remotas: ${errSubjects.message}`);

  const materiasOrfas = ((materiasRemotas ?? []) as { id: string; slug: string }[]).filter(
    (m) => !slugsMateria.has(m.slug),
  );
  if (materiasOrfas.length) {
    // O cascade leva as páginas junto.
    const { error } = await supabase
      .from("subjects")
      .delete()
      .in("id", materiasOrfas.map((m) => m.id));
    if (error) throw new Error(`Não consegui remover matérias órfãs: ${error.message}`);
    for (const m of materiasOrfas) onLinha(`  matéria removida: ${m.slug}`);
  }

  onLinha(
    `Publicado: ${local.length} matéria(s), ${totalPaginas} página(s), ${totalNotas} nota(s)` +
      (eventos.length ? `, ${eventos.length} evento(s) de log.` : "."),
  );

  const removidas = [
    paginasOrfas.length && `${paginasOrfas.length} página(s): ${paginasOrfas.map((p) => p.slug).join(", ")}`,
    notasOrfas.length && `${notasOrfas.length} nota(s): ${notasOrfas.map((n) => n.slug).join(", ")}`,
    materiasOrfas.length &&
      `${materiasOrfas.length} matéria(s): ${materiasOrfas.map((m) => m.slug).join(", ")}`,
    eventosOrfaos.length && `${eventosOrfaos.length} evento(s) de log`,
  ].filter((x): x is string => typeof x === "string");
  if (removidas.length) onLinha(`Removidas: ${removidas.join(" | ")}`);

  /* ---------- 6. binários pro R2 ---------- */
  // Depois do texto, de propósito: se o upload falhar, o site já está coerente e
  // o material sobe na publicação seguinte. O contrário — arquivo no bucket sem
  // página que o referencie — seria lixo silencioso.
  await subirBinarios(vaultRoot, user.id, onLinha);
}

/* ------------------------------------------------------------------ *
 * Binários — só o que é separado por conta
 * ------------------------------------------------------------------ */

/**
 * `athena-web/public/materials` e `public/attachments` NÃO sobem por aqui.
 *
 * As chaves daqueles dois grupos (`materials/...`, `attachments/...`) são as
 * mesmas para todo mundo — é o caminho que a página do site referencia — e o
 * Worker só aceita gravar debaixo de `u/<id>/`, justamente para uma conta não
 * escrever por cima da outra. Quem os envia continua sendo o script do vault,
 * que fala com o R2 por credencial própria.
 */
const SERVIDOS = [
  path.join("athena-web", "public", "materials"),
  path.join("athena-web", "public", "attachments"),
];

/**
 * Pasta local -> grupo no bucket. Os dois nomes de grupo (`inatel`,
 * `raw-attachments`) sao prefixo de chave no R2 e NAO acompanharam o rename da
 * pasta: as chaves ja estao gravadas assim, e trocar o prefixo obrigaria a
 * recopiar centenas de MB sem mudar nada para quem usa o app.
 */
const FONTES: { grupo: Grupo; rel: string[] }[] = [
  { grupo: "inatel", rel: ["Notes", "INATEL"] },
  { grupo: "raw-attachments", rel: ["Notes", "attachments"] },
];

async function subirBinarios(
  vaultRoot: string,
  userId: string,
  onLinha: (s: string) => void,
): Promise<void> {
  let servidos = 0;
  for (const rel of SERVIDOS) servidos += (await arquivosDe(path.join(vaultRoot, rel))).length;
  if (servidos > 0) {
    onLinha(
      `${servidos} arquivo(s) em athena-web/public/ não sobem por aqui (essas chaves não são ` +
        `separadas por conta e o portão do R2 as recusa) — continuam dependendo do ` +
        `athena publish do vault.`,
    );
  }

  const envios = { novo: 0, atualizado: 0, igual: 0 };
  const enviados: string[] = [];
  let mexeuNoBucket = false;

  try {
    for (const { grupo, rel } of FONTES) {
      const base = path.join(vaultRoot, ...rel);
      const arquivos = await arquivosDe(base);
      if (arquivos.length === 0) continue;

      // A listagem diz o que já está no bucket e com que sha — é o equivalente
      // ao HEAD por objeto do script, numa ida à rede só.
      let remotos: ObjetoRemoto[];
      try {
        remotos = await listar(vaultRoot, grupo);
      } catch (e) {
        throw new Error(
          `Não consegui conferir o que já está no bucket (${grupo}): ${(e as Error).message} ` +
            `O texto já foi publicado; tente de novo para enviar os arquivos.`,
        );
      }
      const shaRemoto = new Map(remotos.map((o) => [o.rel, o.sha256]));

      for (const caminho of arquivos) {
        const relArquivo = path.relative(base, caminho).split(path.sep).join("/");
        const key = `u/${userId}/${grupo}/${relArquivo}`;
        const bytes = await fs.readFile(caminho);
        const sha = shaCurto(bytes);

        // Compara por conteúdo, não por tamanho: edição que não muda o tamanho
        // passaria batida, e reenviar centenas de MB a cada publicação por não
        // saber seria pior ainda. Objeto antigo sem sha (null) sobe de novo —
        // é o único jeito de ele ganhar o metadado.
        const jaLa = shaRemoto.get(relArquivo);
        if (jaLa === sha) {
          envios.igual++;
          continue;
        }

        try {
          await subir(vaultRoot, key, bytes, sha, tipoDe(caminho));
        } catch (e) {
          throw new Error(
            `Falhou ao enviar ${relArquivo}: ${(e as Error).message} ` +
              `O texto já foi publicado — corrija e publique de novo.`,
          );
        }
        mexeuNoBucket = true;
        if (jaLa === undefined) envios.novo++;
        else envios.atualizado++;
        enviados.push(`${relArquivo} (${bytesLegivel(bytes.byteLength)})`);
      }
    }
  } finally {
    // A listagem fica guardada enquanto o app estiver aberto; depois de gravar,
    // o que está em memória é uma foto vencida — e a próxima publicação
    // reenviaria tudo de novo por não ver o que acabou de subir.
    if (mexeuNoBucket) esquecer();
  }

  const total = envios.novo + envios.atualizado + envios.igual;
  if (total === 0) {
    onLinha("Nenhum binário em Notes/INATEL ou Notes/attachments.");
    return;
  }
  onLinha(
    `R2: ${envios.novo} novo(s), ${envios.atualizado} atualizado(s), ${envios.igual} já no bucket.`,
  );
  for (const e of enviados) onLinha(`  ↑ ${e}`);
}


/* ------------------------------------------------------------------ *
 * Apagar tambem da nuvem
 * ------------------------------------------------------------------ */

/**
 * Tira da nuvem o que corresponde a um caminho do vault.
 *
 * Existe porque, com o espelho, apagar so no disco deixou de significar
 * alguma coisa: o arquivo continua no bucket, volta a aparecer na arvore como
 * "na nuvem" e desce de novo no primeiro clique. Quem quer se livrar do
 * material precisa de uma porta que chegue la — e ela e esta, chamada SO
 * depois da confirmacao explicita no dialogo.
 *
 * Dois destinos, porque sao dois lugares diferentes:
 *
 *   `Notes/INATEL/...`, `Notes/attachments/...`  -> objetos no R2
 *   `Notes/subjects/<MATERIA>/<arquivo>.md`      -> linha na tabela `notes`
 *
 * `Resumos/` NAO passa por aqui de proposito: pagina gerada sai pelo
 * `athena delete`, que tambem desfaz as ligacoes do MOC e anota no log —
 * apagar so a linha deixaria o indice apontando para o vazio.
 *
 * Falha parcial e informada, nao engolida: o arquivo local so vai para a
 * lixeira depois que isto volta sem erro (ver `fs:trash` no main).
 */
export async function apagarNaNuvem(
  vaultRoot: string,
  relVault: string,
  onLinha: (s: string) => void,
): Promise<{ r2: number; banco: number }> {
  const rel = relVault.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  let r2 = 0;
  let banco = 0;

  /* ---------- binarios no R2 ---------- */
  const chaves = await chavesDe(vaultRoot, rel);
  for (const chave of chaves) {
    await apagar(vaultRoot, chave);
    r2++;
    onLinha(`  nuvem: ${chave.split("/").slice(2).join("/")}`);
  }

  /* ---------- notas no Supabase ---------- */
  // `Notes/subjects/<MATERIA>` (a materia inteira) ou um .md dentro dela.
  const m = /^Notes\/subjects\/([^/]+)(?:\/(.+))?$/.exec(rel);
  if (m) {
    const { supabase } = await clienteAutenticado(vaultRoot);
    const materia = m[1];
    const arquivo = m[2];

    const { data: mat, error: errMat } = await supabase
      .from("subjects")
      .select("id")
      .eq("slug", materia)
      .maybeSingle();
    if (errMat) throw new Error(`Não consegui achar a matéria no banco: ${errMat.message}`);

    if (mat?.id) {
      // O slug da nota e o mesmo que o publish grava: slugify do nome do
      // arquivo. Se essa regra mudar la, muda aqui junto.
      let q = supabase
        .from("notes")
        .delete({ count: "exact" })
        .eq("subject_id", mat.id as string);
      if (arquivo) {
        if (!arquivo.endsWith(".md")) return { r2, banco };
        q = q.eq("slug", slugify(arquivo));
      }
      const { error, count } = await q;
      if (error) throw new Error(`Não consegui remover a nota do banco: ${error.message}`);
      banco = count ?? 0;
      if (banco) onLinha(`  banco: ${banco} nota(s) de ${materia}`);
    }
  }

  return { r2, banco };
}
