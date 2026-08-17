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
  rawNote: string | null;
  official: string[];
  wikiPage: string | null;
  wikiReview: string | null;
  material: string | null;
  mirror: string | null;
  mirrorReview: string | null;
  moc: string | null;
};

export type Cmd = "ingest" | "redo" | "review" | "delete";
export type SessionState = "queued" | "running" | "awaiting" | "done" | "failed";
export type Job = { id: string; cmd: Cmd; code: string; lesson: string | null; label: string };

export type SessionEvent =
  | { id: string; kind: "state"; state: SessionState; cmd?: Cmd }
  | { id: string; kind: "log"; level: "info" | "tool" | "error"; text: string; n?: number }
  | { id: string; kind: "assistant"; text: string; n?: number }
  | { id: string; kind: "queue"; jobs: Job[] }
  | { id: string; kind: "auth"; text: string };

/** `n` vem do main e e monotonico — usado para casar snapshot e evento vivo. */
export type Line = {
  n: number;
  level: "info" | "tool" | "error" | "assistant";
  text: string;
};

/** Estado da sessao guardado no main — o painel se reconstitui com isto. */
export type Snapshot = {
  state: SessionState | null;
  lines: Line[];
  queue: Job[];
  authNeeded: boolean;
};

export type IngestStatus = "OK" | "FAIL" | "NONE";

/** Retrato do vault para a home — vem do disco, nao do banco. */
export type HomeData = {
  subjects: { code: string; slug: string; nome: string; paginas: number; rel: string }[];
  paginas: { slug: string; subject: string; titulo: string; rel: string; updated: string }[];
  notas: number;
  eventos: { data: string; texto: string; slug: string | null; removido: boolean }[];
  logConflitado: boolean;
};

export type Account = {
  id: string;
  name: string;
  email: string;
  /** URL pública do avatar em `profiles.avatar_url`, ou null. */
  avatarUrl: string | null;
  /** Entrou pelo cache porque a rede falhou: publish e pull ficam bloqueados. */
  offline?: boolean;
  /**
   * E-mail da ultima conta que assumiu este vault, quando nao e a atual.
   * Presente = os arquivos do disco vieram de outra conta, e publicar agora
   * mandaria o conteudo dela para esta. Ver comDono() no main.
   */
  contaAnterior?: string;
};

/**
 * Conta do Claude Code desta MAQUINA — independente da conta do Athena.
 * `arquivo` vem sempre, para a tela poder dizer onde olhar quando o formato
 * do Claude Code mudar e o e-mail vier nulo.
 */
export type ClaudeConta = {
  email: string | null;
  org: string | null;
  arquivo: string;
  existe: boolean;
};

/** Um termo do glossário, com as aulas em que aparece. */
export type TermoGlossario = {
  termo: string;
  contexto: string;
  refs: { titulo: string; rel: string }[];
  /** Matéria da página onde o termo apareceu primeiro (ver electron/biblioteca.ts). */
  categoria: string;
};

/** Preferências de exibição do app — persistem no athena-app.json (ver electron/prefs.ts). */
export type Prefs = {
  formatoData: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";
  formatoHora: "24h" | "12h";
  iniciarComSistema: boolean;
  densidade: "compacta" | "padrao" | "confortavel";
  tamanhoFonte: 12 | 14 | 16 | 18 | 20;
  quebraLinha: boolean;
  confirmarExcluir: boolean;
};

/** Resultado de `athena publish` / `athena pull` rodados pelo app. */
export type ScriptResult = { ok: boolean; output: string; canForce: boolean };

/**
 * Estado da atualização automática — ver electron/atualizacao.ts.
 *
 * "erro" não chega à interface de propósito: falha de rede aqui não é algo que
 * a pessoa possa resolver, e o updater volta a tentar sozinho.
 */
export type EstadoAtualizacao =
  | { fase: "ocioso" }
  | { fase: "baixando"; pct: number }
  | { fase: "pronta"; versao: string }
  | { fase: "erro"; mensagem: string };

