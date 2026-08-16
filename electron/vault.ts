import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

/**
 * Camada de acesso ao vault. Tudo que o renderer pede passa por aqui.
 *
 * As invariantes do CLAUDE.md viram codigo:
 *  - escrita SO em raw/subjects, raw/concepts, raw/games, raw/studies
 *  - raw/INATEL/ e wiki/ sao somente leitura pelo app
 *  - nenhum caminho pode escapar da raiz do vault
 */

/**
 * Escrita: `raw/` inteiro, MENOS `raw/INATEL/`.
 *
 * O `raw/` e seu — nota, rascunho, anexo, pasta nova que voce inventar. O
 * INATEL e o material do professor: e a fonte que o ingest le, e uma edicao
 * ali corrompe a origem sem deixar rastro. `wiki/` continua fora porque
 * pagina gerada se corrige reprocessando, nao editando.
 */
const RAW = "raw";
const SOMENTE_LEITURA = ["raw/INATEL"];

const IGNORED = new Set([
  "node_modules",
  ".git",
  ".obsidian",
  "dist",
  ".next",
  ".vercel",
]);

export type TreeNode = {
  name: string;
  rel: string;
  dir: boolean;
  children?: TreeNode[];
};

/** Retrato do vault para a home. Tudo lido do disco, nada do banco. */
export type HomeData = {
  subjects: { code: string; slug: string; nome: string; paginas: number; rel: string }[];
  paginas: { slug: string; subject: string; titulo: string; rel: string; updated: string }[];
  notas: number;
  eventos: { data: string; texto: string; slug: string | null; removido: boolean }[];
  /** Marcadores de conflito de merge no log.md — some do publish sem aviso. */
  logConflitado: boolean;
};

export type SubjectRef = { code: string; name: string; folder: string };

export type Target = {
  code: string;
  lesson: string | null;
  /** nota crua do aluno em raw/subjects, se existir */
  rawNote: string | null;
  /** candidatos de material oficial em raw/INATEL */
  official: string[];
  /** pagina gerada em wiki/ */
  wikiPage: string | null;
  /** review gerado, se existir */
  wikiReview: string | null;
  /** copia do material no site */
  material: string | null;
  /** espelho em athena-web/wiki */
  mirror: string | null;
  mirrorReview: string | null;
  /** MOC da materia */
  moc: string | null;
};

