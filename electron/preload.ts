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
  git: {
    summary: () => ipcRenderer.invoke("git:summary"),
    publish: (message: string) => ipcRenderer.invoke("git:publish", message),
  },
};

contextBridge.exposeInMainWorld("athena", api);

export type AthenaApi = typeof api;