/** Resultado de `vault.baixarTudo()` — ver electron/bootstrap.ts. */
export type ResultadoBootstrap = {
  criados: number;
  iguais: number;
  /** Arquivos que já existiam com conteúdo diferente do banco — não tocados. */
  conflitos: string[];
  /** R2 não estava configurado nesta máquina: PDFs/anexos não foram baixados. */
  semR2: boolean;
};

type AthenaBridge = {
  vault: {
    get(): Promise<{ path: string | null; claudeBin: string }>;
    pick(): Promise<{ path: string | null }>;
    /** Bytes ocupados, sem node_modules nem .git. */
    tamanho(): Promise<number>;
    onChange(cb: () => void): () => void;
    /** Zip do vault inteiro. Devolve o caminho salvo, ou null se cancelou. */
    exportar(): Promise<string | null>;
    /** Escolhe pasta para um vault NOVO — não exige CLAUDE.md/raw/ como pick(). Null se cancelou. */
    escolherPastaNova(): Promise<string | null>;
    /** Cria a estrutura mínima numa pasta vazia e a torna o vault ativo. */
    criarNovo(pasta: string): Promise<{ path: string }>;
    /** `athena pull` sem terminal: subjects/pages/notes do Supabase + material do R2. */
    /** Cria o vault desta conta dentro dos dados do app, sem perguntar pasta. */
    criarInterno(): Promise<{ path: string }>;
    baixarTudo(): Promise<ResultadoBootstrap>;
    /** Progresso linha a linha de baixarTudo(), enquanto ele roda. */
    onLinhaBootstrap(cb: (linha: string) => void): () => void;
  };
  app: {
    versao(): Promise<string>;
    atualizacao(): Promise<EstadoAtualizacao>;
    /** Fecha e instala. Recusa com o Claude Code rodando. */
    instalarAtualizacao(): Promise<boolean>;
    onAtualizacao(cb: (e: EstadoAtualizacao) => void): () => void;
  };
  config: {
    setClaudeBin(bin: string): Promise<boolean>;
    get(): Promise<Prefs>;
    set(p: Partial<Prefs>): Promise<Prefs>;
  };
  usage: {
    /** Mais recente primeiro, no máximo 20. */
    recentes(): Promise<{ rel: string; em: string }[]>;
    /** Registra visita. `pct` = quanto da página foi rolada (0..100). */
    visitar(rel: string, pct?: number): Promise<boolean>;
    /** Para o card "Continue de onde parou". null se nunca leu nada. */
    ultimaLeitura(): Promise<{
      rel: string;
      titulo: string;
      materia: string;
      em: string;
      pct: number;
    } | null>;
    /** Termos do glossário marcados (bookmark). */
    termos(): Promise<string[]>;
    /** Devolve o estado NOVO: true = virou marcado. */
    alternarTermo(termo: string): Promise<boolean>;
    /** Páginas da wiki que ainda não têm `-review.md` ao lado. */
    revisao(): Promise<
      { rel: string; titulo: string; materia: string; geradaEm: string }[]
    >;
  };
  /** A moldura da janela e desenhada pelo app — ver TitleBar.tsx. */
  win: {
    close(): Promise<boolean>;
    minimize(): Promise<boolean>;
    /** Devolve o estado NOVO: true = maximizada. */
    toggleMaximize(): Promise<boolean>;
    isMaximized(): Promise<boolean>;
    /** Abre uma janela nova ja com esta aba dentro. */
    destacar(aba: unknown, x?: number, y?: number): Promise<boolean>;
    /** Tambem dispara quando o snap do Windows maximiza por fora do app. */
    onMaximized(cb: (maximizada: boolean) => void): () => void;
  };
  fs: {
    tree(scope: "raw" | "wiki"): Promise<TreeNode[]>;
    read(rel: string): Promise<string>;
    write(rel: string, content: string): Promise<void>;
    subjects(): Promise<SubjectRef[]>;
    describe(code: string, lesson: string | null): Promise<Target>;
    slug(input: string): Promise<string>;
    reveal(rel: string): Promise<void>;
    mkdir(rel: string): Promise<void>;
    create(rel: string, content?: string): Promise<void>;
    rename(rel: string, nome: string): Promise<string>;
    /** Move arquivo/pasta para dentro de outra pasta (drag-and-drop). Devolve o novo rel. */
    mover(relOrigem: string, relPastaDestino: string): Promise<string>;
    trash(rel: string): Promise<boolean>;
    openExternal(rel: string): Promise<boolean>;
    pasteImage(base: string, ext: string, data: Uint8Array): Promise<string>;
    lessons(): Promise<{ slug: string; subject: string }[]>;
    home(): Promise<HomeData>;
    resolveLink(slug: string): Promise<string | null>;
    openUrl(url: string): Promise<boolean>;
    glossario(): Promise<TermoGlossario[]>;
    /** Busca dentro dos arquivos: uma linha por arquivo que casa. */
    buscar(termo: string): Promise<{ rel: string; linha: number; trecho: string }[]>;
  };
  clipboard: { read(): Promise<string>; write(text: string): Promise<boolean> };
  status: {
    get(): Promise<IngestStatus>;
    onChange(cb: (s: IngestStatus) => void): () => void;
  };
  session: {
    start(cmd: Cmd, code: string, lesson: string | null): Promise<Job>;
    reply(text: string): Promise<void>;
    cancel(): Promise<void>;
    /** Esvazia o transcript no main, nao so na tela. */
    clear(): Promise<boolean>;
    snapshot(): Promise<Snapshot>;
    onEvent(cb: (e: SessionEvent) => void): () => void;
  };
  account: {
    status(): Promise<Account | null>;
    login(email: string, password: string): Promise<Account>;
    logout(): Promise<boolean>;
    signUp(email: string, senha: string, nome: string): Promise<Account | null>;
    oauth(provider: "github" | "google"): Promise<Account>;
    oauthCancel(): Promise<boolean>;
    /** null = a pessoa fechou o seletor de arquivo. */
    avatarPick(): Promise<Account | null>;
    avatarRemove(): Promise<Account>;
    assumirVault(email: string): Promise<boolean>;
    update(campos: { email?: string; password?: string; nome?: string }): Promise<{
      pendente: boolean;
    }>;
  };
  publish: {
    run(name: "publish" | "pull", flags?: string[]): Promise<ScriptResult>;
    available(): Promise<{ publish: boolean; pull: boolean }>;
    autoPublish(on?: boolean): Promise<boolean>;
    autoPull(on?: boolean): Promise<boolean>;
    onLine(cb: (line: string) => void): () => void;
    onState(cb: (s: { running: boolean; name: string }) => void): () => void;
  };
  claude: {
    openLogin(): Promise<boolean>;
    whoami(): Promise<ClaudeConta>;
  };
};

