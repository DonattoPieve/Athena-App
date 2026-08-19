import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { publicar } from "./publicar";
import { baixarTudo } from "./bootstrap";

/**
 * Publicacao — o caminho do conteudo para o site.
 *
 * NAO e git. Desde 2026-08-02 `Notes/` e `Resumos/` estao no .gitignore do vault:
 * o repositorio guarda o codigo do athena-web, e o conteudo viaja pelo
 * Supabase (texto) e pelo Cloudflare R2 (PDF, PPT, imagem). Quem faz isso e
 * `athena-web/scripts/athena-publish.mjs`, o mesmo script que o athena.bat
 * chama no passo [2/2].
 *
 * DOIS CAMINHOS, e a ordem importa:
 *
 * 1. Se o vault tem os scripts (`athena-web/` clonado, Node instalado), roda
 *    ELES. E o caminho testado ha meses, o mesmo do `athena.bat`, e continua
 *    valendo igual pelo terminal e por aqui.
 *
 * 2. Se nao tem, usa a implementacao de dentro do app (`publicar.ts` e
 *    `bootstrap.ts`). Um PC que so instalou o .exe nao tem `athena-web` nem
 *    Node — e sem isto publicar seria impossivel la, que era exatamente o
 *    buraco: dava pra ler, escrever nota e gerar pagina, mas nao devolver
 *    nada pro banco.
 *
 * As duas metades falam com o MESMO banco e o MESMO bucket, com as mesmas
 * regras (guarda contra maquina desatualizada, remocao de orfaos, envio
 * incremental). A diferenca e so quem executa.
 */

export type ScriptName = "publish" | "pull";

const SCRIPTS: Record<ScriptName, string> = {
  publish: path.join("athena-web", "scripts", "athena-publish.mjs"),
  pull: path.join("athena-web", "scripts", "athena-pull.mjs"),
};

export type RunResult = { code: number; output: string };

/**
 * O mesmo trabalho, sem o script e sem Node — a implementacao que mora no app.
 *
 * `--force` e `--dry-run` nao existem aqui de proposito: as duas so fazem
 * sentido com alguem lendo a saida e decidindo, e a versao de dentro do app
 * nunca sobrescreve nem apaga arquivo do disco. Avisar e melhor que ignorar em
 * silencio — quem pediu `--force` esperava algo que nao vai acontecer.
 */
async function interno(
  vaultRoot: string,
  name: ScriptName,
  flags: string[],
  onLine: (text: string) => void,
): Promise<RunResult> {
  const linhas: string[] = [];
  const registrar = (t: string) => {
    linhas.push(t);
    onLine(t);
  };

  if (flags.length) {
    registrar(
      `(${flags.join(" ")} so existe no script do vault; aqui vale a regra de sempre: ` +
        `nunca sobrescrever nem apagar o que esta no disco.)`,
    );
  }

  try {
    if (name === "publish") {
      const r = await publicar(vaultRoot, registrar);
      if (!r.ok && r.erro) registrar(r.erro);
      return { code: r.ok ? 0 : 1, output: linhas.join("\n") };
    }
    const r = await baixarTudo(vaultRoot, registrar);
    registrar(
      `${r.criados} arquivo(s) criado(s), ${r.iguais} ja igual(is)` +
        (r.conflitos.length ? `, ${r.conflitos.length} conflito(s).` : "."),
    );
    return { code: 0, output: linhas.join("\n") };
  } catch (e) {
    const msg = (e as Error).message;
    registrar(msg);
    return { code: 1, output: linhas.join("\n") };
  }
}

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
  if (!scriptExists(vaultRoot, name)) return interno(vaultRoot, name, flags, onLine);

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
