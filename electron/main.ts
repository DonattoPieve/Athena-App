import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
} from "electron";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import chokidar, { FSWatcher } from "chokidar";
import { Vault, slugify } from "./vault";
import { ClaudeRunner, Cmd, SessionEvent } from "./claude";
import * as account from "./account";
import * as publish from "./publish";
import * as biblioteca from "./biblioteca";

type Config = {
  vaultPath?: string;
  claudeBin?: string;
  /** Publicar sozinho quando o comando termina com OK — igual ao athena.bat. */
  autoPublish?: boolean;
  /** Puxar do banco uma vez na abertura do app. */
  autoPull?: boolean;
  /** Ultima conta que assumiu cada vault: caminho -> e-mail. Ver comDono(). */
  donos?: Record<string, string>;
};

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
      void afterJob(e.state, e.cmd);
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

/** Roda o publish/pull do vault jogando a saida no transcript da sessao. */
async function runScript(name: publish.ScriptName, flags: string[]) {
  const root = requireVault().root;
  const r = runner;
  send("publish:state", { running: true, name });
  try {
    const res = await publish.run(root, name, flags, (line) => {
      r?.log(line);
      send("publish:line", line);
    });
    send("vault:changed", null);
    return {
      ok: res.code === 0,
      output: res.output,
      canForce: publish.suggestsForce(name, res.output),
    };
  } catch (e) {
    const msg = (e as Error).message;
    r?.log(msg, "error");
    return { ok: false, output: msg, canForce: false };
  } finally {
    send("publish:state", { running: false, name });
  }
}

/**
 * Passo [2/2] do athena.bat: com OK no .ingest-status, o conteudo vai pro
 * banco na mesma operacao. Gerar arquivo e publicar sempre foram um gesto so —
 * separar os dois e como o site fica velho sem ninguem perceber.
 *
 * `delete` publica com --force de proposito: remover paginas e exatamente a
 * desproporcao que a guarda do publish existe para barrar, e aqui ela foi pedida.
 */
async function afterJob(state: "done" | "failed", cmd?: Cmd) {
  if (state !== "done") return;
  if (readConfig().autoPublish === false) return;
  if (!vault) return;

  const status = await vault.ingestStatus();
  if (status !== "OK") {
    runner?.log(
      `Comando terminou sem OK no .ingest-status (${status}) — nada foi publicado.`,
      "error",
    );
    return;
  }
  runner?.log("[2/2] Publicando no Supabase...");
  const res = await runScript("publish", cmd === "delete" ? ["--force"] : []);
  runner?.log(
    res.ok
      ? "Publicado. O conteudo ja esta no ar."
      : "A publicacao falhou — os arquivos no disco estao intactos. Corrija e use Publicar.",
    res.ok ? "info" : "error",
  );
}

/**
 * Puxa do banco UMA VEZ, na abertura.
 *
 * Com o conteudo fora do git, as duas copias sao este disco e o banco — e a
 * segunda maquina comeca desatualizada. Puxar na abertura e o que evita
 * publicar por cima do trabalho feito na outra maquina.
 *
 * Na abertura, e nao a cada login, de proposito: `pull` mexe em arquivo, e
 * fazer isso com uma nota aberta e editada trocaria o chao debaixo do editor.
 * Aqui ainda nao ha nada aberto.
 *
 * Sem --force, o pull nunca sobrescreve nem apaga: so cria o que falta e
 * avisa o que diverge. E por isso que da para rodar sozinho.
 */
let jaPuxou = false;
async function pullInicial() {
  if (jaPuxou || !vault) return;
  jaPuxou = true;

  if (readConfig().autoPull === false) return;
  if (runner?.busy) return; // nunca mexer em arquivo no meio de um ingest
  if (!account.hasSession(vault.root)) return; // sem conta nao ha o que puxar
  if (!publish.scriptExists(vault.root, "pull")) return;

  runner?.log("Puxando do banco (abertura do app)...");
  const res = await runScript("pull", []);
  if (!res.ok) runner?.log("O pull da abertura falhou — o disco esta intacto.", "error");
}

/**
 * De quem sao os arquivos deste vault?
 *
 * A conta e a pasta sao coisas independentes: entrar com outro e-mail nao troca
 * um arquivo de lugar. O estrago aparece depois — `publish` manda o conteudo
 * que esta no disco para a conta que estiver logada agora. Ja aconteceu aqui:
 * login como uma conta nova, vault cheio do conteudo de outra.
 *
 * Entao o app anota, por pasta, qual foi a ultima conta que a assumiu, e avisa
 * quando muda. So anota sozinho quando ainda nao havia anotacao — trocar por
 * conta propria seria justamente perder o aviso.
 */
