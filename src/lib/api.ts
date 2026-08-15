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

export type Account = { name: string; email: string };

/** Resultado de `athena publish` / `athena pull` rodados pelo app. */
export type ScriptResult = { ok: boolean; output: string; canForce: boolean };

type AthenaBridge = {
  vault: {
    get(): Promise<{ path: string | null; claudeBin: string }>;
    pick(): Promise<{ path: string | null }>;
    onChange(cb: () => void): () => void;
  };
  config: { setClaudeBin(bin: string): Promise<boolean> };
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
    trash(rel: string): Promise<boolean>;
    openExternal(rel: string): Promise<boolean>;
    pasteImage(base: string, ext: string, data: Uint8Array): Promise<string>;
    lessons(): Promise<{ slug: string; subject: string }[]>;
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
    snapshot(): Promise<Snapshot>;
    onEvent(cb: (e: SessionEvent) => void): () => void;
  };
  account: {
    status(): Promise<Account | null>;
    login(email: string, password: string): Promise<Account>;
    logout(): Promise<boolean>;
  };
  publish: {
    run(name: "publish" | "pull", flags?: string[]): Promise<ScriptResult>;
    available(): Promise<{ publish: boolean; pull: boolean }>;
    autoPublish(on?: boolean): Promise<boolean>;
    onLine(cb: (line: string) => void): () => void;
    onState(cb: (s: { running: boolean; name: string }) => void): () => void;
  };
  claude: { openLogin(): Promise<boolean> };
};

declare global {
  interface Window {
    athena: AthenaBridge;
  }
}

export const api = window.athena;

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
