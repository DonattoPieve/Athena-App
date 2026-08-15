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
