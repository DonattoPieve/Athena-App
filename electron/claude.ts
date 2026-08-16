import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export type Cmd = "ingest" | "redo" | "review" | "delete";

export type Job = {
  id: string;
  cmd: Cmd;
  code: string;
  lesson: string | null;
  label: string;
};

export type SessionState = "queued" | "running" | "awaiting" | "done" | "failed";

/**
 * `n` e um contador monotonico atribuido no main na hora de emitir. E o que
 * deixa o renderer casar snapshot e evento ao vivo sem duplicar nem perder
 * linha quando os dois chegam quase juntos.
 */
export type SessionEvent =
  /** `cmd` no fim do job diz ao main se a publicacao precisa de --force. */
  | { id: string; kind: "state"; state: SessionState; cmd?: Cmd }
  | { id: string; kind: "log"; level: "info" | "tool" | "error"; text: string; n?: number }
  | { id: string; kind: "assistant"; text: string; n?: number }
  | { id: string; kind: "queue"; jobs: Job[] }
  /** A conta do Claude Code caiu — a UI precisa oferecer o caminho do login. */
  | { id: string; kind: "auth"; text: string };

export type Line = {
  n: number;
  level: "info" | "tool" | "error" | "assistant";
  text: string;
};

/**
 * Estado completo da sessao, servido a quem chega depois.
 * O renderer remonta (troca de aba, reload do Vite) e nao pode perder o log
 * nem o "aguardando voce" — a fonte da verdade e o main, nao o componente.
 */
export type Snapshot = {
  state: SessionState | null;
  lines: Line[];
  queue: Job[];
  /** Conta do Claude Code caiu — o aviso precisa sobreviver a troca de aba. */
  authNeeded: boolean;
};

const AWAITING_MARK = "AGUARDANDO RESPOSTA";

/** Teto do transcript em memoria — um ingest longo nao pode virar vazamento. */
const MAX_LINES = 800;

/**
 * Texto do redo copiado do athena.bat. Nao e enfeite: `athena redo X Y` sozinho
 * tende a "sair igual", porque o modelo enxerga a pagina anterior no disco e a
 * reaproveita — e af regra nova nunca entra. A ordem explicita e o comando.
 */
const REDO_SUFFIX =
  " - REESCREVA a pagina do ZERO lendo o material oficial de novo. NAO reaproveite a versao anterior da pagina, o espelho, nem o historico do git. Siga a ordem em que o professor apresentou o conteudo; informacoes administrativas da disciplina ficam onde ele as apresentou.";

export function buildPrompt(job: Job): string {
  switch (job.cmd) {
    case "ingest":
      return `athena ${job.code} ${job.lesson}`;
    case "redo":
      return `athena ${job.code} ${job.lesson}${REDO_SUFFIX}`;
    case "review":
      return `review ${job.code} ${job.lesson}`;
    case "delete":
      return job.lesson
        ? `athena delete ${job.code} ${job.lesson}`
        : `athena delete ${job.code}`;
  }
}

/**
 * O erro de autenticacao do Claude Code nao e o login do Athena.
 * Sao duas contas diferentes e a mensagem crua nao diz o que fazer.
 */
const AUTH_PATTERNS = [
  /OAuth session expired/i,
  /Failed to authenticate/i,
  /Please run .?\/?login/i,
  /not logged in/i,
  /Invalid API key/i,
];

export function isAuthFailure(text: string): boolean {
  return AUTH_PATTERNS.some((re) => re.test(text));
}

export const AUTH_HELP =
  "Sua sessao do Claude Code expirou — isto NAO e o login do Athena (Supabase). " +
  "Abra o terminal, rode `claude`, faca o /login na conta Pro e tente de novo. " +
  "O botao abaixo abre um terminal ja no comando certo.";

/**
 * Uma sessao por vez. O .ingest-status e um arquivo unico na raiz do vault:
 * dois comandos simultaneos sobrescrevem o veredito um do outro e corrompem
 * o espelho. A fila e a protecao contra isso.
 */
export class ClaudeRunner extends EventEmitter {
  private queue: Job[] = [];
  private active: { job: Job; proc: ChildProcessWithoutNullStreams } | null = null;
  private buffer = "";
  private lines: Line[] = [];
  private state: SessionState | null = null;
  private seq = 0;
  private authWarned = false;

