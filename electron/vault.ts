import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

/**
 * Camada de acesso ao vault. Tudo que o renderer pede passa por aqui.
 *
 * As invariantes do CLAUDE.md viram codigo:
 *  - escrita SO em Notes/subjects, Notes/concepts, Notes/games, Notes/studies
 *  - Notes/INATEL/ e Resumos/ sao somente leitura pelo app
 *  - nenhum caminho pode escapar da raiz do vault
 */

/**
 * Escrita: `Notes/` inteiro, MENOS `Notes/INATEL/`.
 *
 * O `Notes/` e seu — nota, rascunho, anexo, pasta nova que voce inventar. O
 * INATEL e o material do professor: e a fonte que o ingest le, e uma edicao
 * ali corrompe a origem sem deixar rastro. `Resumos/` continua fora porque
 * pagina gerada se corrige reprocessando, nao editando.
 */
const NOTAS = "Notes";
const RESUMOS = "Resumos";
/** Nomes antigos das mesmas pastas. So a migracao e o `isVault` os conhecem. */
const RAW_ANTIGO = "raw";
const WIKI_ANTIGO = "wiki";
const SOMENTE_LEITURA = ["Notes/INATEL"];

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
  /** nota crua do aluno em Notes/subjects, se existir */
  rawNote: string | null;
  /** candidatos de material oficial em Notes/INATEL */
  official: string[];
  /** pagina gerada em Resumos/ */
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

/** As pastas que trocaram de nome, na ordem em que a migracao as tenta. */
const RENOMEADAS: { antigo: string; novo: string }[] = [
  { antigo: RAW_ANTIGO, novo: NOTAS },
  { antigo: WIKI_ANTIGO, novo: RESUMOS },
];

/**
 * Poe o vault do disco nos nomes de pasta de hoje: `raw/` -> `Notes/` e
 * `wiki/` -> `Resumos/`.
 *
 * As pastas trocaram de nome, mas o vault que esta no disco pode ser mais
 * velho que o app. Sem esta migracao, abrir um vault antigo mostraria a arvore
 * VAZIA — tudo daqui para frente (arvore, busca, escrita, publish) procura
 * `Notes/` e `Resumos/`, enquanto o conteudo continuaria ao lado, em pastas
 * que a interface nem exibe. O usuario nao teria pista nenhuma do motivo.
 *
 * Devolve so o que renomeou de fato (`"raw/ -> Notes/"`), para quem chamou
 * poder contar na tela. Cada pasta e independente: uma falhar nao impede a
 * outra.
 *
 * NAO MESCLA. Com as duas existindo e a nova tendo conteudo, escolher qual
 * copia de cada arquivo vale seria adivinhacao, e adivinhar errado aqui apaga
 * texto do aluno — esse caso fica para o usuario resolver a mao. A excecao e a
 * nova estar VAZIA: isso acontece quando alguem (ou alguma ferramenta) criou a
 * pasta antes da migracao rodar, e recusar por causa de uma pasta sem nada
 * dentro prenderia o vault no nome antigo para sempre, sem pista do motivo.
 *
 * Falha de I/O so faz a pasta ficar de fora da lista: com ela segurada pelo
 * OneDrive ou aberta no Explorer o rename levanta EPERM/EBUSY, e derrubar a
 * abertura do app por causa disso seria pior do que seguir com a arvore como
 * estiver.
 */
export function migrarNomesAntigos(vaultRoot: string): string[] {
  const feitas: string[] = [];
  for (const { antigo, novo } of RENOMEADAS) {
    const de = path.join(vaultRoot, antigo);
    const para = path.join(vaultRoot, novo);
    try {
      if (!fsSync.existsSync(de)) continue;
      if (fsSync.existsSync(para)) {
        if (fsSync.readdirSync(para).length > 0) continue;
        fsSync.rmdirSync(para);
      }
      fsSync.renameSync(de, para);
      feitas.push(`${antigo}/ -> ${novo}/`);
    } catch {
      /* pasta em uso ou permissao negada: segue com o nome antigo */
    }
  }
  return feitas;
}

