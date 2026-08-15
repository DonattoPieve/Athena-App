import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

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
  | { id: string; kind: "state"; state: SessionState }
  | { id: string; kind: "log"; level: "info" | "tool" | "error"; text: string; n?: number }
  | { id: string; kind: "assistant"; text: string; n?: number }
  | { id: string; kind: "queue"; jobs: Job[] };

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
};

const AWAITING_MARK = "AGUARDANDO RESPOSTA";

/** Teto do transcript em memoria — um ingest longo nao pode virar vazamento. */
const MAX_LINES = 800;

export function buildPrompt(job: Job): string {
  switch (job.cmd) {
    case "ingest":
      return `athena ${job.code} ${job.lesson}`;
    case "redo":
      return `athena redo ${job.code} ${job.lesson}`;
    case "review":
      return `athena review ${job.code} ${job.lesson}`;
    case "delete":
      return job.lesson
        ? `athena delete ${job.code} ${job.lesson}`
        : `athena delete ${job.code}`;
  }
}

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
    return { state: this.state, lines: [...this.lines], queue: this.pending };
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

  private run(job: Job) {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      // O vault e confiavel e o fluxo do CLAUDE.md escreve arquivos e roda
      // npm run build. Sem isso a sessao trava esperando aprovacao.
      "--permission-mode",
      "acceptEdits",
    ];

    const proc = spawn(this.claudeBin, args, {
      // cwd na raiz do vault e obrigatorio: e assim que o Claude Code
      // encontra o CLAUDE.md e passa a conhecer as regras do Athena.
      cwd: this.vaultRoot,
      shell: process.platform === "win32",
    }) as ChildProcessWithoutNullStreams;

    this.active = { job, proc };
    this.buffer = "";
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
    proc.stderr.on("data", (chunk: Buffer) =>
      this.emitEvent({
        id: job.id,
        kind: "log",
        level: "error",
        text: chunk.toString(),
      }),
    );

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
        this.emitEvent({ id: job.id, kind: "log", level: "info", text: trimmed });
        continue;
      }
      this.handleMessage(job, msg);
    }
  }

  private handleMessage(job: Job, msg: any) {
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
    this.emitEvent({ id: job.id, kind: "state", state });
    this.active = null;
    this.pump();
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
