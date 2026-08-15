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

const WRITABLE_PREFIXES = [
  "raw/subjects",
  "raw/concepts",
  "raw/games",
  "raw/studies",
  // Destino das imagens coladas na nota: e o primeiro lugar onde o passo 1 do
  // CLAUDE.md procura ao encontrar `![[arquivo]]`. Colar em outra pasta
  // significa imagem que o ingest nao acha.
  "raw/attachments",
];

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
    return WRITABLE_PREFIXES.some(
      (p) => norm === p || norm.startsWith(p + "/"),
    );
  }

  async read(rel: string): Promise<string> {
    // O mount do OneDrive as vezes injeta null bytes; limpar na leitura.
    const raw = await fs.readFile(this.resolve(rel), "utf8");
    return raw.replace(/\0/g, "");
  }

  async write(rel: string, content: string): Promise<void> {
    if (!this.isWritable(rel)) {
      throw new Error(
        `Escrita bloqueada em "${rel}". O app so escreve em raw/subjects, ` +
          `raw/concepts, raw/games e raw/studies. Paginas da wiki nascem do ingest.`,
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

  private async listDir(rel: string): Promise<string[]> {
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
        `${acao} bloqueado em "${rel}". O app so mexe em raw/subjects, raw/concepts, ` +
          `raw/games, raw/studies e raw/attachments. raw/INATEL/ e wiki/ sao somente leitura.`,
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

  /** Le o .ingest-status da RAIZ do vault (nunca relativo ao cwd). */
  async ingestStatus(): Promise<"OK" | "FAIL" | "NONE"> {
    try {
      const raw = await fs.readFile(this.resolve(".ingest-status"), "utf8");
      return raw.trim().toUpperCase().startsWith("OK") ? "OK" : "FAIL";
    } catch {
      return "NONE";
    }
  }
}
