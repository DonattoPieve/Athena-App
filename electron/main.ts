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
import { Vault, migrarNomesAntigos, slugify, type ProgressoImportar } from "./vault";
import { ClaudeRunner, Cmd, SessionEvent } from "./claude";
import * as account from "./account";
import * as publish from "./publish";
import { apagarNaNuvem } from "./publicar";
import * as biblioteca from "./biblioteca";
import * as usage from "./usage";
import * as bootstrap from "./bootstrap";
import * as materiais from "./materiais";
import { iniciarAtualizador } from "./atualizacao";
import { getPrefs, setPrefs, zipPastaStore, type Prefs, type PrefsSalvas } from "./prefs";

type Config = {
  /** Vault de cada conta: id do usuario -> pasta. Ver abrirVaultDaConta(). */
  vaults?: Record<string, string>;
  /** Vault unico de antes de cada conta ter a sua pasta. Hoje so migracao. */
  vaultPath?: string;
  claudeBin?: string;
  /** Publicar sozinho quando o comando termina com OK — igual ao athena.bat. */
  autoPublish?: boolean;
  /** Puxar do banco uma vez na abertura do app. */
  autoPull?: boolean;
  /** Ultima conta que assumiu cada vault: caminho -> e-mail. Ver comDono(). */
  donos?: Record<string, string>;
  /** Preferencias de exibicao — tudo em Prefs menos iniciarComSistema (ver prefs.ts). */
  prefs?: Partial<PrefsSalvas>;
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

/**
 * Manda para TODAS as janelas, nao so para a principal.
 *
 * Depois que uma aba pode ser arrancada para uma janela propria, o estado da
 * sessao deixou de ser de uma janela so: a janela destacada tambem precisa
 * saber que o Claude parou para perguntar.
 */
function send(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

/** Le o veredito na raiz e avisa o renderer. Unico caminho de atualizacao. */
async function pushStatus() {
  if (!vault) return;
  send("status:changed", await vault.ingestStatus());
}

function attachVault(root: string) {
  // ANTES de qualquer leitura do disco: um vault gravado por uma versao
  // anterior tem as pastas chamadas `raw/` e `wiki/`, e daqui para frente todo
  // mundo procura `Notes/` e `Resumos/`. Ver migrarNomesAntigos.
  const migradas = migrarNomesAntigos(root);
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

  // Depois do runner nascer: a linha vai para o painel da sessao, que e onde
  // a pessoa procura explicacao quando algo mudou sozinho. Uma por pasta.
  for (const troca of migradas) runner?.log(`Vault atualizado: pasta renomeada, ${troca}`);

  watcher?.close();
  // OneDrive dispara eventos fantasma; o debounce do awaitWriteFinish
  // evita repintar a arvore no meio de uma escrita.
  watcher = chokidar.watch([path.join(root, "Notes"), path.join(root, "Resumos")], {
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
  // ignora dotfiles e nem olha para fora de Notes/ e Resumos/. Sem este segundo
  // watcher o OK final do ingest nunca chega na tela, e o painel Publicar
  // fica congelado no FAIL escrito no comeco do comando.
  statusWatcher?.close();
  statusWatcher = chokidar.watch(path.join(root, ".ingest-status"), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  statusWatcher.on("all", () => void pushStatus());

  // O `athena publish`/`pull` do terminal leem a sessao de dentro do vault; o
  // app agora a guarda em %APPDATA%. O espelho mantem os dois entrando juntos.
  account.espelharSessaoEm(root);
  // Vault novo, pull novo: sem isto, trocar de conta abriria a pasta da outra
  // sem puxar nada.
  jaPuxou = false;
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
  // Sem o script do vault o pull acontece por dentro do app — nao ha mais
  // motivo para desistir aqui.

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

/* ------------------------------------------------------------------ *
 * Um vault por conta
 *
 * A pasta no disco nao sabe de conta nenhuma: por isso, ate aqui, trocar de
 * login mostrava exatamente os mesmos arquivos — a trava do `comDono()`
 * protegia o BANCO (o publish nao mandava nada para a conta errada), nunca a
 * tela. Agora cada conta tem a sua pasta, e ver o vault do outro deixa de ser
 * possivel porque nao e a mesma pasta.
 *
 * Por padrao a pasta e do app (`%APPDATA%\athena-app\vaults\<id>`) e ninguem
 * precisa saber onde fica. Quem prefere escolher continua podendo: a escolha
 * fica anotada em `vaults[id]`.
 * ------------------------------------------------------------------ */

let uidAtual: string | null = null;

function pastaInternaDoVault(uid: string): string {
  return path.join(app.getPath("userData"), "vaults", uid);
}

function guardarVaultDaConta(pasta: string) {
  const cfg = readConfig();
  writeConfig(
    uidAtual
      ? { ...cfg, vaults: { ...(cfg.vaults ?? {}), [uidAtual]: pasta } }
      : { ...cfg, vaultPath: pasta },
  );
}

/** Desanexa tudo — usado ao sair e ao entrar numa conta que ainda nao tem vault. */
function soltarVault() {
  vault = null;
  runner?.removeAllListeners();
  runner = null;
  watcher?.close();
  watcher = null;
  statusWatcher?.close();
  statusWatcher = null;
  account.espelharSessaoEm(null);
  // A listagem do R2 e o token são da conta que estava aberta.
  materiais.esquecer();
}

/**
 * Abre o vault da conta que acabou de ser identificada.
 *
 * A MIGRACAO importa: quem ja usava o app tem um `vaultPath` unico, e o
 * `donos` diz de quem ele e. Adotar essa pasta para a conta dona evita que a
 * primeira abertura depois desta mudanca mande baixar centenas de MB numa
 * pasta nova, com a antiga intacta do lado.
 */
function abrirVaultDaConta(conta: { id: string; email: string } | null) {
  uidAtual = conta?.id ?? null;
  // O cache de material e a listagem do bucket sao por conta: sem isto, duas
  // contas nesta maquina compartilhariam a pasta de cache, e a segunda leria o
  // PDF que a primeira baixou. Ver materiais.ts.
  materiais.definirConta(uidAtual);
  if (!conta) {
    soltarVault();
    return;
  }

  const cfg = readConfig();
  let alvo = cfg.vaults?.[conta.id];

  if (!alvo && cfg.vaultPath && Vault.isVault(cfg.vaultPath)) {
    const dono = cfg.donos?.[cfg.vaultPath];
    if (!dono || dono === conta.email) {
      alvo = cfg.vaultPath;
      writeConfig({ ...cfg, vaults: { ...(cfg.vaults ?? {}), [conta.id]: alvo } });
    }
  }

  if (alvo && Vault.isVault(alvo)) {
    if (vault?.root !== alvo) attachVault(alvo);
  } else {
    soltarVault();
  }
}

/** O `account.ts` ainda recebe o vault (le o `.env.local` dele quando existe). */
function vaultRootOuVazio(): string {
  return vault?.root ?? "";
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
  /** Tamanho em disco — a barra do rodape da lateral. */
  ipcMain.handle("vault:tamanho", () => requireVault().tamanho());

  ipcMain.handle("vault:get", async () => {
    // Quem escolhe o vault e o login (abrirVaultDaConta): aqui so se responde
    // qual ficou aberto. Nao bloqueia a janela — a arvore aparece e o pull
    // acontece atras, com a saida no painel da sessao.
    if (vault) void pullInicial();
    return { path: vault?.root ?? null, claudeBin: readConfig().claudeBin ?? "claude" };
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
        "Essa pasta nao parece o vault do Athena — nao encontrei CLAUDE.md e Notes/.",
      );
    }
    guardarVaultDaConta(chosen);
    attachVault(chosen);
    return { path: chosen };
  });

  /**
   * Primeiro uso — três passos que hoje só existem no terminal (clonar,
   * `athena login`, `athena pull`) viram pela interface. Ver bootstrap.ts.
   */

  /** Escolhe uma pasta para NASCER o vault — sem exigir CLAUDE.md/Notes/, ao contrário de vault:pick. */
  ipcMain.handle("vault:escolherPastaNova", async () => {
    const res = await dialog.showOpenDialog({
      title: "Escolha (ou crie) uma pasta vazia para o vault novo",
      properties: ["openDirectory", "createDirectory"],
    });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });

  ipcMain.handle("vault:criarNovo", async (_e, pasta: string) => {
    await bootstrap.criarVault(pasta);
    // Mesmo efeito de vault:pick: essa pasta vira o vault ativo, para que o
    // login e o download (passo seguinte, na mesma tela) já encontrem
    // `requireVault()` respondendo, sem a pessoa escolher a pasta de novo.
    guardarVaultDaConta(pasta);
    attachVault(pasta);
    return { path: pasta };
  });

  /**
   * O caminho sem pergunta nenhuma: o vault nasce dentro dos dados do app.
   *
   * Pasta ja existente e nao-vazia e aceita de volta como esta (acontece quando
   * a pessoa fecha o app no meio do primeiro download e abre de novo); o
   * `baixarTudo` seguinte completa o que falta sem sobrescrever nada.
   */
  ipcMain.handle("vault:criarInterno", async () => {
    if (!uidAtual) throw new Error("Entre com a conta antes de criar o vault.");
    const pasta = pastaInternaDoVault(uidAtual);
    fs.mkdirSync(pasta, { recursive: true });
    if (!Vault.isVault(pasta)) await bootstrap.criarVault(pasta);
    guardarVaultDaConta(pasta);
    attachVault(pasta);
    return { path: pasta };
  });

  ipcMain.handle("vault:baixarTudo", async () => {
    const root = requireVault().root;
    const r = runner;
    const resultado = await bootstrap.baixarTudo(root, (linha) => {
      r?.log(linha);
      send("bootstrap:linha", linha);
    });
    send("vault:changed", null);
    return resultado;
  });

  /**
   * Zip do vault inteiro para a pessoa levar/guardar fora do OneDrive.
   *
   * `.athena` fica de fora junto com as pastas de ferramenta: `session.json`
   * dentro dele carrega o refresh token da conta, e um zip pensado para sair
   * da maquina (mandar por e-mail, subir num drive) nao pode levar credencial
   * junto so porque estava na mesma pasta.
   */
  ipcMain.handle("vault:exportar", async () => {
    const v = requireVault();
    const res = await dialog.showSaveDialog({
      title: "Exportar vault",
      defaultPath: path.join(app.getPath("documents"), `${path.basename(v.root)}.zip`),
      filters: [{ name: "Arquivo zip", extensions: ["zip"] }],
    });
    if (res.canceled || !res.filePath) return null;
    zipPastaStore(v.root, res.filePath, new Set(["node_modules", ".git", ".next", "dist", "release", ".athena"]));
    return res.filePath;
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

  // ---- prefs de exibicao — mesmo athena-app.json, campo `prefs` ----
  ipcMain.handle("config:getPrefs", (): Prefs => getPrefs(readConfig().prefs));
  ipcMain.handle("config:setPrefs", (_e, patch: Partial<Prefs>): Prefs => {
    const salvas = setPrefs(readConfig().prefs, patch);
    writeConfig({ ...readConfig(), prefs: salvas });
    return getPrefs(salvas);
  });

  /**
   * A arvore e o disco MAIS o que a conta tem no bucket.
   *
   * So o disco nao serve num PC novo: `Notes/INATEL` nasce vazio, e o material
   * do professor so desce quando alguem abre o arquivo — que e justamente o
   * que ninguem consegue fazer numa pasta que a tela mostra vazia. Ver
   * `mesclarRemotos` em materiais.ts.
   */
  ipcMain.handle("fs:tree", async (_e, scope: string) => {
    const v = requireVault();
    return materiais.mesclarRemotos(v.root, scope, await v.tree(scope));
  });
  ipcMain.handle("fs:read", (_e, rel: string) => requireVault().read(rel));
  ipcMain.handle("fs:write", (_e, rel: string, content: string) =>
    requireVault().write(rel, content),
  );
  ipcMain.handle("fs:subjects", () => requireVault().subjects());
  /**
   * O material de origem de uma pagina, no caminho que existe em QUALQUER PC.
   *
   * O espelho entra aqui porque num vault recem-criado a pasta da materia esta
   * vazia: o arquivo existe na conta, ainda nao no disco. Falhar a listagem
   * (sem rede, sem cache) nao pode derrubar a leitura da pagina — sem ela a
   * busca continua, so que restrita ao que ja desceu.
   */
  ipcMain.handle(
    "fs:materialDaPagina",
    async (_e, relPagina: string, source: string | null, sourceHref: string | null) => {
      const v = requireVault();
      let remotos: string[] = [];
      try {
        remotos = (await materiais.espelho(v.root)).map((i) => i.rel);
      } catch {
        /* sem rede e sem listagem guardada: vale o que estiver no disco */
      }
      return v.materialDaPagina(relPagina, source, sourceHref, remotos);
    },
  );
  ipcMain.handle("fs:describe", (_e, code: string, lesson: string | null) =>
    requireVault().describe(code, lesson),
  );
  ipcMain.handle("fs:slug", (_e, input: string) => slugify(input));
  ipcMain.handle("fs:reveal", async (_e, rel: string) => {
    const v = requireVault();
    const abs = v.resolve(rel);
    if (fs.existsSync(abs)) return shell.showItemInFolder(abs);
    // Material que ainda nao desceu: revelar o caminho do vault abriria a
    // pasta e nao mostraria nada. Traz o arquivo e revela a copia do cache —
    // que e onde ele de fato esta nesta maquina.
    const doCache = await materiais.garantirParaLeitura(v.root, rel);
    if (!doCache) throw new Error(`"${rel}" ainda não está nesta máquina.`);
    shell.showItemInFolder(doCache);
  });

  // ---- operacoes do explorer ----
  ipcMain.handle("fs:mkdir", (_e, rel: string) => requireVault().mkdir(rel));
  ipcMain.handle("fs:create", (_e, rel: string, content: string) =>
    requireVault().create(rel, content),
  );
  ipcMain.handle("fs:rename", (_e, rel: string, nome: string) =>
    requireVault().rename(rel, nome),
  );
  ipcMain.handle("fs:mover", (_e, relOrigem: string, relPastaDestino: string) =>
    requireVault().mover(relOrigem, relPastaDestino),
  );
  /**
   * Arrastar de FORA do app para dentro da arvore (Explorer do Windows).
   *
   * E como uma materia nova entra em `Notes/INATEL` sem abrir o Explorer por
   * fora. Copia, e nunca sobrescreve — ver `importar` no vault.ts. Nada sobe
   * para o R2 aqui: o material so vai para a nuvem quando o Donatto publica.
   */
  ipcMain.handle("fs:importar", async (_e, relPastaDestino: string, origens: string[]) => {
    // O progresso vai por evento, e nao no retorno: quem esta esperando e a
    // tela DURANTE a copia, e o retorno so chega no fim. Uma materia inteira
    // sao centenas de arquivos — mandar um evento por arquivo entupiria o IPC
    // sem que o olho visse a diferenca, entao aqui vai no maximo um a cada
    // 120 ms (o ultimo sempre passa, senao a barra congela em 97%).
    let ultimo = 0;
    const aviso = (p: ProgressoImportar) => {
      const agora = Date.now();
      if (p.feitos !== p.total && agora - ultimo < 120) return;
      ultimo = agora;
      send("fs:importando", p);
    };
    try {
      return await requireVault().importar(relPastaDestino, origens, aviso);
    } finally {
      // Sempre, inclusive quando estourou no meio: senao a tela fica com a
      // linha de progresso de uma copia que ja acabou.
      send("fs:importando", null);
    }
  });
  /**
   * Apagar. Sempre para a lixeira do Windows; na nuvem, so se pedirem.
   *
   * A ORDEM importa: a nuvem primeiro, o disco depois. Se o Worker recusar,
   * o arquivo local continua onde estava e o erro sobe para a tela — o
   * contrario deixaria a pessoa sem a copia local E com a da nuvem intacta,
   * achando que apagou.
   */
  ipcMain.handle("fs:trash", async (_e, rel: string, naNuvem = false) => {
    const v = requireVault();
    // Valida a permissao ANTES de tocar na nuvem: `trashTarget` recusa
    // caminho que nao pode ser apagado.
    const alvo = v.trashTarget(rel);

    let apagados = { r2: 0, banco: 0 };
    if (naNuvem) {
      apagados = await apagarNaNuvem(v.root, rel, (linha) => runner?.log(linha));
    }

    // Pode nao existir no disco: no que so estava no espelho, apagar e
    // exatamente tirar da nuvem, e nao ha o que mandar para a lixeira.
    if (fs.existsSync(alvo)) await shell.trashItem(alvo);
    send("vault:changed", null);
    // Aba aberta de um arquivo que acabou de ir para a lixeira mostra conteudo
    // que nao existe mais, e salvar dali recriaria o arquivo apagado. Vai para
    // TODAS as janelas de proposito: a aba pode ter sido arrancada para outra.
    send("fs:apagado", rel);
    return apagados;
  });
  ipcMain.handle("fs:openExternal", async (_e, rel: string) => {
    // PPT, DOCX e afins: abre no programa padrao do Windows.
    const v = requireVault();
    const abs = v.resolve(rel);
    // O PPT do professor pode estar so no bucket: abrir o caminho do vault
    // devolveria "arquivo nao encontrado" para um item que a arvore mostra.
    const alvo = fs.existsSync(abs) ? abs : await materiais.garantirParaLeitura(v.root, rel);
    if (!alvo) throw new Error(`"${rel}" ainda não está nesta máquina.`);
    const erro = await shell.openPath(alvo);
    if (erro) throw new Error(erro);
    return true;
  });
  ipcMain.handle(
    "fs:pasteImage",
    async (_e, base: string, ext: string, data: Uint8Array) => {
      const v = requireVault();
      const dir = "Notes/attachments";
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
      // O Claude Code lê o PDF pelo caminho de verdade (`Notes/INATEL/...`), não
      // pelo cache. Num PC novo esse arquivo pode não ter descido ainda — e um
      // ingest sem o material do professor gera página com cara de pronta e sem
      // lastro no que foi cobrado em aula. Por isso a garantia vem antes.
      if ((cmd === "ingest" || cmd === "redo") && vault) {
        await materiais
          .garantirNoVault(vault.root, code, (linha) => runner?.log(linha))
          .catch(() => 0);
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
  // Cada handler de conta termina em `abrirVaultDaConta`: e o login que decide
  // qual pasta o app abre, nao o contrario.
  ipcMain.handle("account:status", async () => {
    const conta = await account.status(vaultRootOuVazio());
    abrirVaultDaConta(conta);
    return comDono(conta);
  });
  ipcMain.handle("account:login", async (_e, email: string, password: string) => {
    const conta = await account.login(vaultRootOuVazio(), email, password);
    abrirVaultDaConta(conta);
    return comDono(conta);
  });
  ipcMain.handle("account:signUp", async (_e, email: string, senha: string, nome: string) => {
    const conta = await account.signUp(vaultRootOuVazio(), email, senha, nome);
    abrirVaultDaConta(conta);
    return comDono(conta);
  });
  // O navegador do sistema, nao uma janela do Electron: Google e GitHub
  // recusam login dentro de webview embutida.
  ipcMain.handle("account:oauth", async (_e, provider: account.Provedor) => {
    const conta = await account.oauthLogin(vaultRootOuVazio(), provider, (url) => {
      void shell.openExternal(url);
    });
    abrirVaultDaConta(conta);
    return comDono(conta);
  });
  ipcMain.handle("account:oauthCancel", () => account.oauthCancel());
  /** Escolhe a imagem e sobe. Devolve null se a pessoa fechou o seletor. */
  ipcMain.handle("account:avatarPick", async () => {
    const res = await dialog.showOpenDialog({
      title: "Escolha a foto de perfil",
      properties: ["openFile"],
      filters: [{ name: "Imagens", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return comDono(await account.avatarUpload(vaultRootOuVazio(), res.filePaths[0]));
  });
  ipcMain.handle("account:avatarRemove", async () =>
    comDono(await account.avatarRemove(vaultRootOuVazio())),
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
      account.updateAccount(vaultRootOuVazio(), campos),
  );
  ipcMain.handle("account:logout", () => {
    account.logout(vaultRootOuVazio());
    // Sem soltar o vault, a proxima conta abriria a arvore da anterior ate a
    // janela recarregar — exatamente o que esta mudanca veio corrigir.
    soltarVault();
    uidAtual = null;
    return true;
  });

  // ---- glossario: do DISCO, nao do banco ----
  ipcMain.handle("fs:glossario", () => biblioteca.glossario(requireVault()));
  ipcMain.handle("fs:buscar", (_e, termo: string) => requireVault().buscarConteudo(termo));

  // ---- uso do app NESTE APARELHO: posicao de leitura, bookmark, fila de review ----
  ipcMain.handle("usage:recentes", () => usage.recentes(requireVault()));
  ipcMain.handle("usage:visitar", (_e, rel: string, pct?: number) =>
    usage.visitar(requireVault(), rel, pct),
  );
  ipcMain.handle("usage:ultimaLeitura", () => usage.ultimaLeitura(requireVault()));
  ipcMain.handle("usage:termos", () => usage.termos(requireVault()));
  ipcMain.handle("usage:alternarTermo", (_e, termo: string) =>
    usage.alternarTermo(requireVault(), termo),
  );
  ipcMain.handle("usage:revisao", () => usage.revisao(requireVault()));

  // ---- publicacao (Supabase + R2), nao git ----
  ipcMain.handle("publish:run", (_e, name: publish.ScriptName, flags: string[]) =>
    runScript(name, flags ?? []),
  );
  // Sempre disponiveis: sem os scripts do vault, o app faz o trabalho por
  // dentro (ver publish.ts). Responder `false` aqui esconderia o botao numa
  // maquina onde publicar funciona.
  ipcMain.handle("publish:available", () => ({
    publish: true,
    pull: true,
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
  /**
   * Os controles agem sobre a janela de QUEM chamou, nao sobre `win`.
   *
   * Com a aba destacada existindo, `win` deixou de ser "a janela": o X de uma
   * janela filha fechava a principal, que e o pior defeito possivel num botao
   * de fechar.
   */
  const daChamada = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender);

  ipcMain.handle("win:close", (e) => {
    daChamada(e)?.close();
    return true;
  });
  ipcMain.handle("win:minimize", (e) => {
    daChamada(e)?.minimize();
    return true;
  });
  ipcMain.handle("win:toggleMaximize", (e) => {
    const j = daChamada(e);
    if (!j) return false;
    if (j.isMaximized()) j.unmaximize();
    else j.maximize();
    return j.isMaximized();
  });
  ipcMain.handle("win:isMaximized", (e) => !!daChamada(e)?.isMaximized());

  /**
   * Aba arrancada da barra: nasce uma janela com aquela aba dentro.
   *
   * A aba viaja como JSON no hash da URL, e nao por IPC depois que a janela
   * abre, porque a janela nova precisa ja montar com ela — mandar depois faria
   * a Home piscar antes do conteudo certo.
   *
   * A nova janela abre deslocada do cursor e nao exatamente nele: colada no
   * ponteiro, o primeiro clique cairia dentro dela sem querer.
   */
  ipcMain.handle("win:destacar", (e, aba: unknown, x?: number, y?: number) => {
    const nova = criarJanela("#aba=" + encodeURIComponent(JSON.stringify(aba)));
    if (typeof x === "number" && typeof y === "number") {
      const [w, h] = nova.getSize();
      nova.setPosition(Math.round(x - w / 2), Math.max(0, Math.round(y - 20)));
    }
    // A janela de origem perde a aba — quem manda isso e o renderer dela.
    void e;
    return true;
  });

  /**
   * O passo a passo, numa janela propria e menor.
   *
   * Janela, e nao aba: quem esta aprendendo precisa LER e FAZER ao mesmo
   * tempo, e uma aba obriga a trocar de tela a cada passo. Se ja houver uma
   * aberta, ela vem para a frente em vez de nascer uma segunda.
   */
  ipcMain.handle("win:ajuda", () => {
    // Compara o hash DECODIFICADO: em producao a janela nasce por `loadFile`
    // com a opcao `hash`, e o Electron pode reescrever a codificacao pelo
    // caminho — procurar o texto cru abriria uma segunda janela a cada clique.
    const aberta = BrowserWindow.getAllWindows().find((w) => {
      try {
        return decodeURIComponent(w.webContents.getURL()).includes('"tipo":"ajuda"');
      } catch {
        return false;
      }
    });
    if (aberta) {
      if (aberta.isMinimized()) aberta.restore();
      aberta.focus();
      return true;
    }
    criarJanela("#aba=" + encodeURIComponent(JSON.stringify({ id: "ajuda", tipo: "ajuda" })), {
      largura: 900,
      altura: 720,
      minimo: 520,
    });
    return true;
  });

  /** Versao do `package.json`, via Electron — uma fonte so, sem copia na UI. */
  ipcMain.handle("app:versao", () => app.getVersion());

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
      if (fs.existsSync(abs)) return net.fetch(pathToFileURL(abs).toString());

      // Não está no disco: pode ser material que mora no R2 e ainda não desceu
      // nesta máquina. Abrir o arquivo É o gesto que o traz (ver materiais.ts);
      // da segunda vez em diante sai do cache, sem rede.
      const doCache = await materiais
        .garantirParaLeitura(requireVault().root, rel)
        .catch((e: Error) => {
          runner?.log(`Não consegui trazer ${rel}: ${e.message}`, "error");
          return null;
        });
      if (!doCache) return new Response("not found", { status: 404 });
      // O arquivo acabou de descer: a arvore ainda o mostra como "so na
      // nuvem". Avisar aqui troca o icone assim que o PDF abre, sem a pessoa
      // precisar clicar em outra pasta e voltar.
      send("vault:changed", null);
      return net.fetch(pathToFileURL(doCache).toString());
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

/**
 * Cria uma janela.
 *
 * `hash` carrega a aba destacada (`#aba=<json>`). A janela e a mesma em tudo
 * — mesmo preload, mesmo HTML —; quem decide abrir so aquela aba e o renderer,
 * lendo o hash. Assim nao existe "janela de segunda classe": destacada ou nao,
 * o app inteiro esta ali.
 */
/**
 * `tamanho` existe para a janela de ajuda: 1280x820 e a medida de uma janela
 * de TRABALHO (lateral, conteudo, transcript). Um passo a passo nesse tamanho
 * vira uma coluna de texto perdida no meio do vazio, e ainda cobre o app que
 * a pessoa esta tentando aprender a usar.
 */
function criarJanela(hash = "", tamanho?: { largura: number; altura: number; minimo: number }): BrowserWindow {
  const janela = new BrowserWindow({
    width: tamanho?.largura ?? 1280,
    height: tamanho?.altura ?? 820,
    minWidth: tamanho?.minimo ?? 940,
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
    janela.loadURL("http://localhost:5173" + hash);
  } else {
    janela.loadFile(path.join(__dirname, "../renderer/index.html"), { hash: hash.replace(/^#/, "") });
  }

  /**
   * F12 abre o DevTools.
   *
   * O menu do Electron foi removido da janela, e com ele foi o Ctrl+Shift+I.
   * Sem nenhuma porta de entrada, uma tela preta vira adivinhacao: o erro do
   * renderer existe, so nao ha onde ler. Isto e o unico jeito de ler.
   */
  janela.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && input.key === "F12") janela.webContents.toggleDevTools();
  });

  /**
   * Arquivo solto na janela NUNCA navega.
   *
   * Errar o alvo do arrastar (soltar no editor, na lateral, na barra de abas)
   * fazia o Chromium tratar o arquivo como pagina e sair da aplicacao: em
   * producao a janela ia para o `file://` do PDF, em dev nem isso — `file://`
   * e barrado numa pagina servida por `http://localhost:5173`, e sobrava uma
   * tela quebrada sem explicacao. O renderer ja barra o `drop` (ver
   * src/main.tsx); isto aqui e a rede embaixo dela, para quando um alvo novo
   * esquecer o `preventDefault`.
   */
  janela.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("file://") && !url.includes("/renderer/index.html")) e.preventDefault();
  });

  // Se o HTML nem carregar, o DevTools tambem nao ajuda — o erro vai para o
  // terminal de onde o app foi aberto.
  janela.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[athena] falha ao carregar ${url}: ${desc} (${code})`);
  });

  // Maximizar nao acontece so pelo botao: o snap do Windows e o duplo clique
  // na faixa tambem maximizam. Sem avisar o renderer, o icone mentiria.
  // So para esta janela: maximizar uma nao pode mexer no icone da outra.
  janela.on("maximize", () => janela.webContents.send("win:maximized", true));
  janela.on("unmaximize", () => janela.webContents.send("win:maximized", false));

  janela.on("closed", () => {
    if (win === janela) win = null;
  });

  return janela;
}

/** A janela principal — a que carrega o vault e some quando o app fecha. */
function createWindow() {
  win = criarJanela();
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
  // A sessao mora com os dados do app, nao dentro do vault: para saber qual
  // pasta abrir e preciso ja saber quem entrou. Ver account.ts.
  account.configurarSessao(app.getPath("userData"));
  account.importarSessaoAntiga(readConfig().vaultPath ?? null);
  // Sem isto o Windows agrupa a janela sob "Electron" na barra de tarefas e
  // mostra o icone padrao mesmo com `icon` definido acima.
  if (process.platform === "win32") app.setAppUserModelId("br.athena.app");
  // `autoHideMenuBar` so esconde; sem isto o Alt ainda faz o menu aparecer.
  // No macOS o menu da aplicacao e obrigatorio, entao la ele fica.
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  registerIpc();
  registerProtocol();
  createWindow();
  // Depois da janela: o updater fala com o renderer, e o primeiro estado
  // precisa de alguem para ouvir.
  iniciarAtualizador({
    send,
    // Nunca reiniciar no meio de um ingest — ver atualizacao.ts.
    ocupado: () => runner?.busy ?? false,
    log: (linha) => {
      runner?.log(linha);
      console.log(linha);
    },
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  watcher?.close();
  statusWatcher?.close();
  if (process.platform !== "darwin") app.quit();
});
