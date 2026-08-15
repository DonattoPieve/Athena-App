import { spawn, ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

/**
 * Terminal do app.
 *
 * NÃO é um TTY: cada comando roda num shell próprio (`powershell -Command`),
 * com a raiz do vault como diretório, e a saída volta em pedaços. Isso cobre o
 * uso real daqui — `athena publish`, `git status`, `npm run build` — sem a
 * dependência nativa que um terminal de verdade (node-pty) exigiria, que
 * precisa ser recompilada a cada versão do Electron.
 *
 * A consequência honesta: comando que faz pergunta interativa (um `git commit`
 * que abre editor, um prompt de senha) fica esperando resposta que não vem.
 * Por isso existe o botão de interromper.
 */
export type TermEvent =
  | { kind: "out"; text: string }
  | { kind: "err"; text: string }
  | { kind: "exit"; code: number };

export class Terminal extends EventEmitter {
  private proc: ChildProcess | null = null;

  constructor(private cwd: string) {
    super();
  }

  get busy(): boolean {
    return !!this.proc;
  }

  run(comando: string): void {
    if (this.proc) throw new Error("Já há um comando rodando neste terminal.");

    const [cmd, args] =
      process.platform === "win32"
        ? ["powershell.exe", ["-NoLogo", "-NoProfile", "-Command", comando]]
        : ["/bin/sh", ["-c", comando]];

    const proc = spawn(cmd as string, args as string[], { cwd: this.cwd });
    this.proc = proc;

    proc.stdout?.on("data", (c: Buffer) => this.emit("event", { kind: "out", text: c.toString() }));
    proc.stderr?.on("data", (c: Buffer) => this.emit("event", { kind: "err", text: c.toString() }));
    proc.on("error", (e) => this.emit("event", { kind: "err", text: e.message }));
    proc.on("close", (code) => {
      this.proc = null;
      this.emit("event", { kind: "exit", code: code ?? 0 });
    });
  }

  /** Mata a árvore: no Windows o filho real pende do powershell. */
  cancel(): void {
    const proc = this.proc;
    if (!proc) return;
    if (process.platform === "win32" && proc.pid) {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
    } else {
      proc.kill();
    }
  }
}