export class Vault {
  constructor(public readonly root: string) {}

  static isVault(dir: string): boolean {
    if (!fsSync.existsSync(path.join(dir, "CLAUDE.md"))) return false;
    // Os nomes ANTIGOS tambem valem: um vault que ainda nao migrou continua
    // sendo um vault, e recusa-lo aqui impediria o app de abri-lo — entao
    // `migrarNomesAntigos`, que roda no attachVault, nunca chegaria a rodar.
    return [NOTAS, RESUMOS, RAW_ANTIGO, WIKI_ANTIGO].some((nome) =>
      fsSync.existsSync(path.join(dir, nome)),
    );
  }

  /**
   * Bytes ocupados pelo vault.
   *
   * Ignora `node_modules` e `.git`: eles sao do athena-web e do controle de
   * versao, nao do conteudo, e sozinhos passariam de tudo que a pessoa
   * escreveu — a barra mostraria o peso da ferramenta, nao do estudo.
   */
  async tamanho(): Promise<number> {
    const PULAR = new Set(["node_modules", ".git", ".next", "dist", "release"]);
    let total = 0;
    const andar = async (dir: string) => {
      let itens: fsSync.Dirent[];
      try {
        itens = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const it of itens) {
        if (PULAR.has(it.name)) continue;
        const p = path.join(dir, it.name);
        if (it.isDirectory()) await andar(p);
        else if (it.isFile()) {
          try {
            total += (await fs.stat(p)).size;
          } catch {
            /* arquivo sumiu no meio da varredura — nao e erro */
          }
        }
      }
    };
    await andar(this.root);
    return total;
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
    if (norm !== NOTAS && !norm.startsWith(NOTAS + "/")) return false;
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
        `Escrita bloqueada em "${rel}". O app escreve em Notes/, menos Notes/INATEL/ ` +
          `(material do professor). Pagina de Resumos/ nasce do ingest.`,
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

  /** Materias deduzidas das pastas de Notes/subjects (padrao CODIGO-Nome). */
  async subjects(): Promise<SubjectRef[]> {
    const abs = this.resolve("Notes/subjects");
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

    const subjFolder = await this.findFolder("Notes/subjects", code);
    const inatelFolder = await this.findFolder("Notes/INATEL", code);
    const wikiFolder = await this.findFolder("Resumos/subjects", code);
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
      if (await this.exists(page)) t.wikiPage = page;

      /**
       * O review mora em `Resumos/reviews/<MATERIA>/`, nao mais ao lado da aula.
       *
       * O lugar antigo continua sendo procurado: vault que ainda nao passou
       * pela mudanca tem review dentro da pasta da materia, e `athena delete`
       * precisa achar o arquivo para remover — nao achar significaria deixar
       * um review orfao apontando para uma aula que nao existe mais.
       */
      const materia = wikiFolder.split("/").pop() ?? "";
      const novo = path.posix.join("Resumos/reviews", materia, `${lesson}-review.md`);
      const antigo = path.posix.join(wikiFolder, `${lesson}-review.md`);
      if (await this.exists(novo)) t.wikiReview = novo;
      else if (await this.exists(antigo)) t.wikiReview = antigo;
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
  // Todas passam por isWritable(): a arvore mostra `Notes/INATEL` e `Resumos/`,
  // e um menu de contexto que apagasse qualquer no seria a maneira mais
  // rapida de perder o material do professor ou uma pagina gerada.
  // ------------------------------------------------------------------

  private assertWritable(rel: string, acao: string) {
    if (!this.isWritable(rel)) {
      throw new Error(
        `${acao} bloqueado em "${rel}". O app mexe em Notes/, menos Notes/INATEL/ ` +
          `(material do professor). Resumos/ e somente leitura.`,
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

  /**
   * Move arquivo ou pasta para dentro de outra pasta (drag-and-drop no explorer).
   *
   * Reusa `assertWritable` nos dois lados — origem e destino tem que estar em
   * area gravavel (Notes/, menos Notes/INATEL), do contrario dava para "mover"
   * material do professor pra fora do lugar dele, ou depositar coisa dentro
   * da wiki gerada. `resolve()` garante que nenhum dos dois escapa da raiz.
   */
  async mover(relOrigem: string, relPastaDestino: string): Promise<string> {
    this.assertWritable(relOrigem, "Mover");
    this.assertWritable(relPastaDestino, "Mover");

    const origemAbs = this.resolve(relOrigem);
    const destinoDirAbs = this.resolve(relPastaDestino);

    if (!fsSync.existsSync(destinoDirAbs) || !fsSync.statSync(destinoDirAbs).isDirectory()) {
      throw new Error(`Destino nao e uma pasta: ${relPastaDestino}`);
    }
    if (!fsSync.existsSync(origemAbs)) {
      throw new Error(`Nao encontrado: ${relOrigem}`);
    }

    // Soltar uma pasta dentro dela mesma (ou de uma subpasta sua) o SO ate
    // aceita, mas o resultado e a pasta sumir de onde estava sem aparecer em
    // lugar nenhum — bloqueia antes de chegar la.
    const origemComBarra = origemAbs + path.sep;
    if (destinoDirAbs === origemAbs || destinoDirAbs.startsWith(origemComBarra)) {
      throw new Error("Nao e possivel mover uma pasta para dentro dela mesma.");
    }

    const nome = path.posix.basename(relOrigem);
    const destino = path.posix.join(relPastaDestino, nome);
    const destinoAbs = this.resolve(destino);

    // Mesma pasta de origem: nao e erro, mas tambem nao ha o que fazer.
    if (destinoAbs === origemAbs) return relOrigem;

    if (fsSync.existsSync(destinoAbs)) {
      throw new Error(`Ja existe "${nome}" em ${relPastaDestino}.`);
    }

    await fs.rename(origemAbs, destinoAbs);
    return destino;
  }

  /**
   * Apagar vale numa area maior que escrever.
   *
   * `Resumos/` e somente leitura para o app porque quem escreve la e o ingest, e
   * uma edicao manual seria desfeita no proximo `athena generate`. APAGAR e
   * outra coisa: e a unica forma de tirar do disco uma pagina que nao deveria
   * existir (duplicata, materia que acabou), e proibir isso obrigava a abrir o
   * Explorer do Windows por fora do app.
   *
   * O risco de apagar aqui e diferente do de escrever, e menor: vai para a
   * lixeira do sistema (da para restaurar) e o banco continua com a pagina —
   * o proximo pull a traz de volta se voce nao publicar depois. `Notes/INATEL`
   * fica de fora porque la mora o material do professor, que o app so le.
   */
  isDeletable(rel: string): boolean {
    const norm = rel.split(path.sep).join("/").replace(/^\/+/, "");
    if (!norm) return false;
    if (norm === RESUMOS || norm.startsWith(RESUMOS + "/")) return true;
    return this.isWritable(norm);
  }

  /** Caminho absoluto para a lixeira do sistema (quem chama e o main). */
  trashTarget(rel: string): string {
    if (!this.isDeletable(rel)) {
      throw new Error(`Apagar nao e permitido em ${rel}.`);
    }
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
    const base = "Resumos/subjects";
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

    for (const materia of await this.listDir("Resumos/subjects")) {
      const dirRel = path.posix.join("Resumos/subjects", materia);
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
    for (const materia of await this.listDir("Notes/subjects")) {
      const arquivos = await this.listDir(path.posix.join("Notes/subjects", materia));
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
   * Caminho da pagina de um `[[wikilink]]`. Procura em Resumos/subjects/*.
   * Devolve null quando o link aponta para aula que nao existe — link orfao
   * e caso comum e nao pode virar erro na tela.
   */
  async resolveLink(slug: string): Promise<string | null> {
    const alvo = slug.trim().replace(/\.md$/i, "");
    for (const materia of await this.listDir("Resumos/subjects")) {
      const dir = path.posix.join("Resumos/subjects", materia);
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
        // A pasta pode ser o proprio arquivo (Notes/Ideias/Athena.md).
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
    await visitar("Resumos/subjects");
    await visitar("Notes/subjects");
    await visitar("Notes");
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
