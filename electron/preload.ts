import { contextBridge, ipcRenderer, webUtils } from "electron";

/**
 * Unica superficie que o renderer enxerga. Sem fs, sem child_process,
 * sem require — contextIsolation ligado e nodeIntegration desligado.
 */
const api = {
  vault: {
    get: () => ipcRenderer.invoke("vault:get"),
    pick: () => ipcRenderer.invoke("vault:pick"),
    tamanho: () => ipcRenderer.invoke("vault:tamanho"),
    onChange: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("vault:changed", handler);
      return () => ipcRenderer.removeListener("vault:changed", handler);
    },
    exportar: () => ipcRenderer.invoke("vault:exportar"),
    // Primeiro uso — ver electron/bootstrap.ts e src/components/PrimeiroUso.tsx.
    escolherPastaNova: () => ipcRenderer.invoke("vault:escolherPastaNova"),
    criarNovo: (pasta: string) => ipcRenderer.invoke("vault:criarNovo", pasta),
    criarInterno: () => ipcRenderer.invoke("vault:criarInterno"),
    baixarTudo: () => ipcRenderer.invoke("vault:baixarTudo"),
    onLinhaBootstrap: (cb: (linha: string) => void) => {
      const handler = (_: unknown, linha: string) => cb(linha);
      ipcRenderer.on("bootstrap:linha", handler);
      return () => ipcRenderer.removeListener("bootstrap:linha", handler);
    },
  },
  app: {
    versao: () => ipcRenderer.invoke("app:versao"),
    atualizacao: () => ipcRenderer.invoke("app:atualizacao"),
    procurarAtualizacao: () => ipcRenderer.invoke("app:procurarAtualizacao"),
    instalarAtualizacao: () => ipcRenderer.invoke("app:instalarAtualizacao"),
    onAtualizacao: (cb: (e: unknown) => void) => {
      const handler = (_: unknown, e: unknown) => cb(e);
      ipcRenderer.on("app:atualizacao", handler);
      return () => ipcRenderer.removeListener("app:atualizacao", handler);
    },
  },
  config: {
    setClaudeBin: (bin: string) => ipcRenderer.invoke("config:setClaudeBin", bin),
    get: () => ipcRenderer.invoke("config:getPrefs"),
    set: (p: Record<string, unknown>) => ipcRenderer.invoke("config:setPrefs", p),
  },
  usage: {
    recentes: () => ipcRenderer.invoke("usage:recentes"),
    visitar: (rel: string, pct?: number) => ipcRenderer.invoke("usage:visitar", rel, pct),
    ultimaLeitura: () => ipcRenderer.invoke("usage:ultimaLeitura"),
    termos: () => ipcRenderer.invoke("usage:termos"),
    alternarTermo: (termo: string) => ipcRenderer.invoke("usage:alternarTermo", termo),
    revisao: () => ipcRenderer.invoke("usage:revisao"),
  },
  win: {
    close: () => ipcRenderer.invoke("win:close"),
    minimize: () => ipcRenderer.invoke("win:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("win:toggleMaximize"),
    isMaximized: () => ipcRenderer.invoke("win:isMaximized"),
    destacar: (aba: unknown, x?: number, y?: number) =>
      ipcRenderer.invoke("win:destacar", aba, x, y),
    onMaximized: (cb: (m: boolean) => void) => {
      const handler = (_: unknown, m: boolean) => cb(m);
      ipcRenderer.on("win:maximized", handler);
      return () => ipcRenderer.removeListener("win:maximized", handler);
    },
  },
  fs: {
    tree: (scope: "Notes" | "Resumos") => ipcRenderer.invoke("fs:tree", scope),
    read: (rel: string) => ipcRenderer.invoke("fs:read", rel),
    write: (rel: string, content: string) =>
      ipcRenderer.invoke("fs:write", rel, content),
    subjects: () => ipcRenderer.invoke("fs:subjects"),
    materialDaPagina: (relPagina: string, source: string | null, sourceHref: string | null) =>
      ipcRenderer.invoke("fs:materialDaPagina", relPagina, source, sourceHref),
    describe: (code: string, lesson: string | null) =>
      ipcRenderer.invoke("fs:describe", code, lesson),
    slug: (input: string) => ipcRenderer.invoke("fs:slug", input),
    reveal: (rel: string) => ipcRenderer.invoke("fs:reveal", rel),
    mkdir: (rel: string) => ipcRenderer.invoke("fs:mkdir", rel),
    create: (rel: string, content = "") => ipcRenderer.invoke("fs:create", rel, content),
    rename: (rel: string, nome: string) => ipcRenderer.invoke("fs:rename", rel, nome),
    mover: (relOrigem: string, relPastaDestino: string) =>
      ipcRenderer.invoke("fs:mover", relOrigem, relPastaDestino),
    importar: (relPastaDestino: string, origens: string[]) =>
      ipcRenderer.invoke("fs:importar", relPastaDestino, origens),
    /** Progresso da copia em andamento; `null` quando acaba (ver fs:importar). */
    onImportacao: (cb: (p: { feitos: number; total: number; nome: string } | null) => void) => {
      const handler = (_: unknown, p: { feitos: number; total: number; nome: string } | null) =>
        cb(p);
      ipcRenderer.on("fs:importando", handler);
      return () => ipcRenderer.removeListener("fs:importando", handler);
    },
    /**
     * Caminho real de um `File` solto na janela.
     *
     * O `File` do navegador esconde o caminho de proposito; no Electron o
     * `webUtils.getPathForFile` e a forma suportada de recupera-lo (o antigo
     * `file.path` foi removido). Sem isto o arrastar de fora nao teria como
     * dizer ao main O QUE copiar.
     */
    caminhoDoArquivo: (f: File): string => {
      try {
        return webUtils.getPathForFile(f);
      } catch {
        return (f as File & { path?: string }).path ?? "";
      }
    },
    trash: (rel: string, naNuvem = false) => ipcRenderer.invoke("fs:trash", rel, naNuvem),
    openExternal: (rel: string) => ipcRenderer.invoke("fs:openExternal", rel),
    pasteImage: (base: string, ext: string, data: Uint8Array) =>
      ipcRenderer.invoke("fs:pasteImage", base, ext, data),
    lessons: () => ipcRenderer.invoke("fs:lessons"),
    home: () => ipcRenderer.invoke("fs:home"),
    resolveLink: (slug: string) => ipcRenderer.invoke("fs:resolveLink", slug),
    openUrl: (url: string) => ipcRenderer.invoke("fs:openUrl", url),
    glossario: () => ipcRenderer.invoke("fs:glossario"),
    buscar: (termo: string) => ipcRenderer.invoke("fs:buscar", termo),
  },
  clipboard: {
    read: () => ipcRenderer.invoke("clipboard:read"),
    write: (text: string) => ipcRenderer.invoke("clipboard:write", text),
  },
  status: {
    get: () => ipcRenderer.invoke("status:get"),
    onChange: (cb: (s: "OK" | "FAIL" | "NONE") => void) => {
      const handler = (_: unknown, s: "OK" | "FAIL" | "NONE") => cb(s);
      ipcRenderer.on("status:changed", handler);
      return () => ipcRenderer.removeListener("status:changed", handler);
    },
  },
  session: {
    start: (cmd: string, code: string, lesson: string | null) =>
      ipcRenderer.invoke("session:start", cmd, code, lesson),
    reply: (text: string) => ipcRenderer.invoke("session:reply", text),
    cancel: () => ipcRenderer.invoke("session:cancel"),
    clear: () => ipcRenderer.invoke("session:clear"),
    snapshot: () => ipcRenderer.invoke("session:snapshot"),
    onEvent: (cb: (e: any) => void) => {
      const handler = (_: unknown, e: any) => cb(e);
      ipcRenderer.on("session:event", handler);
      return () => ipcRenderer.removeListener("session:event", handler);
    },
  },
  account: {
    status: () => ipcRenderer.invoke("account:status"),
    login: (email: string, password: string) =>
      ipcRenderer.invoke("account:login", email, password),
    logout: () => ipcRenderer.invoke("account:logout"),
    signUp: (email: string, senha: string, nome: string) =>
      ipcRenderer.invoke("account:signUp", email, senha, nome),
    oauth: (provider: "github" | "google") => ipcRenderer.invoke("account:oauth", provider),
    oauthCancel: () => ipcRenderer.invoke("account:oauthCancel"),
    avatarPick: () => ipcRenderer.invoke("account:avatarPick"),
    avatarRemove: () => ipcRenderer.invoke("account:avatarRemove"),
    assumirVault: (email: string) => ipcRenderer.invoke("account:assumirVault", email),
    update: (campos: { email?: string; password?: string; nome?: string }) =>
      ipcRenderer.invoke("account:update", campos),
  },
  publish: {
    run: (name: "publish" | "pull", flags: string[] = []) =>
      ipcRenderer.invoke("publish:run", name, flags),
    available: () => ipcRenderer.invoke("publish:available"),
    autoPublish: (on?: boolean) => ipcRenderer.invoke("config:autoPublish", on),
    autoPull: (on?: boolean) => ipcRenderer.invoke("config:autoPull", on),
    onLine: (cb: (line: string) => void) => {
      const handler = (_: unknown, line: string) => cb(line);
      ipcRenderer.on("publish:line", handler);
      return () => ipcRenderer.removeListener("publish:line", handler);
    },
    onState: (cb: (s: { running: boolean; name: string }) => void) => {
      const handler = (_: unknown, s: { running: boolean; name: string }) => cb(s);
      ipcRenderer.on("publish:state", handler);
      return () => ipcRenderer.removeListener("publish:state", handler);
    },
  },
  claude: {
    openLogin: () => ipcRenderer.invoke("claude:openLogin"),
    whoami: () => ipcRenderer.invoke("claude:whoami"),
  },
};

contextBridge.exposeInMainWorld("athena", api);

export type AthenaApi = typeof api;