  constructor(
    private vaultRoot: string,
    private claudeBin: string,
  ) {
    super();
  }

  get activeJobId(): string | null {
    return this.active?.job.id ?? null;
  }

  get pending(): Job[] {
    return [...this.queue];
  }

  get busy(): boolean {
    return !!this.active;
  }

  /** O que um painel recem-montado precisa para se reconstituir inteiro. */
  snapshot(): Snapshot {
    return {
      state: this.state,
      lines: [...this.lines],
      queue: this.pending,
      authNeeded: this.authWarned,
    };
  }

  /**
   * Esvazia o transcript, sem tocar no estado nem no `seq`.
   *
   * O contador continua de onde estava de proposito: o renderer casa snapshot
   * e evento ao vivo por `n`, e reiniciar do zero faria linha nova colidir com
   * linha antiga que ainda estivesse na tela de outro painel.
   */
  limpar(): void {
    this.lines = [];
  }

  enqueue(cmd: Cmd, code: string, lesson: string | null): Job {
    const job: Job = {
      id: randomUUID(),
      cmd,
      code,
      lesson,
      label: buildPrompt({ id: "", cmd, code, lesson, label: "" }),
    };
    this.queue.push(job);
    this.emitEvent({ id: job.id, kind: "state", state: "queued" });
    this.emitEvent({ id: job.id, kind: "queue", jobs: this.pending });
    this.pump();
    return job;
  }