function comDono<T extends { email: string } | null>(conta: T): T {
  if (!conta || !vault) return conta;
  const cfg = readConfig();
  const anterior = cfg.donos?.[vault.root];
  if (!anterior) {
    writeConfig({ ...cfg, donos: { ...(cfg.donos ?? {}), [vault.root]: conta.email } });
    return conta;
  }
  if (anterior === conta.email) return conta;
  return { ...conta, contaAnterior: anterior };
}

/**
 * Qual conta do Claude Code este computador esta usando.
 *
 * A conta do Claude nao tem nada a ver com a do Athena: ela e da MAQUINA, e o
 * app so herda quem ja estava logado quando o `claude` sobe. Ate agora nao
 * havia jeito de saber qual era sem abrir um terminal e digitar `/status` —
 * entao "de quem sao os creditos que este ingest gastou" era um chute.
 *
 * O arquivo e do Claude Code, nao nosso: o formato pode mudar sem aviso. Por
 * isso a leitura e defensiva (varre o JSON atras de um e-mail em vez de exigir
 * um caminho fixo) e a resposta sempre devolve `arquivo`, para a tela poder
 * mandar a pessoa conferir no `/status` quando nao achar nada.
 */
type ClaudeConta = { email: string | null; org: string | null; arquivo: string; existe: boolean };

