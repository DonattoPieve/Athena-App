import { useEffect, useState } from "react";
import { api, mensagemDeErro } from "../lib/api";

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
      <span className="label">Configurações</span>

      {/* ---- aparência ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Aparência</strong>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn" data-active={tema === "dark"} onClick={() => setTema("dark")}>
            escuro
          </button>
          <button className="btn" data-active={tema === "light"} onClick={() => setTema("light")}>
            claro
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

      {/* ---- vault ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Vault</strong>
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--c-muted)" }}>
          <code>{vaultPath}</code>
        </p>
        <div>
          <button
            className="btn"
            onClick={() => guardar(async () => {
              await api.vault.pick();
              onTrocouVault();
            }, "vault trocado")}
          >
            Trocar pasta do vault
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>
          A conta e as credenciais do Supabase vêm de dentro do vault
          (<code>athena-web/.env.local</code> e <code>.athena/session.json</code>) — trocar de vault
          pode trocar de conta.
        </p>
      </section>

      {/* ---- claude code ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Claude Code</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="field"
            value={claudeBin}
            placeholder="claude"
            onChange={(e) => setClaudeBin(e.target.value)}
          />
          <button
            className="btn"
            onClick={() => guardar(() => api.config.setClaudeBin(claudeBin.trim() || "claude"), "caminho salvo")}
          >
            Salvar
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>
          No Windows o executável é <code>claude.cmd</code> e o PATH do app não é o do terminal. Se
          o ingest não iniciar, rode <code>where.exe claude</code> e cole o caminho completo aqui.
        </p>
      </section>

      {/* ---- automações ---- */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Automações</strong>
        <label className="opcao">
          <input
            type="checkbox"
            checked={autoPull}
            onChange={(e) => {
              setAutoPull(e.target.checked);
              api.publish.autoPull(e.target.checked);
            }}
          />
          puxar do banco ao abrir o app
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
          publicar quando o comando terminar com OK
        </label>
      </section>

      {erro && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
      {salvo && <p style={{ margin: 0, color: "#1d9e75", fontSize: 12 }}>{salvo}</p>}
    </div>
  );
}