declare global {
  interface Window {
    athena: AthenaBridge;
  }
}

export const api = window.athena;

/**
 * Mensagem de erro pronta para a tela.
 *
 * O Electron embrulha tudo que vem do main em
 * `Error invoking remote method 'account:login': Error: ...`. O nome do canal
 * IPC nao ajuda ninguem — o que importa e a frase depois dele.
 */
export function mensagemDeErro(e: unknown): string {
  const bruto = e instanceof Error ? e.message : String(e);
  return bruto
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^(Error|TypeError):\s*/, "")
    .trim();
}

/** Deduz materia e aula a partir de um caminho da arvore. */
export function parseSelection(rel: string): { code: string; lesson: string | null } | null {
  const parts = rel.split("/");
  const folderIdx = parts.findIndex((p) => /^[A-Z]\d{2}-/.test(p) || /^[A-Z]\d{2}$/.test(p));
  if (folderIdx === -1) return null;
  const code = parts[folderIdx].split("-")[0];
  const file = parts[folderIdx + 1];
  if (!file) return { code, lesson: null };
  const lesson = file
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // O MOC tem o mesmo nome da pasta — nao e aula.
  if (lesson === parts[folderIdx].toLowerCase().replace(/[^a-z0-9]+/g, "-")) {
    return { code, lesson: null };
  }
  return { code, lesson };
}
