import { useEffect, useState } from "react";
import { api, mensagemDeErro, type ClaudeConta } from "../lib/api";
import { t, idioma, trocarIdioma } from "../lib/i18n";

const PALETAS = ["purple", "cyan", "blue", "matrix", "amber", "pink", "red"] as const;

/**
 * Configurações do app, num lugar só: aparência, vault, caminho do Claude Code
 * e as duas automações (puxar ao abrir, publicar ao terminar).
 *
 * O tema mora no `localStorage` e é aplicado no `<html>` — o mesmo par de
 * atributos que o `index.html` lê antes de o React montar, para a janela não
 * piscar branco na abertura.
 */
export function Settings({
  vaultPath,
  onTrocouVault,
}: {
  vaultPath: string;
  onTrocouVault: () => void;
}) {
  const [tema, setTema] = useState<"dark" | "light">(
    () => (localStorage.getItem("athena-theme") as "dark" | "light") ?? "dark",
  );
  const [paleta, setPaleta] = useState(() => localStorage.getItem("athena-palette") ?? "purple");
  const [claudeBin, setClaudeBin] = useState("");
  const [autoPull, setAutoPull] = useState(true);
  const [autoPublish, setAutoPublish] = useState(true);
  /** null = ainda lendo o arquivo do Claude Code. */
  const [claude, setClaude] = useState<ClaudeConta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    localStorage.setItem("athena-theme", tema);
  }, [tema]);

  useEffect(() => {
    document.documentElement.setAttribute("data-palette", paleta);
    localStorage.setItem("athena-palette", paleta);
  }, [paleta]);

  useEffect(() => {
    api.vault.get().then((v) => setClaudeBin(v.claudeBin));
    api.publish.autoPull().then(setAutoPull).catch(() => {});
    api.publish.autoPublish().then(setAutoPublish).catch(() => {});
    api.claude
      .whoami()
      .then(setClaude)
      .catch(() => setClaude({ email: null, org: null, arquivo: "", existe: false }));
  }, []);

  async function guardar(fn: () => Promise<unknown>, oque: string) {
    setErro(null);
    setSalvo(null);
    try {
      await fn();
      setSalvo(oque);
    } catch (e) {
      setErro(mensagemDeErro(e));
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
      <span className="label">{t("Configurações")}</span>

      {/* ---- aparência ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{t("Aparência")}</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn" data-active={tema === "dark"} onClick={() => setTema("dark")}>
            {t("escuro")}
          </button>
          <button className="btn" data-active={tema === "light"} onClick={() => setTema("light")}>
            {t("claro")}
          </button>
          <button
            className="btn"
            style={{ marginLeft: "auto" }}
            title={t("Volta os ícones da barra lateral para a ordem original")}
            onClick={() => {
              localStorage.removeItem("athena-rail");
              window.location.reload();
            }}
          >
            {t("Restaurar ordem dos ícones")}
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PALETAS.map((p) => (
            <button
              key={p}
              onClick={() => setPaleta(p)}
              title={p}
              data-theme={tema}
              data-palette={p}
              style={{
                width: 34,
                height: 26,
                borderRadius: "var(--r-md)",
                border: paleta === p ? "2px solid var(--c-text)" : "1px solid var(--c-border)",
                background: "var(--c-accent)",
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      </section>

      {/* ---- idioma ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{t("Idioma")}</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn" data-active={idioma() === "pt"} onClick={() => trocarIdioma("pt")}>
            PT
          </button>
          <button className="btn" data-active={idioma() === "en"} onClick={() => trocarIdioma("en")}>
            EN
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>
          {t("Trocar de idioma recarrega a janela.")}
        </p>
      </section>

      {/* ---- atalhos ----
          Aqui, e nao numa ajuda escondida: atalho que a pessoa nao descobre
          e o mesmo que atalho que nao existe. */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{t("Atalhos")}</strong>
        <div className="atalhos">
          {[
            ["Ctrl", "P", t("abrir uma página da wiki")],
            ["Ctrl", "W", t("fechar a aba (não dispara enquanto você digita)")],
            ["Ctrl+Shift", "P", t("ir para os Comandos")],
            ["Esc", "", t("fechar o que estiver aberto por cima")],
          ].map(([mod, tecla, oque]) => (
            <div key={oque} className="atalho">
              <span>
                <kbd>{mod}</kbd>
                {tecla && (
                  <>
                    {" + "}
                    <kbd>{tecla}</kbd>
                  </>
                )}
              </span>
              <span style={{ color: "var(--c-muted)" }}>{oque}</span>
            </div>
          ))}
        </div>

      </section>

      {/* ---- vault ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Vault</strong>
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--c-muted)" }}>
          <code>{vaultPath}</code>
        </p>
        <div>
          <button
            className="btn"
            title={t("A conta vem de dentro do vault — trocar de pasta pode trocar de conta")}
            onClick={() => guardar(async () => {
              await api.vault.pick();
              onTrocouVault();
            }, t("vault trocado"))}
          >
            {t("Trocar pasta do vault")}
          </button>
        </div>

      </section>

      {/* ---- claude code ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Claude Code</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="field"
            value={claudeBin}
            placeholder="claude"
            title={t("Se o ingest não iniciar: rode where.exe claude e cole o caminho completo")}
            onChange={(e) => setClaudeBin(e.target.value)}
          />
          <button
            className="btn"
            onClick={() => guardar(() => api.config.setClaudeBin(claudeBin.trim() || "claude"), t("caminho salvo"))}
          >
            {t("Salvar")}
          </button>
        </div>

        {/* Quem esta logado no Claude Code — e de quem sao os creditos que o
            ingest gasta. Sem esta linha so dava para descobrir digitando
            /status num terminal. */}
        <div className="quem-claude">
          <span className="label" style={{ margin: 0 }}>
            {t("Conta em uso")}
          </span>
          {claude === null ? (
            <span style={{ fontSize: 12, color: "var(--c-muted)" }}>{t("verificando…")}</span>
          ) : claude.email ? (
            <>
              <strong style={{ fontSize: 12.5 }}>{claude.email}</strong>
              {claude.org && (
                <span style={{ fontSize: 11.5, color: "var(--c-muted)" }}>· {claude.org}</span>
              )}
            </>
          ) : (
            <span style={{ fontSize: 12, color: "#ba7517" }}>
              {claude.existe
                ? t("não reconheci a conta neste arquivo")
                : t("nenhum login do Claude Code nesta máquina")}
            </span>
          )}
          <button
            className="btn"
            style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 11 }}
            onClick={() => api.claude.whoami().then(setClaude)}
          >
            {t("Reler")}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => api.claude.openLogin()}>
            {claude?.email ? t("Trocar de conta do Claude") : t("Entrar no Claude Code")}
          </button>
        </div>
        {claude && !claude.email && (
          <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>
            {t("Li")} <code>{claude.arquivo}</code>. {t("Para a resposta oficial, abra o Claude Code e digite")}{" "}
            <code>/status</code> — {t("este arquivo é dele, e o formato pode mudar sem aviso.")}
          </p>
        )}
        <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>
          {t("A conta do Claude Code é do computador, não do Athena.")}
        </p>
      </section>

      {/* ---- automações ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{t("Automações")}</strong>
        <label className="opcao">
          <input
            type="checkbox"
            checked={autoPull}
            onChange={(e) => {
              setAutoPull(e.target.checked);
              api.publish.autoPull(e.target.checked);
            }}
          />
          {t("puxar do banco ao abrir o app")}
        </label>
        <label className="opcao">
          <input
            type="checkbox"
            checked={autoPublish}
            onChange={(e) => {
              setAutoPublish(e.target.checked);
              api.publish.autoPublish(e.target.checked);
            }}
          />
          {t("publicar quando o comando terminar com OK")}
        </label>
      </section>

      {erro && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
      {salvo && <p style={{ margin: 0, color: "#1d9e75", fontSize: 12 }}>{salvo}</p>}
    </div>
  );
}
