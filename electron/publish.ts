import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Publicacao — o caminho do conteudo para o site.
 *
 * NAO e git. Desde 2026-08-02 `raw/` e `wiki/` estao no .gitignore do vault:
 * o repositorio guarda o codigo do athena-web, e o conteudo viaja pelo
 * Supabase (texto) e pelo Cloudflare R2 (PDF, PPT, imagem). Quem faz isso e
 * `athena-web/scripts/athena-publish.mjs`, o mesmo script que o athena.bat
 * chama no passo [2/2].
 *
 * O app roda o script do vault em vez de reimplementar o espelho. Toda a
 * inteligencia dificil — guarda contra maquina desatualizada, remocao de
 * orfaos, upload incremental pro R2 — mora la e continua valendo tanto pelo
 * terminal quanto por aqui.
 */

export type ScriptName = "publish" | "pull";

const SCRIPTS: Record<ScriptName, string> = {
  publish: path.join("athena-web", "scripts", "athena-publish.mjs"),
  pull: path.join("athena-web", "scripts", "athena-pull.mjs"),
};

export type RunResult = { code: number; output: string };

export function scriptExists(vaultRoot: string, name: ScriptName): boolean {
  return fs.existsSync(path.join(vaultRoot, SCRIPTS[name]));
}

/**
 * Roda o script no vault e devolve saida + codigo. O `onLine` deixa a UI
 * mostrar o progresso: o publish demora (upload pro R2) e um botao mudo
 * durante trinta segundos parece travado.
 */
export function run(
  vaultRoot: string,
  name: ScriptName,
  flags: string[],
  onLine: (text: string) => void,
): Promise<RunResult> {
  const rel = SCRIPTS[name];
  if (!scriptExists(vaultRoot, name)) {
    return Promise.reject(
      new Error(
        `Nao achei ${rel} no vault. O app publica pelo script do proprio vault — ` +
          `sem ele, nao ha como levar o conteudo pro banco.`,
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const proc = spawn("node", [rel, ...flags], {
      cwd: vaultRoot,
      shell: process.platform === "win32",
    });

    let output = "";
    const feed = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split("\n")) if (line.trim()) onLine(line);
    };

    proc.stdout.on("data", feed);
    proc.stderr.on("data", feed);
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/**
 * Os dois scripts param sozinhos quando a diferenca entre disco e banco parece
 * acidente — o publish por desproporcao, o pull por arquivo que so existe no
 * disco — e ensinam a saida com --force. A UI le a propria mensagem do script
 * para oferecer o botao: repetir a regra a mao sairia do ar no dia em que eles
 * mudarem de ideia.
 */
export function suggestsForce(name: ScriptName, output: string): boolean {
  return new RegExp(`athena ${name} --force`).test(output);
}
