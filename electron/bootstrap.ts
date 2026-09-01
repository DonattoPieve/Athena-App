import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import { clienteAutenticado } from "./account";
import { urlWorker } from "./materiais";
import { decidir } from "./sincronia";

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
 * REGRA DE OURO, em todo este arquivo: nunca PERDER trabalho do usuário.
 * Pasta não-vazia faz `criarVault` recusar. Arquivo divergente só é
 * sobrescrito quando a versão da conta é comprovadamente mais nova (pelo
 * `updated:` que a própria página carrega — ver `sincronia.ts`), e mesmo aí
 * uma cópia do que estava aqui vai antes para `.athena/lixeira/`. Sem data
 * dos dois lados, ou com datas iguais, continua valendo o disco e a linha vai
 * como conflito.
 *
 * O "nunca sobrescrever" puro, que valia antes, protegia contra perder o
 * local e criava o buraco oposto: página regerada noutro PC nunca chegava
 * aqui, e publicar deste lado mandava a versão velha de volta.
 */

/* ------------------------------------------------------------------ *
 * criarVault
 * ------------------------------------------------------------------ */

/** Pastas que todo vault precisa ter, mesmo vazias — ver CLAUDE.md. */
const PASTAS_DO_VAULT = [
  "Notes/subjects",
  "Notes/concepts",
  "Notes/games",
  "Notes/studies",
  "Notes/INATEL",
  "Notes/attachments",
  "Resumos/subjects",
  "Resumos/reviews",
];

/**
 * Onde moram os arquivos-modelo (`CLAUDE.md`, `COMANDOS.md`, `TEMPLATE.md`) que vão dentro
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

  // O `TEMPLATE.md` entra aqui porque o proprio protocolo o exige: o passo 4
  // do `CLAUDE.md` manda "seguir o TEMPLATE.md". Sem ele, um vault criado pelo
  // app parava o ingest na primeira aula, perguntando onde estava o arquivo —
  // e a resposta era "em outro vault, porque o app nunca o copiou".
  for (const nome of ["CLAUDE.md", "COMANDOS.md", "TEMPLATE.md"]) {
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
  /** Sobrescritos porque a versão da conta era mais nova (cópia guardada). */
  atualizados: number;
  /** A sua cópia é mais nova que a da conta — mantida, e você precisa publicar. */
  maisNovos: string[];
  /** Arquivos que já existiam com conteúdo diferente do banco — não tocados. */
  conflitos: string[];
  /** O Worker do R2 não respondeu (ou não foi publicado): PDFs/anexos não vieram. */
  semR2: boolean;
};

/**
 * Puxa `subjects`, `pages` e `notes` do Supabase e os binários (`Notes/INATEL`,
 * `Notes/attachments`) do R2 — as MESMAS tabelas e o MESMO formato de arquivo
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
  const stats: ResultadoBootstrap = {
    criados: 0,
    iguais: 0,
    atualizados: 0,
    maisNovos: [],
    conflitos: [],
    semR2: false,
  };

  const { supabase, user } = await clienteAutenticado(destino);
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

  const RESUMOS = path.join(destino, "Resumos", "subjects");
  // As questões de revisão moram em `Resumos/reviews/<matéria>/`. O banco guarda
  // matéria e slug, não pasta: sem olhar `is_review` aqui, a revisão seria
  // recriada em `Resumos/subjects/` e o publish seguinte recusaria tudo com
  // "slug repetido no vault", vendo o mesmo `-review` nos dois lugares.
  const REVIEWS = path.join(destino, "Resumos", "reviews");
  const NOTAS = path.join(destino, "Notes", "subjects");

  for (const p of pages ?? []) {
    const materia = slugPorId.get(p.subject_id as string);
    if (!materia) continue;
    const fm = (p.frontmatter ?? {}) as Record<string, unknown>;
    const conteudo = Object.keys(fm).length
      ? serializarComFrontmatter(p.content as string, fm)
      : (p.content as string);

    const pasta = p.is_review ? "Resumos/reviews" : "Resumos/subjects";
    await gravar(
      path.join(p.is_review ? REVIEWS : RESUMOS, materia, `${p.slug}.md`),
      conteudo,
      `${pasta}/${materia}/${p.slug}.md`,
      (atual) => mesmoConteudo(atual, p.content as string, fm),
      stats,
      onLinha,
      // O desempate sai do `updated` da propria pagina — o mesmo campo que o
      // ingest escreve e que viaja no publish. Ver `sincronia.ts`.
      fm.updated === undefined ? null : paraTexto(fm.updated),
    );
  }

  for (const n of notes ?? []) {
    const materia = slugPorId.get(n.subject_id as string);
    if (!materia) continue;
    await gravar(
      path.join(NOTAS, materia, n.filename as string),
      n.content as string,
      `Notes/subjects/${materia}/${n.filename}`,
      (atual) => atual === n.content,
      stats,
      onLinha,
    );
  }

  // ---------- material pesado: sob demanda, não agora ----------
  // `Notes/INATEL` tem centenas de MB e o primeiro uso não precisa deles: quem
  // baixa é o próprio ato de abrir o arquivo (ver materiais.ts). Trazer tudo
  // aqui era meia hora de espera antes de a pessoa ver a primeira página.
  if (!urlWorker(destino)) {
    stats.semR2 = true;
    onLinha(
      "O portão do R2 (Worker) ainda não foi publicado — o material do professor e " +
        "os anexos não vão poder ser abertos neste PC. As páginas e as notas funcionam.",
    );
  } else {
    onLinha(
      "Material do professor e anexos ficam sob demanda: cada arquivo desce na " +
        "primeira vez que você o abrir e fica guardado para as próximas — inclusive " +
        "sem internet.",
    );
  }

  const partes = [`${stats.criados} criado(s)`, `${stats.iguais} já igual(is)`];
  if (stats.atualizados) partes.push(`${stats.atualizados} atualizado(s) da conta`);
  if (stats.maisNovos.length) partes.push(`${stats.maisNovos.length} mais novo(s) aqui`);
  if (stats.conflitos.length) partes.push(`${stats.conflitos.length} conflito(s)`);
  onLinha(`\n${partes.join(", ")}${stats.conflitos.length || stats.maisNovos.length ? " — veja acima." : "."}`);
  return stats;
}

/**
 * Escreve o que veio do banco, decidindo o que fazer quando o arquivo já
 * existe e diverge. A regra está em `sincronia.ts`; aqui é só a mão que
 * executa — inclusive a cópia de segurança antes de sobrescrever.
 *
 * `updatedBanco` só é passado para PÁGINA. Nota do aluno (`notes`) não tem
 * data no banco, e sem data não há desempate: ela cai sempre em conflito, que
 * é o certo — texto que a pessoa escreveu não se sobrescreve por palpite.
 */