  /** Responde a uma pergunta do Claude sem relancar o binario. */
  reply(text: string): void {
    if (!this.active) throw new Error("Nenhuma sessao ativa para responder.");
    const msg = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    };
    this.active.proc.stdin.write(JSON.stringify(msg) + "\n");
    // A resposta entra no transcript do main: se o painel remontar, ela continua la.
    this.emitEvent({ id: this.active.job.id, kind: "log", level: "info", text: `< ${text}` });
    this.emitEvent({ id: this.active.job.id, kind: "state", state: "running" });
  }

  cancel(): void {
    if (!this.active) return;
    const proc = this.active.proc;
    // No Windows o spawn com shell:true cria um cmd.exe intermediario: matar o
    // pai deixaria o claude vivo escrevendo arquivos. /T derruba a arvore toda.
    if (process.platform === "win32" && proc.pid) {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
    } else {
      proc.kill();
    }
  }

  private emitEvent(e: SessionEvent) {
    if (e.kind === "log") {
      e.n = ++this.seq;
      this.record({ n: e.n, level: e.level, text: e.text });
    } else if (e.kind === "assistant") {
      e.n = ++this.seq;
      this.record({ n: e.n, level: "assistant", text: e.text });
    } else if (e.kind === "state") {
      this.state = e.state;
    }
    this.emit("event", e);
  }

  private record(line: Line) {
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES);
    }
  }

  private pump() {
    if (this.active || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.emitEvent({ id: job.id, kind: "queue", jobs: this.pending });
    this.run(job);
  }

  /**
   * Zera o veredito antes de comecar — igual ao athena.bat.
   *
   * Sem isto, um `OK` de meia hora atras sobrevive a um ingest que falhou
   * no meio, e o botao Publicar libera a publicacao de conteudo pela metade.
   * O caminho em athena-web/ tambem some: o ingest as vezes grava o status
   * relativo depois de mudar de diretorio, e o arquivo perdido la engana.
   */
  private clearStatus() {
    for (const p of [
      path.join(this.vaultRoot, ".ingest-status"),
      path.join(this.vaultRoot, "athena-web", ".ingest-status"),
    ]) {
      try {
        fs.rmSync(p, { force: true });
      } catch {
        // arquivo travado/ausente nao impede o comando de rodar
      }
    }
  }

  private run(job: Job) {
    this.clearStatus();

    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      // Mesmo modo do athena.bat. Com acceptEdits, so a ESCRITA de arquivo e
      // liberada: o passo 6 do CLAUDE.md copia o PDF para public/materials/
      // por comando de shell, e a sessao ficaria pendurada esperando um
      // "pode?" que ninguem responde no modo -p.
      "--permission-mode",
      "bypassPermissions",
    ];

    const proc = spawn(this.claudeBin, args, {
      // cwd na raiz do vault e obrigatorio: e assim que o Claude Code
      // encontra o CLAUDE.md e passa a conhecer as regras do Athena.
      cwd: this.vaultRoot,
      shell: process.platform === "win32",
    }) as ChildProcessWithoutNullStreams;

    this.active = { job, proc };
    this.buffer = "";
    this.authWarned = false;
    this.emitEvent({ id: job.id, kind: "state", state: "running" });
    this.emitEvent({ id: job.id, kind: "log", level: "info", text: `> ${job.label}` });

    const first = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: buildPrompt(job) }],
      },
    };
    proc.stdin.write(JSON.stringify(first) + "\n");

    proc.stdout.on("data", (chunk: Buffer) => this.onStdout(job, chunk));
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      this.emitEvent({ id: job.id, kind: "log", level: "error", text });
      this.checkAuth(job, text);
    });

    proc.on("error", (err) => {
      this.emitEvent({
        id: job.id,
        kind: "log",
        level: "error",
        text:
          `Nao consegui executar "${this.claudeBin}". ` +
          `Aponte o caminho do Claude Code em Ajustes. (${err.message})`,
      });
      this.finish(job, "failed");
    });

    proc.on("close", (code) => {
      if (this.active?.job.id !== job.id) return;
      this.finish(job, code === 0 ? "done" : "failed");
    });
  }

  private onStdout(job: Job, chunk: Buffer) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: any;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        // Erro de autenticacao vem como texto solto, fora do stream-json.
        this.emitEvent({ id: job.id, kind: "log", level: "info", text: trimmed });
        this.checkAuth(job, trimmed);
        continue;
      }
      this.handleMessage(job, msg);
    }
  }

  /** Emite o aviso de login uma vez por job — a mensagem repete no stream. */
  private checkAuth(job: Job, text: string) {
    if (this.authWarned || !isAuthFailure(text)) return;
    this.authWarned = true;
    this.emitEvent({ id: job.id, kind: "auth", text: AUTH_HELP });
    this.emitEvent({ id: job.id, kind: "log", level: "error", text: AUTH_HELP });
  }

  private handleMessage(job: Job, msg: any) {
    if (msg.type === "result" && typeof msg.result === "string") {
      this.checkAuth(job, msg.result);
    }
    if (msg.type === "system" && msg.subtype === "init") {
      this.emitEvent({
        id: job.id,
        kind: "log",
        level: "info",
        text: `sessao iniciada (${msg.model ?? "modelo padrao"})`,
      });
      return;
    }

    if (msg.type === "assistant") {
      const blocks = msg.message?.content ?? [];
      for (const b of blocks) {
        if (b.type === "text" && b.text?.trim()) {
          this.emitEvent({ id: job.id, kind: "assistant", text: b.text });
        } else if (b.type === "tool_use") {
          this.emitEvent({
            id: job.id,
            kind: "log",
            level: "tool",
            text: describeTool(b),
          });
        }
      }
      return;
    }

    if (msg.type === "result") {
      const text: string = msg.result ?? "";
      if (text.includes(AWAITING_MARK)) {
        // Nao e erro: o fluxo parou para perguntar. Mantem o processo vivo.
        this.emitEvent({ id: job.id, kind: "state", state: "awaiting" });
        return;
      }
      this.active?.proc.stdin.end();
    }
  }

  private finish(job: Job, state: SessionState) {
    this.emitEvent({ id: job.id, kind: "state", state, cmd: job.cmd });
    this.active = null;
    this.pump();
  }

  /**
   * Linha vinda de fora (publish, pull). Entra no mesmo transcript de proposito:
   * o usuario olha um painel so para saber o que esta acontecendo, e o passo
   * [2/2] do athena.bat sempre foi parte da mesma operacao.
   */
  log(text: string, level: "info" | "tool" | "error" = "info") {
    this.emitEvent({ id: this.active?.job.id ?? "externo", kind: "log", level, text });
  }
}

function describeTool(block: any): string {
  const name = block.name ?? "tool";
  const input = block.input ?? {};
  if (name === "Bash" && input.command) return `bash: ${input.command}`;
  if (input.file_path) return `${name}: ${input.file_path}`;
  if (input.path) return `${name}: ${input.path}`;
  return name;
}
