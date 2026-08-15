import { useEffect, useState } from "react";
import { api, mensagemDeErro, type Account, type IngestStatus } from "../lib/api";

/**
 * Publicar = Supabase + R2, nao git.
 *
 * O painel antigo fazia `git add . && git commit && git push`. Desde
 * 2026-08-02 isso nao publica nada: `raw/` e `wiki/` estao no .gitignore do
 * vault e o conteudo viaja pelo banco. O botao dizia "publicado" e o site
 * ficava igual — o pior tipo de bug, o que parece ter funcionado.
 *
 * A guarda continua a mesma do athena.bat: sem `OK` no `.ingest-status`,
 * nada sai daqui.
 */
export function PublishPanel({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<IngestStatus>("NONE");
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  /** Qual comando pediu --force na ultima saida, se algum. */
  const [forcavel, setForcavel] = useState<"publish" | "pull" | null>(null);
  const [auto, setAuto] = useState(true);
  const [tools, setTools] = useState({ publish: true, pull: true });

  // login
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    api.status.get().then(setStatus);
    api.publish.available().then(setTools).catch(() => {});
    api.publish.autoPublish().then(setAuto).catch(() => {});
  }, [refreshKey]);

  useEffect(() => api.status.onChange(setStatus), []);

  useEffect(() => {
    let alive = true;
    setChecking(true);
    api.account
      .status()
      .then((a) => alive && setAccount(a))
      .catch(() => alive && setAccount(null))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  useEffect(() => api.publish.onState((s) => setRunning(s.running ? s.name : null)), []);

  async function run(name: "publish" | "pull", flags: string[] = []) {
    setResult(null);
    setForcavel(null);
    const r = await api.publish.run(name, flags);
    setResult(r.output.trim() || (r.ok ? "Concluído." : "Falhou sem mensagem."));
    setForcavel(r.canForce ? name : null);
  }

  async function doLogin() {
    setLoginError(null);
    try {
      const a = await api.account.login(email.trim(), password);
      setAccount(a);
      setPassword("");
      setShowLogin(false);
    } catch (e) {
      setLoginError(mensagemDeErro(e));
    }
  }

  const busy = running !== null;
  const canPublish = status === "OK" && !!account && !busy && tools.publish;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span className="label">Publicar</span>
        <span
          style={{
            fontSize: 12,
            color: status === "OK" ? "#1d9e75" : status === "FAIL" ? "#e24b4a" : "var(--c-muted)",
          }}
        >
          {status === "OK"
            ? "último comando terminou bem"
            : status === "FAIL"
              ? "último comando não concluiu — publicação bloqueada"
              : "nenhum comando executado nesta máquina"}
        </span>

        <label
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--c-muted)",
            cursor: "pointer",
          }}
          title="Igual ao passo [2/2] do athena.bat: terminou com OK, vai pro banco"
        >
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              api.publish.autoPublish(e.target.checked);
            }}
          />
          publicar ao terminar
        </label>
      </div>

      {/* ---- conta ---- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          marginBottom: 12,
          border: "1px solid var(--c-border)",
          borderRadius: "var(--r-lg)",
          background: "var(--c-surface)",
          fontSize: 12,
        }}
      >
        {checking ? (
          <span style={{ color: "var(--c-muted)" }}>verificando a conta…</span>
        ) : account ? (
          <>
            <span style={{ color: "var(--c-muted)" }}>publicando como</span>
            <strong>{account.name}</strong>
            <span style={{ color: "var(--c-muted)" }}>{account.email}</span>
            <button
              className="btn"
              style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}
              onClick={async () => {
                await api.account.logout();
                setAccount(null);
              }}
            >
              sair
            </button>
          </>
        ) : (
          <>
            <span style={{ color: "#ba7517" }}>
              sem conta nesta máquina — o conteúdo não sai do disco
            </span>
            <button
              className="btn"
              style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}
              onClick={() => setShowLogin((s) => !s)}
            >
              entrar
            </button>
          </>
        )}
      </div>

      {showLogin && !account && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>
            Mesma conta do <code>athena login</code>. A senha não é gravada — fica só o token de
            renovação em <code>.athena/session.json</code>.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="field"
              placeholder="E-mail"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="field"
              type="password"
              placeholder="Senha"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
            />
            <button className="btn btn-primary" onClick={doLogin} disabled={!email || !password}>
              Entrar
            </button>
          </div>
          {loginError && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{loginError}</p>}
        </div>
      )}

      {/* ---- ações ---- */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={!canPublish} onClick={() => run("publish")}>
          {running === "publish" ? "Publicando…" : "Publicar"}
        </button>
        <button
          className="btn"
          disabled={busy || !account || !tools.pull}
          onClick={() => run("pull")}
          title="Traz do banco e do R2 para este disco — rode ao sentar na outra máquina"
        >
          {running === "pull" ? "Puxando…" : "Puxar do banco"}
        </button>

        {/* Aparece só quando o próprio script pediu --force na saída. */}
        {forcavel === "publish" && (
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => run("publish", ["--force"])}
            title="O publish parou por desproporção. Só use se este disco realmente é a versão certa."
          >
            Publicar mesmo assim (--force)
          </button>
        )}
        {forcavel === "pull" && (
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => run("pull", ["--force"])}
            title="Deixa o disco idêntico ao banco: apaga o que existe só aqui. Nada vai para a lixeira."
          >
            Puxar mesmo assim (--force)
          </button>
        )}
      </div>

      {!tools.publish && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#e24b4a" }}>
          Não achei <code>athena-web/scripts/athena-publish.mjs</code> no vault — é ele que leva o
          conteúdo para o banco.
        </p>
      )}

      {result && (
        <pre className="term scroll" style={{ marginTop: 12, maxHeight: 220 }}>
          {result}
        </pre>
      )}
    </div>
  );
}