async function gravar(
  caminho: string,
  conteudo: string,
  rotulo: string,
  comparar: (atual: string) => boolean,
  stats: ResultadoBootstrap,
  onLinha: (s: string) => void,
  updatedBanco?: string | null,
): Promise<void> {
  const existe = fsSync.existsSync(caminho);
  const atual = existe ? await fs.readFile(caminho, "utf8") : "";
  const decisao = decidir({
    existe,
    igual: existe && comparar(atual),
    updatedLocal: existe ? parseFrontmatter(atual).data.updated : null,
    updatedBanco,
  });

  switch (decisao.acao) {
    case "criar":
      await fs.mkdir(path.dirname(caminho), { recursive: true });
      await fs.writeFile(caminho, conteudo, "utf8");
      stats.criados++;
      onLinha(`  + ${rotulo}`);
      return;

    case "igual":
      stats.iguais++;
      return;

    case "atualizar": {
      // A cópia vai ANTES de escrever. Se a máquina cair no meio, o que se
      // perde é a cópia, não o original.
      const copia = await guardarCopia(caminho, rotulo);
      await fs.writeFile(caminho, conteudo, "utf8");
      stats.atualizados++;
      onLinha(
        `  ↑ ${rotulo} — a da conta é mais nova (${decisao.banco} > ${decisao.local})` +
          (copia ? `; a sua ficou em ${copia}` : ""),
      );
      return;
    }

    case "local-mais-novo":
      stats.maisNovos.push(rotulo);
      onLinha(
        `  = ${rotulo} — a SUA é mais nova (${decisao.local} > ${decisao.banco}); ` +
          `mantida. Publique deste computador para mandá-la para a conta`,
      );
      return;

    case "conflito":
      stats.conflitos.push(rotulo);
      onLinha(`  ! ${rotulo} já existe com conteúdo diferente do banco — não sobrescrito`);
      return;
  }
}

/**
 * Cópia do que estava no disco, antes de o banco passar por cima.
 *
 * Mesmo lugar e mesmo nome que o `vault.arquivar()` usa antes de um `redo`:
 * `.athena/lixeira/<carimbo>__<caminho com __>`. A pasta começa com ponto,
 * então a árvore não a mostra — é rede de segurança, não conteúdo.
 */
async function guardarCopia(caminho: string, rotulo: string): Promise<string | null> {
  try {
    const conteudo = await fs.readFile(caminho, "utf8");
    const raiz = caminho.slice(0, caminho.length - rotulo.split("/").join(path.sep).length);
    const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const nome = `${carimbo}__${rotulo.split("/").join("__")}`;
    const destino = path.join(raiz, ".athena", "lixeira", nome);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, conteudo, "utf8");
    return path.posix.join(".athena/lixeira", nome);
  } catch {
    // Sem a cópia, NÃO sobrescreve seria mais seguro — mas quem chama já
    // decidiu que a versão da conta e mais nova, e recusar aqui deixaria o PC
    // atrasado para sempre. Segue, sem a rede.
    return null;
  }
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

function bytesLegivel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
