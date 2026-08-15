import { contextBridge, ipcRenderer } from "electron";

/**
 * Unica superficie que o renderer enxerga. Sem fs, sem child_process,
 * sem require — contextIsolation ligado e nodeIntegration desligado.
 */
const api = {
  vault: {
    get: () => ipcRenderer.invoke("vault:get"),
    pick: () => ipcRenderer.invoke("vault:pick"),
    onChange: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("vault:changed", handler);
      return () => ipcRenderer.removeListener("vault:changed", handler);
    },
  },
  config: {
    setClaudeBin: (bin: string) => ipcRenderer.invoke("config:setClaudeBin", bin),
  },
  fs: {
    tree: (scope: "raw" | "wiki") => ipcRenderer.invoke("fs:tree", scope),
    read: (rel: string) => ipcRenderer.invoke("fs:read", rel),
    write: (rel: string, content: string) =>
      ipcRenderer.invoke("fs:write", rel, content),
    subjects: () => ipcRenderer.invoke("fs:subjects"),
    describe: (code: string, lesson: string | null) =>
      ipcRenderer.invoke("fs:describe", code, lesson),
    slug: (input: string) => ipcRenderer.invoke("fs:slug", input),
    reveal: (rel: string) => ipcRenderer.invoke("fs:reveal", rel),
    mkdir: (rel: string) => ipcRenderer.invoke("fs:mkdir", rel),
    create: (rel: string, content = "") => ipcRenderer.invoke("fs:create", rel, content),
    rename: (rel: string, nome: string) => ipcRenderer.invoke("fs:rename", rel, nome),
    trash: (rel: string) => ipcRenderer.invoke("fs:trash", rel),
    openExternal: (rel: string) => ipcRenderer.invoke("fs:openExternal", rel),
    pasteImage: (base: string, ext: string, data: Uint8Array) =>
      ipcRenderer.invoke("fs:pasteImage", base, ext, data),
    lessons: () => ipcRenderer.invoke("fs:lessons"),
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
  },
  publish: {
    run: (name: "publish" | "pull", flags: string[] = []) =>
      ipcRenderer.invoke("publish:run", name, flags),
    available: () => ipcRenderer.invoke("publish:available"),
    autoPublish: (on?: boolean) => ipcRenderer.invoke("config:autoPublish", on),
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
  },
};

contextBridge.exposeInMainWorld("athena", api);

export type AthenaApi = typeof api;