function claudeConta(): ClaudeConta {
  const home = app.getPath("home");
  const cfg = process.env.CLAUDE_CONFIG_DIR;
  const candidatos = [
    ...(cfg ? [path.join(cfg, ".claude.json"), path.join(cfg, "claude.json")] : []),
    path.join(home, ".claude.json"),
    path.join(home, ".claude", ".claude.json"),
  ];
  const arquivo = candidatos.find((p) => fs.existsSync(p)) ?? candidatos[candidatos.length - 2];
  if (!fs.existsSync(arquivo)) return { email: null, org: null, arquivo, existe: false };

  try {
    const dados = JSON.parse(fs.readFileSync(arquivo, "utf8")) as unknown;
    let email: string | null = null;
    let org: string | null = null;
    // Busca em largura, com teto: o arquivo guarda historico de projeto e
    // pode ser grande — nao vale a pena descer nele inteiro.
    const fila: unknown[] = [dados];
    for (let i = 0; i < 400 && fila.length; i++) {
      const no = fila.shift();
      if (!no || typeof no !== "object") continue;
      for (const [k, v] of Object.entries(no as Record<string, unknown>)) {
        if (typeof v === "string") {
          if (!email && /^email(address)?$/i.test(k) && v.includes("@")) email = v;
          if (!org && /^organization(name)?$/i.test(k)) org = v;
        } else if (v && typeof v === "object") {
          fila.push(v);
        }
      }
      if (email && org) break;
    }
    return { email, org, arquivo, existe: true };
  } catch {
    return { email: null, org: null, arquivo, existe: true };
  }
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
    // Nao bloqueia a abertura da janela: a arvore aparece e o pull acontece
    // atras, com a saida no painel da sessao.
    if (vault) void pullInicial();
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

  // ---- operacoes do explorer ----
  ipcMain.handle("fs:mkdir", (_e, rel: string) => requireVault().mkdir(rel));
  ipcMain.handle("fs:create", (_e, rel: string, content: string) =>
    requireVault().create(rel, content),
  );
  ipcMain.handle("fs:rename", (_e, rel: string, nome: string) =>
    requireVault().rename(rel, nome),
  );
  ipcMain.handle("fs:trash", async (_e, rel: string) => {
    // Lixeira do Windows, nao unlink: apagar a nota errada com dois cliques
    // precisa ter volta, e o raw/ e a unica copia local do seu texto.
    await shell.trashItem(requireVault().trashTarget(rel));
    return true;
  });
  ipcMain.handle("fs:openExternal", async (_e, rel: string) => {
    // PPT, DOCX e afins: abre no programa padrao do Windows.
    const erro = await shell.openPath(requireVault().resolve(rel));
    if (erro) throw new Error(erro);
    return true;
  });
  ipcMain.handle(
    "fs:pasteImage",
    async (_e, base: string, ext: string, data: Uint8Array) => {
      const v = requireVault();
      const dir = "raw/attachments";
      const nome = await v.freeName(dir, base, ext);
      await v.writeBinary(`${dir}/${nome}`, data);
      return nome;
    },
  );

  ipcMain.handle("fs:lessons", () => requireVault().lessons());
  ipcMain.handle("fs:home", () => requireVault().home());
  ipcMain.handle("fs:resolveLink", (_e, slug: string) => requireVault().resolveLink(slug));
  /** Link externo de uma nota abre no navegador do sistema, nunca na janela. */
  ipcMain.handle("fs:openUrl", async (_e, url: string) => {
    if (!/^https?:\/\//i.test(url)) throw new Error(`URL recusada: ${url}`);
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle("clipboard:read", () => clipboard.readText());
  ipcMain.handle("clipboard:write", (_e, text: string) => {
    clipboard.writeText(text);
    return true;
  });

  ipcMain.handle("status:get", () => requireVault().ingestStatus());

  ipcMain.handle(
    "session:start",
    async (_e, cmd: Cmd, code: string, lesson: string | null) => {
      // Copia de seguranca ANTES de enfileirar: `redo` reescreve a pagina e
      // `delete` a apaga. Guardar depois nao adiantaria nada.
      if ((cmd === "redo" || cmd === "delete") && vault && lesson) {
        const alvo = await vault.describe(code, lesson).catch(() => null);
        for (const rel of [alvo?.wikiPage, alvo?.wikiReview]) {
          if (!rel) continue;
          const copia = await vault.arquivar(rel);
          if (copia) runner?.log(`Copia guardada em ${copia}`);
        }
      }
      return requireRunner().enqueue(cmd, code, lesson);
    },
  );
  ipcMain.handle("session:reply", (_e, text: string) => requireRunner().reply(text));
  ipcMain.handle("session:cancel", () => requireRunner().cancel());
  /** Limpar e do transcript do MAIN: so assim a linha nao volta no snapshot. */
  ipcMain.handle("session:clear", () => {
    runner?.limpar();
    return true;
  });
  // Painel recem-montado se reconstitui daqui — trocar de aba nao apaga o log.
  ipcMain.handle("session:snapshot", () =>
    runner ? runner.snapshot() : { state: null, lines: [], queue: [] },
  );

  // ---- conta do Athena (Supabase) — mesma sessao do `athena login` ----
  ipcMain.handle("account:status", async () =>
    comDono(await account.status(requireVault().root)),
  );
  ipcMain.handle("account:login", async (_e, email: string, password: string) =>
    comDono(await account.login(requireVault().root, email, password)),
  );
  ipcMain.handle("account:signUp", async (_e, email: string, senha: string, nome: string) =>
    comDono(await account.signUp(requireVault().root, email, senha, nome)),
  );
  // O navegador do sistema, nao uma janela do Electron: Google e GitHub
  // recusam login dentro de webview embutida.
  ipcMain.handle("account:oauth", async (_e, provider: account.Provedor) =>
    comDono(
      await account.oauthLogin(requireVault().root, provider, (url) => {
        void shell.openExternal(url);
      }),
    ),
  );
  ipcMain.handle("account:oauthCancel", () => account.oauthCancel());
  /** Escolhe a imagem e sobe. Devolve null se a pessoa fechou o seletor. */
  ipcMain.handle("account:avatarPick", async () => {
    const res = await dialog.showOpenDialog({
      title: "Escolha a foto de perfil",
      properties: ["openFile"],
      filters: [{ name: "Imagens", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return comDono(await account.avatarUpload(requireVault().root, res.filePaths[0]));
  });
  ipcMain.handle("account:avatarRemove", async () =>
    comDono(await account.avatarRemove(requireVault().root)),
  );
  /** "Sim, este vault agora e desta conta" — apaga o aviso de troca. */
  ipcMain.handle("account:assumirVault", (_e, email: string) => {
    const cfg = readConfig();
    writeConfig({ ...cfg, donos: { ...(cfg.donos ?? {}), [requireVault().root]: email } });
    return true;
  });
  ipcMain.handle(
    "account:update",
    (_e, campos: { email?: string; password?: string; nome?: string }) =>
      account.updateAccount(requireVault().root, campos),
  );
  ipcMain.handle("account:logout", () => {
    account.logout(requireVault().root);
    return true;
  });

  // ---- glossario: do DISCO, nao do banco ----
  ipcMain.handle("fs:glossario", () => biblioteca.glossario(requireVault()));
  ipcMain.handle("fs:buscar", (_e, termo: string) => requireVault().buscarConteudo(termo));

  // ---- publicacao (Supabase + R2), nao git ----
  ipcMain.handle("publish:run", (_e, name: publish.ScriptName, flags: string[]) =>
    runScript(name, flags ?? []),
  );
  ipcMain.handle("publish:available", () => ({
    publish: publish.scriptExists(requireVault().root, "publish"),
    pull: publish.scriptExists(requireVault().root, "pull"),
  }));
  ipcMain.handle("config:autoPublish", (_e, on?: boolean) => {
    if (typeof on === "boolean") writeConfig({ ...readConfig(), autoPublish: on });
    return readConfig().autoPublish !== false;
  });
  ipcMain.handle("config:autoPull", (_e, on?: boolean) => {
    if (typeof on === "boolean") writeConfig({ ...readConfig(), autoPull: on });
    return readConfig().autoPull !== false;
  });

  // ---- janela (a moldura e do app, nao do sistema) ----
  ipcMain.handle("win:close", () => {
    win?.close();
    return true;
  });
  ipcMain.handle("win:toggleMaximize", () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  ipcMain.handle("claude:whoami", () => claudeConta());

  /**
   * Abre um terminal ja no `claude`. O login do Claude Code e interativo e
   * mora fora do app: sem isto, a unica saida do usuario e adivinhar o
   * comando a partir de uma mensagem de erro em ingles.
   */
  ipcMain.handle("claude:openLogin", () => {
    const cwd = vault?.root ?? app.getPath("home");
    if (process.platform === "win32") {
      spawn("cmd.exe", ["/c", "start", '"Claude Code"', "cmd", "/k", "claude"], {
        cwd,
        shell: true,
        detached: true,
        stdio: "ignore",
      }).unref();
    } else {
      spawn("x-terminal-emulator", ["-e", "claude"], { cwd, detached: true, stdio: "ignore" }).unref();
    }
    return true;
  });
}

/**
 * athena://file/<caminho-relativo> — le arquivo do vault de dentro da janela.
 *
 * Existe porque o renderer roda em http://localhost:5173 no dev: um `file://`
 * em <img> ou <iframe> a partir dessa origem e bloqueado pelo Chromium. Este
 * esquema resolve os dois casos que precisam de arquivo bruto: a imagem colada
 * na nota e o PDF do professor no visualizador.
 *
 * A guarda e o resolve() do Vault — caminho que escapa da raiz nao e servido.
 */
function registerProtocol() {
  protocol.handle("athena", async (req) => {
    try {
      const url = new URL(req.url);
      if (url.host !== "file") return new Response("not found", { status: 404 });
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const abs = requireVault().resolve(rel);
      if (!fs.existsSync(abs)) return new Response("not found", { status: 404 });
      return net.fetch(pathToFileURL(abs).toString());
    } catch (e) {
      return new Response(String((e as Error).message), { status: 403 });
    }
  });
}

/**
 * O icone mora em build/, fora do bundle de codigo: `app.getAppPath()` aponta
 * para a raiz do projeto no dev e para o asar no empacotado, e os dois tem a
 * pasta build dentro. .ico no Windows (a barra de tarefas quer varios tamanhos
 * num arquivo so), .png no resto.
 */
function iconePath() {
  const nome = process.platform === "win32" ? "icon.ico" : "icon.png";
  const p = path.join(app.getAppPath(), "build", nome);
  return fs.existsSync(p) ? p : undefined;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    icon: iconePath(),
    // File/Edit/View/Window/Help e o menu que o Electron poe sozinho: nada ali
    // e do Athena. Sai da janela e some do Alt.
    autoHideMenuBar: true,
    backgroundColor: "#0A0A0C",
    // Sem moldura no Windows/Linux: a barra de titulo e do app (TitleBar.tsx).
    // No macOS a moldura fica, com os tres botoes embutidos — remove-la ali
    // tiraria fechar/minimizar/zoom do lugar onde todo mac os tem.
    frame: process.platform === "darwin",
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

// Precisa acontecer ANTES do ready: depois, o Chromium ja decidiu o que cada
// esquema pode fazer, e athena:// nasceria sem direito a fetch nem a iframe.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "athena",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

app.whenReady().then(() => {
  // Sem isto o Windows agrupa a janela sob "Electron" na barra de tarefas e
  // mostra o icone padrao mesmo com `icon` definido acima.
  if (process.platform === "win32") app.setAppUserModelId("br.athena.app");
  // `autoHideMenuBar` so esconde; sem isto o Alt ainda faz o menu aparecer.
  // No macOS o menu da aplicacao e obrigatorio, entao la ele fica.
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  registerIpc();
  registerProtocol();
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