export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class Vault {
  constructor(public readonly root: string) {}

  static isVault(dir: string): boolean {
    return (
      fsSync.existsSync(path.join(dir, "CLAUDE.md")) &&
      fsSync.existsSync(path.join(dir, "raw"))
    );
  }

  /** Resolve um caminho relativo garantindo que ele nao escapa da raiz. */
  resolve(rel: string): string {
    const root = path.resolve(this.root);
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`Caminho fora do vault: ${rel}`);
    }
    return abs;
  }

  isWritable(rel: string): boolean {
    const norm = rel.split(path.sep).join("/").replace(/^\/+/, "");
    if (norm !== RAW && !norm.startsWith(RAW + "/")) return false;
    return !SOMENTE_LEITURA.some((p) => norm === p || norm.startsWith(p + "/"));
  }

  async read(rel: string): Promise<string> {
    // O mount do OneDrive as vezes injeta null bytes; limpar na leitura.
    const raw = await fs.readFile(this.resolve(rel), "utf8");
    return raw.replace(/\0/g, "");
  }

  async write(rel: string, content: string): Promise<void> {
    if (!this.isWritable(rel)) {
      throw new Error(
        `Escrita bloqueada em "${rel}". O app escreve em raw/, menos raw/INATEL/ ` +
          `(material do professor). Pagina da wiki nasce do ingest.`,
      );
    }
    const abs = this.resolve(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }

  async tree(rel: string): Promise<TreeNode[]> {
    const abs = this.resolve(rel);
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: TreeNode[] = [];
    for (const e of entries) {
      if (e.name.startsWith(".") || IGNORED.has(e.name)) continue;
      const childRel = path.posix.join(rel, e.name);
      if (e.isDirectory()) {
        out.push({
          name: e.name,
          rel: childRel,
          dir: true,
          children: await this.tree(childRel),
        });
      } else if (e.isFile()) {
        out.push({ name: e.name, rel: childRel, dir: false });
      }
    }
    return out.sort((a, b) =>
      a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1,
    );
  }

  /** Materias deduzidas das pastas de raw/subjects (padrao CODIGO-Nome). */
  async subjects(): Promise<SubjectRef[]> {
    const abs = this.resolve("raw/subjects");
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => {
        const [code, ...rest] = e.name.split("-");
        return { code, name: rest.join("-") || code, folder: e.name };
      });
  }

  /** Publico porque `biblioteca.ts` varre a wiki para o glossario. */
  async listDir(rel: string): Promise<string[]> {
    try {
      return await fs.readdir(this.resolve(rel));
    } catch {
      return [];
    }
  }

  private async findFolder(base: string, code: string): Promise<string | null> {
    const entries = await this.listDir(base);
    const hit = entries.find((n) => n.toUpperCase().startsWith(code.toUpperCase()));
    return hit ? path.posix.join(base, hit) : null;
  }

  private async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(rel));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Descreve tudo que existe hoje para um alvo (materia + aula opcional).
   * Alimenta as precondicoes dos botoes E a previa do delete.
   */
  async describe(code: string, lesson: string | null): Promise<Target> {
    const t: Target = {
      code,
      lesson,
      rawNote: null,
      official: [],
      wikiPage: null,
      wikiReview: null,
      material: null,
      mirror: null,
      mirrorReview: null,
      moc: null,
    };

    const subjFolder = await this.findFolder("raw/subjects", code);
    const inatelFolder = await this.findFolder("raw/INATEL", code);
    const wikiFolder = await this.findFolder("wiki/subjects", code);
    const mirrorFolder = await this.findFolder("athena-web/wiki/subjects", code);
    const matFolder = await this.findFolder("athena-web/public/materials", code);

    if (wikiFolder) {
      const moc = path.posix.join(wikiFolder, path.posix.basename(wikiFolder) + ".md");
      if (await this.exists(moc)) t.moc = moc;
    }

    if (inatelFolder) {
      const files = await this.listDir(inatelFolder);
      t.official = files
        .filter((f) => /\.(pdf|pptx?|docx?)$/i.test(f))
        .filter((f) => (lesson ? slugify(f).includes(lesson) || lesson.includes(slugify(f)) : true))
        .map((f) => path.posix.join(inatelFolder, f));
    }

    if (!lesson) return t;

    if (subjFolder) {
      const files = await this.listDir(subjFolder);
      const hit = files.find((f) => f.endsWith(".md") && slugify(f) === lesson);
      if (hit) t.rawNote = path.posix.join(subjFolder, hit);
    }
    if (wikiFolder) {
      const page = path.posix.join(wikiFolder, `${lesson}.md`);
      const review = path.posix.join(wikiFolder, `${lesson}-review.md`);
      if (await this.exists(page)) t.wikiPage = page;
      if (await this.exists(review)) t.wikiReview = review;
    }
    if (mirrorFolder) {
      const page = path.posix.join(mirrorFolder, `${lesson}.md`);
      const review = path.posix.join(mirrorFolder, `${lesson}-review.md`);
      if (await this.exists(page)) t.mirror = page;
      if (await this.exists(review)) t.mirrorReview = review;
    }
    if (matFolder) {
      const files = await this.listDir(matFolder);
      const hit = files.find((f) => slugify(f) === lesson);
      if (hit) t.material = path.posix.join(matFolder, hit);
    }
    return t;
  }

  // ------------------------------------------------------------------
  // Operacoes de arquivo do explorer.
  //
  // Todas passam por isWritable(): a arvore mostra `raw/INATEL` e `wiki/`,
  // e um menu de contexto que apagasse qualquer no seria a maneira mais
  // rapida de perder o material do professor ou uma pagina gerada.
  // ------------------------------------------------------------------

  private assertWritable(rel: string, acao: string) {
    if (!this.isWritable(rel)) {
      throw new Error(
        `${acao} bloqueado em "${rel}". O app mexe em raw/, menos raw/INATEL/ ` +
          `(material do professor). wiki/ e somente leitura.`,
      );
    }
  }

  async mkdir(rel: string): Promise<void> {
    this.assertWritable(rel, "Criar pasta");
    const abs = this.resolve(rel);
    if (fsSync.existsSync(abs)) throw new Error(`Ja existe: ${rel}`);
    await fs.mkdir(abs, { recursive: true });
  }

  /** Cria arquivo novo. Recusa sobrescrever — isso e trabalho do usuario. */
  async create(rel: string, content = ""): Promise<void> {
    this.assertWritable(rel, "Criar arquivo");
    const abs = this.resolve(rel);
    if (fsSync.existsSync(abs)) throw new Error(`Ja existe: ${rel}`);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }

  /** Renomeia dentro da mesma pasta. Origem e destino precisam ser gravaveis. */
  async rename(rel: string, nome: string): Promise<string> {
    this.assertWritable(rel, "Renomear");
    if (!nome.trim() || /[\\/:*?"<>|]/.test(nome)) {
      throw new Error(`Nome invalido: "${nome}"`);
    }
    const destino = path.posix.join(path.posix.dirname(rel), nome.trim());
    this.assertWritable(destino, "Renomear");
    const abs = this.resolve(destino);
    if (fsSync.existsSync(abs)) throw new Error(`Ja existe: ${destino}`);
    await fs.rename(this.resolve(rel), abs);
    return destino;
  }

  /** Caminho absoluto para a lixeira do sistema (quem chama e o main). */
  trashTarget(rel: string): string {
    this.assertWritable(rel, "Apagar");
    return this.resolve(rel);
  }

  /**
   * Nome livre dentro de uma pasta: `base.ext`, `base-2.ext`, `base-3.ext`...
   * Colar duas imagens seguidas nao pode sobrescrever a primeira.
   */
  async freeName(dirRel: string, base: string, ext: string): Promise<string> {
    const dir = this.resolve(dirRel);
    await fs.mkdir(dir, { recursive: true });
    const existentes = new Set(await this.listDir(dirRel));
    let nome = `${base}.${ext}`;
    let i = 2;
    while (existentes.has(nome)) nome = `${base}-${i++}.${ext}`;
    return nome;
  }

  /** Grava binario (imagem colada). Mesmas guardas da escrita de texto. */
  async writeBinary(rel: string, data: Uint8Array): Promise<void> {
    this.assertWritable(rel, "Gravar");
    const abs = this.resolve(rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
  }

  /**
   * Slugs de todas as aulas ja publicadas — alimenta o seletor de `[[link]]`.
   * Reviews ficam de fora: o CLAUDE.md nao liga review no MOC, e oferecer um
   * link para ele no editor convida a criar exatamente essa aresta errada.
   */
  async lessons(): Promise<{ slug: string; subject: string }[]> {
    const base = "wiki/subjects";
    const out: { slug: string; subject: string }[] = [];
    for (const materia of await this.listDir(base)) {
      const dir = path.posix.join(base, materia);
      for (const f of await this.listDir(dir)) {
        if (!f.endsWith(".md")) continue;
        const slug = f.slice(0, -3);
        if (slug.endsWith("-review") || slug === materia) continue;
        out.push({ slug, subject: materia });
      }
    }
    return out.sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * Retrato do vault para a home: materias, paginas, quantas notas e o
   * historico do log.md. Le do DISCO, nao do banco — a home tem que dizer a
   * verdade sobre esta maquina mesmo sem conta e sem internet.
   */
  async home(): Promise<HomeData> {
    const subjects: HomeData["subjects"] = [];
    const paginas: HomeData["paginas"] = [];

    for (const materia of await this.listDir("wiki/subjects")) {
      const dirRel = path.posix.join("wiki/subjects", materia);
      const arquivos = (await this.listDir(dirRel)).filter((f) => f.endsWith(".md"));
      let paginasDaMateria = 0;

      for (const f of arquivos) {
        const slug = f.slice(0, -3);
        const rel = path.posix.join(dirRel, f);
        // MOC e review nao contam como aula: um e indice, o outro e exercicio.
        const ehMoc = slug === materia;
        const ehReview = slug.endsWith("-review");
        let updated = "";
        let titulo = slug;
        try {
          const texto = await this.read(rel);
          updated = /^updated:\s*'?([0-9-]{10})'?/m.exec(texto)?.[1] ?? "";
          titulo = /^#\s+(.+)$/m.exec(texto)?.[1]?.trim() ?? slug;
        } catch {
          // arquivo ilegivel nao derruba a home
        }
        if (!ehMoc && !ehReview) {
          paginasDaMateria++;
          paginas.push({ slug, subject: materia, titulo, rel, updated });
        }
      }

      subjects.push({
        code: materia.split("-")[0],
        slug: materia,
        nome: materia.split("-").slice(1).join(" ") || materia,
        paginas: paginasDaMateria,
        rel: dirRel,
      });
    }

    paginas.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));

    let notas = 0;
    for (const materia of await this.listDir("raw/subjects")) {
      const arquivos = await this.listDir(path.posix.join("raw/subjects", materia));
      notas += arquivos.filter((f) => f.endsWith(".md")).length;
    }

    // ---- log.md ----
    const eventos: HomeData["eventos"] = [];
    let logConflitado = false;
    try {
      const log = await this.read("log.md");
      logConflitado = /^<<<<<<< |^>>>>>>> /m.test(log);
      let data = "";
      for (const linha of log.split("\n")) {
        const cab = /^##\s+(\d{4}-\d{2}-\d{2})/.exec(linha);
        if (cab) {
          data = cab[1];
          continue;
        }
        if (!linha.startsWith("- ") || !data) continue;
        const removido = /^-\s+removido:/.test(linha);
        const slug = /`([^`]+)`/.exec(linha)?.[1] ?? (removido ? linha.split(":")[1]?.trim() : null);
        eventos.push({
          data,
          texto: linha.slice(2).trim(),
          slug: slug ?? null,
          removido,
        });
      }
    } catch {
      // vault sem log.md ainda e caso normal
    }

    return { subjects, paginas, notas, eventos: eventos.slice(0, 40), logConflitado };
  }

  /**
   * Caminho da pagina de um `[[wikilink]]`. Procura em wiki/subjects/*.
   * Devolve null quando o link aponta para aula que nao existe — link orfao
   * e caso comum e nao pode virar erro na tela.
   */
  async resolveLink(slug: string): Promise<string | null> {
    const alvo = slug.trim().replace(/\.md$/i, "");
    for (const materia of await this.listDir("wiki/subjects")) {
      const dir = path.posix.join("wiki/subjects", materia);
      for (const f of await this.listDir(dir)) {
        if (f === `${alvo}.md`) return path.posix.join(dir, f);
      }
      // O link pode apontar para a materia (o MOC tem o nome da pasta).
      if (materia === alvo) return path.posix.join(dir, `${materia}.md`);
    }
    return null;
  }

  /** Le o .ingest-status da RAIZ do vault (nunca relativo ao cwd). */
  /**
   * Guarda uma copia antes de um comando destruir o arquivo.
   *
   * `redo` reescreve a pagina do zero e `delete` a apaga. Os dois sao
   * legitimos e os dois ja perderam edicao feita a mao. `.athena/lixeira/`
   * custa alguns KB e transforma "se perdeu" em "esta ali".
   *
   * Nao e versionamento: e o ultimo estado antes de cada comando destrutivo,
   * com data no nome para nao sobrescrever a copia anterior.
   */
  async arquivar(rel: string): Promise<string | null> {
    const origem = this.resolve(rel);
    try {
      const conteudo = await fs.readFile(origem, "utf8");
      const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const nome = `${carimbo}__${rel.split("/").join("__")}`;
      const destino = path.join(this.root, ".athena", "lixeira", nome);
      await fs.mkdir(path.dirname(destino), { recursive: true });
      await fs.writeFile(destino, conteudo, "utf8");
      return path.posix.join(".athena/lixeira", nome);
    } catch {
      // Arquivo inexistente e o caso normal do ingest: nao ha o que guardar.
      return null;
    }
  }

  /**
   * Busca DENTRO dos arquivos.
   *
   * A busca por nome ja existia e resolve quando voce lembra do nome. Quando a
   * pergunta e "onde eu falei de ponteiro?", o nome nao ajuda — o texto ajuda.
   */
  async buscarConteudo(
    termo: string,
    limite = 80,
  ): Promise<{ rel: string; linha: number; trecho: string }[]> {
    const alvo = termo.trim().toLowerCase();
    if (alvo.length < 2) return [];

    const achados: { rel: string; linha: number; trecho: string }[] = [];
    const visitar = async (base: string) => {
      for (const materia of await this.listDir(base)) {
        const dir = path.posix.join(base, materia);
        // Um nivel de pasta e a forma do vault; mais que isso vira varredura.
        const entradas = await this.listDir(dir);
        const arquivos = entradas.filter((f) => /\.(md|txt)$/i.test(f));
        // A pasta pode ser o proprio arquivo (raw/Ideias/Athena.md).
        if (/\.(md|txt)$/i.test(materia)) arquivos.push("");
        for (const f of arquivos) {
          if (achados.length >= limite) return;
          const rel = f ? path.posix.join(dir, f) : path.posix.join(base, materia);
          let texto = "";
          try {
            texto = await this.read(rel);
          } catch {
            continue;
          }
          const linhas = texto.split("\n");
          for (let i = 0; i < linhas.length; i++) {
            if (!linhas[i].toLowerCase().includes(alvo)) continue;
            achados.push({ rel, linha: i + 1, trecho: linhas[i].trim().slice(0, 200) });
            break; // uma linha por arquivo: a lista e para navegar, nao para ler
          }
        }
      }
    };
    await visitar("wiki/subjects");
    await visitar("raw/subjects");
    await visitar("raw");
    return achados.slice(0, limite);
  }

  async ingestStatus(): Promise<"OK" | "FAIL" | "NONE"> {
    try {
      const raw = await fs.readFile(this.resolve(".ingest-status"), "utf8");
      return raw.trim().toUpperCase().startsWith("OK") ? "OK" : "FAIL";
    } catch {
      return "NONE";
    }
  }
}
