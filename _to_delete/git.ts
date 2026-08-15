import { spawn } from "node:child_process";

export type GitChange = { status: string; file: string };

export type GitSummary = {
  branch: string;
  changes: GitChange[];
  diffstat: string;
  ahead: number;
};

function run(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("git", args, { cwd, shell: process.platform === "win32" });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error(err.trim() || `git ${args[0]} falhou`)),
    );
  });
}

export async function summary(cwd: string): Promise<GitSummary> {
  const branch = (await run(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const porcelain = await run(cwd, ["status", "--porcelain"]);
  const changes: GitChange[] = porcelain
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "?",
      file: line.slice(3).trim(),
    }));

  let diffstat = "";
  try {
    diffstat = await run(cwd, ["diff", "--stat", "HEAD"]);
  } catch {
    diffstat = "";
  }

  let ahead = 0;
  try {
    const counts = await run(cwd, [
      "rev-list",
      "--left-right",
      "--count",
      `${branch}...origin/${branch}`,
    ]);
    ahead = Number(counts.trim().split(/\s+/)[0] ?? 0);
  } catch {
    ahead = 0;
  }

  return { branch, changes, diffstat, ahead };
}

export async function publish(cwd: string, message: string): Promise<string> {
  const log: string[] = [];
  log.push(await run(cwd, ["add", "."]));
  try {
    log.push(await run(cwd, ["commit", "-m", message]));
  } catch (e) {
    // Nada para commitar nao e falha: pode haver commit pendente de push.
    log.push(String((e as Error).message));
  }
  log.push(await run(cwd, ["push"]));
  return log.filter(Boolean).join("\n");
}
