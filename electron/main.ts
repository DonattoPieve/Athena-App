import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";
import chokidar, { FSWatcher } from "chokidar";
import { Vault, slugify } from "./vault";
import { ClaudeRunner, Cmd, SessionEvent } from "./claude";
import * as git from "./git";

type Config = { vaultPath?: string; claudeBin?: string };

const CONFIG_FILE = () => path.join(app.getPath("userData"), "athena-app.json");

function readConfig(): Config {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(next: Config) {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  fs.writeFileSync(CONFIG_FILE(), JSON.stringify(next, null, 2), "utf8");
}

let win: BrowserWindow | null = null;
let vault: Vault | null = null;
let runner: ClaudeRunner | null = null;
let watcher: FSWatcher | null = null;
let statusWatcher: FSWatcher | null = null;

function send(channel: string, payload: unknown) {
  win?.webContents.send(channel, payload);
}

/** Le o veredito na raiz e avisa o renderer. Unico caminho de atualizacao. */
async function pushStatus() {
  if (!vault) return;
  send("status:changed", await vault.ingestStatus());
}

function attachVault(root: string) {
  vault = new Vault(root);

  const cfg = readConfig();
  runner?.removeAllListeners();
  runner = new ClaudeRunner(root, cfg.claudeBin || "claude");
  runner.on("event", (e: SessionEvent) => {
    send("session:event", e);
    // Fim de comando: o OK/FAIL acabou de ser escrito. Reler na hora, sem
    // depender do watcher — no OneDrive o evento pode chegar tarde ou nunca.
    if (e.kind === "state" && (e.state === "done" || e.state === "failed")) {
      void pushStatus();
      send("vault:changed", null);
    }
  });

  watcher?.close();
  // OneDrive dispara eventos fantasma; o debounce do awaitWriteFinish
  // evita repintar a arvore no meio de uma escrita.
  watcher = chokidar.watch([path.join(root, "raw"), path.join(root, "wiki")], {
    ignoreInitial: true,
    ignored: /(^|[\/\\])\.|node_modules/,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  });
  let timer: NodeJS.Timeout | null = null;
  watcher.on("all", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => send("vault:changed", null), 250);
  });

  // O .ingest-status vive na RAIZ e comeca com ponto: o watcher da arvore
  // ignora dotfiles e nem olha para fora de raw/ e wiki/. Sem este segundo
  // watcher o OK final do ingest nunca chega na tela, e o painel Publicar
  // fica congelado no FAIL escrito no comeco do comando.
  statusWatcher?.close();
  statusWatcher = chokidar.watch(path.join(root, ".ingest-status"), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  statusWatcher.on("all", () => void pushStatus());
}

function requireVault(): Vault {
  if (!vault) throw new Error("Nenhum vault selecionado.");
  return vault;
}

function requireRunner(): ClaudeRunner {
  if (!runner) throw new Error("Nenhum vault selecionado.");
  return runner;
}

function registerIpc() {
  ipcMain.handle("vault:get", async () => {
    const cfg = readConfig();
    if (cfg.vaultPath && !vault && Vault.isVault(cfg.vaultPath)) {
      attachVault(cfg.vaultPath);
    }
    return { path: vault?.root ?? null, claudeBin: cfg.claudeBin ?? "claude" };
  });

  ipcMain.handle("vault:pick", async () => {
    const res = await dialog.showOpenDialog({
      title: "Selecione a pasta do vault Athena",
      properties: ["openDirectory"],
    });
    if (res.canceled || !res.filePaths[0]) return { path: vault?.root ?? null };
    const chosen = res.filePaths[0];
    if (!Vault.isVault(chosen)) {
      throw new Error(
        "Essa pasta nao parece o vault do Athena — nao encontrei CLAUDE.md e raw/.",
      );
    }
    writeConfig({ ...readConfig(), vaultPath: chosen });
    attachVault(chosen);
    return { path: chosen };
  });

  ipcMain.handle("config:setClaudeBin", async (_e, bin: string) => {
    // Trocar o binario recria o runner: com sessao viva, o processo antigo
    // ficaria orfao escrevendo no vault sem ninguem ouvindo.
    if (runner?.busy) {
      throw new Error(
        "Ha uma sessao em andamento. Espere terminar (ou interrompa) antes de " +
          "trocar o caminho do Claude Code.",
      );
    }
    writeConfig({ ...readConfig(), claudeBin: bin });
    if (vault) attachVault(vault.root);
    return true;
  });

  ipcMain.handle("fs:tree", (_e, scope: string) => requireVault().tree(scope));
  ipcMain.handle("fs:read", (_e, rel: string) => requireVault().read(rel));
  ipcMain.handle("fs:write", (_e, rel: string, content: string) =>
    requireVault().write(rel, content),
  );
  ipcMain.handle("fs:subjects", () => requireVault().subjects());
  ipcMain.handle("fs:describe", (_e, code: string, lesson: string | null) =>
    requireVault().describe(code, lesson),
  );
  ipcMain.handle("fs:slug", (_e, input: string) => slugify(input));
  ipcMain.handle("fs:reveal", (_e, rel: string) => {
    shell.showItemInFolder(requireVault().resolve(rel));
  });

  ipcMain.handle("status:get", () => requireVault().ingestStatus());

  ipcMain.handle(
    "session:start",
    (_e, cmd: Cmd, code: string, lesson: string | null) =>
      requireRunner().enqueue(cmd, code, lesson),
  );
  ipcMain.handle("session:reply", (_e, text: string) => requireRunner().reply(text));
  ipcMain.handle("session:cancel", () => requireRunner().cancel());
  // Painel recem-montado se reconstitui daqui — trocar de aba nao apaga o log.
  ipcMain.handle("session:snapshot", () =>
    runner ? runner.snapshot() : { state: null, lines: [], queue: [] },
  );

  ipcMain.handle("git:summary", () => git.summary(requireVault().root));
  ipcMain.handle("git:publish", (_e, message: string) =>
    git.publish(requireVault().root, message),
  );
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    backgroundColor: "#0A0A0C",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.ATHENA_DEV) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  win.on("closed", () => (win = null));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  watcher?.close();
  statusWatcher?.close();
  if (process.platform !== "darwin") app.quit();
});
