import { useEffect, useState } from "react";
import { api, mensagemDeErro, type Account, type IngestStatus } from "../lib/api";
import { t } from "../lib/i18n";

/**
 * Publicar = Supabase + R2, nao git.
 *
 * O painel antigo fazia `git add . && git commit && git push`. Desde
 * 2026-08-02 isso nao publica nada: `Notes/` e `Resumos/` estao no .gitignore do
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
  const [autoPull, setAutoPull] = useState(true);
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
    api.publish.autoPull().then(setAutoPull).catch(() => {});
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

  /**
   * Ultima linha do script enquanto ele roda.
   *
   * Publish e pull demoram (R2, rede) e antes o unico sinal era o texto do
   * botao virando "Publicando…". Uma barra parada nao diz se ainda esta vivo;
   * a linha que o script acabou de imprimir diz.
   */
  const [ultimaLinha, setUltimaLinha] = useState("");
  useEffect(
    () =>
      api.publish.onLine((l) => {
        const linha = l.trim();
        if (linha) setUltimaLinha(linha);
      }),
    [],
  );
  useEffect(() => {
    if (running) setUltimaLinha("");
  }, [running]);

  async function run(name: "publish" | "pull", flags: string[] = []) {
    setResult(null);
    setForcavel(null);
    const r = await api.publish.run(name, flags);
    setResult(r.output.trim() || (r.ok ? t("Concluído.") : t("Falhou sem mensagem.")));
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
  /** Offline: os dois falariam com a rede, entao nem oferecem o clique. */
  const offline = account?.offline === true;
  const canPublish = status === "OK" && !!account && !offline && !busy && tools.publish;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span className="label">{t("Publicar")}</span>
        <span
          style={{
            fontSize: 12,
            color: status === "OK" ? "#1d9e75" : status === "FAIL" ? "#e24b4a" : "var(--c-muted)",
          }}
        >
          {status === "OK"
            ? t("último comando terminou bem")
            : status === "FAIL"
              ? t("o último comando não concluiu")
              : t("nenhum comando executado nesta máquina")}
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 14, flexWrap: "wrap" }}>
          <label
            className="opcao"
            title={t("Puxa do banco uma vez na abertura do app. Sem --force: nunca sobrescreve nem apaga.")}
          >
            <input
              type="checkbox"
              checked={autoPull}
              onChange={(e) => {
                setAutoPull(e.target.checked);
                api.publish.autoPull(e.target.checked);
              }}
            />
            {t("puxar ao abrir")}
          </label>
          <label
            className="opcao"
            title={t("Igual ao passo [2/2] do athena.bat: terminou com OK, vai pro banco")}
          >
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                api.publish.autoPublish(e.target.checked);
              }}
            />
            {t("publicar ao terminar")}
          </label>
        </div>
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
          <span style={{ color: "var(--c-muted)" }}>{t("verificando a conta…")}</span>
        ) : account ? (
          <>
            <span style={{ color: "var(--c-muted)" }}>{t("publicando como")}</span>
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
              {t("sair")}
            </button>
          </>
        ) : (
          <>
            <span style={{ color: "#ba7517" }}>
              {t("sem conta nesta máquina — o conteúdo não sai do disco")}
            </span>
            <button
              className="btn"
              style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}
              onClick={() => setShowLogin((s) => !s)}
            >
              {t("entrar")}
            </button>
          </>
        )}
      </div>

      {showLogin && !account && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>
            {t("Mesma conta do ")}
            <code>athena login</code>
            {t(". A senha não é gravada — fica só o token de renovação em ")}
            <code>.athena/session.json</code>.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="field"
              placeholder={t("E-mail")}
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="field"
              type="password"
              placeholder={t("Senha")}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doLogin()}
            />
            <button className="btn btn-primary" onClick={doLogin} disabled={!email || !password}>
              {t("Entrar")}
            </button>
          </div>
          {loginError && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{loginError}</p>}
        </div>
      )}

      {/* Enquanto roda: barra listrada (nao ha porcentagem para ler) + a linha
          mais recente do script, que e o que prova que ainda esta andando. */}
      {busy && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
            <span style={{ fontSize: 12 }}>
              {running === "publish" ? t("Publicando no Supabase e no R2…") : t("Puxando do banco…")}
            </span>
            <span
              className="truncar"
              style={{ marginLeft: "auto", maxWidth: "60%", fontSize: 11, color: "var(--c-muted)" }}
              title={ultimaLinha}
            >
              {ultimaLinha}
            </span>
          </div>
          <div className="barra">
            <div className="barra-cheio barra-indeterminada" />
          </div>
        </div>
      )}

      {/* ---- ações ---- */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" disabled={!canPublish} onClick={() => run("publish")}>
          {running === "publish" ? t("Publicando…") : t("Publicar")}
        </button>
        <button
          className="btn"
          disabled={busy || !account || offline || !tools.pull}
          onClick={() => run("pull")}
          title={
            offline
              ? t("Sem conexão — o pull precisa do banco")
              : t("Traz do banco e do R2 para este disco — rode ao sentar na outra máquina")
          }
        >
          {running === "pull" ? t("Puxando…") : t("Puxar do banco")}
        </button>

        {/* FAIL nao pode ser prisao perpetua.
            O `.ingest-status` guarda o veredito do ULTIMO comando, e so dele.
            Se o terceiro ingest falhou, os dois que deram certo antes ja estao
            no disco, prontos e bloqueados por um FAIL que nao e sobre eles.
            O botao continua fora do caminho feliz — e uma escolha explicita,
            com o motivo escrito ao lado. */}
        {status === "FAIL" && !!account && !offline && tools.publish && (
          <button
            className="btn"
            disabled={busy}
            onClick={() => run("publish")}
            title={
              t("Publica o que está no disco, ignorando o FAIL do último comando.") +
              "\n" +
              t("Risco: publicar uma página que o comando não terminou de escrever.")
            }
          >
            {t("Publicar assim mesmo")}
          </button>
        )}

        {/* Aparece só quando o próprio script pediu --force na saída. */}
        {forcavel === "publish" && (
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => run("publish", ["--force"])}
            title={t("O publish parou por desproporção. Só use se este disco realmente é a versão certa.")}
          >
            {t("Publicar mesmo assim (--force)")}
          </button>
        )}
        {forcavel === "pull" && (
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={() => run("pull", ["--force"])}
            title={t("Deixa o disco idêntico ao banco: apaga o que existe só aqui. Nada vai para a lixeira.")}
          >
            {t("Puxar mesmo assim (--force)")}
          </button>
        )}
      </div>

      {!tools.publish && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#e24b4a" }}>
          {t("Não achei ")}
          <code>athena-web/scripts/athena-publish.mjs</code>
          {t(" no vault — é ele que leva o conteúdo para o banco.")}
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
