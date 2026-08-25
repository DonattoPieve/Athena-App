import { useEffect, useState, type ReactNode } from "react";
import { api, mensagemDeErro, type ClaudeConta } from "../lib/api";
import { t, tf, idioma, trocarIdioma, type Idioma } from "../lib/i18n";
import "../styles/config.css";

export const PALETAS = ["purple", "cyan", "blue", "matrix", "amber", "pink", "red"] as const;

/**
 * Preferências gravadas pelo main (arquivo de config do Electron) — contrato
 * combinado com quem está mexendo no preload agora. Fica declarado aqui (e
 * não em ../lib/api, que não é meu arquivo) até o tipo migrar para lá.
 */
export type Prefs = {
  formatoData: "DD/MM/YYYY" | "YYYY-MM-DD" | "MM/DD/YYYY";
  formatoHora: "24h" | "12h";
  iniciarComSistema: boolean;
  densidade: "compacta" | "padrao" | "confortavel";
  tamanhoFonte: 12 | 14 | 16 | 18 | 20;
  quebraLinha: boolean;
  confirmarExcluir: boolean;
};

const PREFS_PADRAO: Prefs = {
  formatoData: "DD/MM/YYYY",
  formatoHora: "24h",
  iniciarComSistema: true,
  densidade: "padrao",
  tamanhoFonte: 14,
  quebraLinha: true,
  confirmarExcluir: true,
};

/**
 * `api.config.get/set` (Prefs) e `api.vault.exportar` ainda não existem no
 * preload — outra pessoa está adicionando agora, contra este mesmo contrato.
 * O cast (via `unknown`) deixa o typecheck limpo hoje sem tocar em
 * ../lib/api.ts, que não é meu arquivo; quando o preload alcançar o
 * contrato, isto continua funcionando sem mudança nenhuma.
 */
const configApi = api.config as unknown as {
  get(): Promise<Prefs>;
  set(p: Partial<Prefs>): Promise<Prefs>;
};
const vaultApi = api.vault as unknown as typeof api.vault & {
  exportar(): Promise<string | null>;
};

/**
 * Tema e paleta moram no `localStorage` (o `index.html` lê antes do React
 * montar, pra janela não piscar branco). Um hook só, para as Configurações
 * (aba Aparência) e o Perfil (aba Preferências) lerem/gravarem o MESMO lugar
 * em vez de cada tela guardar uma cópia própria que pode desincronizar.
 */
export function useTemaPaleta() {
  const [tema, setTema] = useState<"dark" | "light">(
    () => (localStorage.getItem("athena-theme") as "dark" | "light") ?? "dark",
  );
  const [paleta, setPaleta] = useState(() => localStorage.getItem("athena-palette") ?? "purple");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tema);
    localStorage.setItem("athena-theme", tema);
  }, [tema]);

  useEffect(() => {
    document.documentElement.setAttribute("data-palette", paleta);
    localStorage.setItem("athena-palette", paleta);
  }, [paleta]);

  return { tema, setTema, paleta, setPaleta };
}

/**
 * `Prefs` num hook só, pelo mesmo motivo do `useTemaPaleta`: Configurações
 * (Geral/Editor) e Perfil (Preferências) não podem cada um inventar seu
 * próprio estado — os dois leem e gravam via `api.config`, que é a fonte
 * única de verdade (o arquivo de config do main).
 */
export function usePrefs() {
  const [prefs, setPrefsState] = useState<Prefs>(PREFS_PADRAO);
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    configApi
      .get()
      .then((p) => setPrefsState(p))
      .catch(() => {})
      .finally(() => setCarregado(true));
  }, []);

  // Tamanho de fonte e densidade refletidos no <html>: mesmo mecanismo do
  // tema/paleta, para as próprias telas de config se pré-visualizarem com o
  // valor salvo assim que ele chega (ou muda).
  useEffect(() => {
    document.documentElement.style.setProperty("--cfg-font-size", `${prefs.tamanhoFonte}px`);
    document.documentElement.setAttribute("data-densidade", prefs.densidade);
  }, [prefs.tamanhoFonte, prefs.densidade]);

  async function salvarPrefs(patch: Partial<Prefs>) {
    const atualizado = await configApi.set(patch);
    setPrefsState(atualizado);
    return atualizado;
  }

  return { prefs, carregado, salvarPrefs };
}

/** Toggle acessível: `<input type="checkbox">` de verdade, só escondido — o
 * trilho desenhado em CSS é decoração por cima, não substitui o controle. */
export function CfgSwitch({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <label className="cfg-switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="cfg-switch-trilho" aria-hidden />
      {children}
    </label>
  );
}

/** Tema (Escuro/Claro) + cor de destaque (as 7 paletas) — usado pela aba
 * Aparência das Configurações e pela aba Preferências do Perfil, sempre nos
 * mesmos `localStorage` via `useTemaPaleta`. */
export function CampoTemaPaleta() {
  const { tema, setTema, paleta, setPaleta } = useTemaPaleta();
  return (
    <div className="cfg-section">
      <span className="cfg-section-titulo">{t("Tema")}</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="btn" data-active={tema === "dark"} onClick={() => setTema("dark")}>
          {t("escuro")}
        </button>
        <button className="btn" data-active={tema === "light"} onClick={() => setTema("light")}>
          {t("claro")}
        </button>
      </div>
      <span className="cfg-section-titulo" style={{ marginTop: 6 }}>
        {t("Cor de destaque")}
      </span>
      <div className="cfg-paletas">
        {PALETAS.map((p) => (
          <button
            key={p}
            className="cfg-paleta"
            data-active={paleta === p}
            data-theme={tema}
            data-palette={p}
            title={p}
            onClick={() => setPaleta(p)}
          />
        ))}
      </div>
    </div>
  );
}

/** Tamanho da fonte + quebra de linha — usado pela aba Editor das
 * Configurações e pela aba Preferências do Perfil, sempre via `usePrefs`. */
export function CampoFonteQuebra() {
  const { prefs, salvarPrefs } = usePrefs();
  const TAMANHOS: Prefs["tamanhoFonte"][] = [12, 14, 16, 18, 20];
  return (
    <>
      <div className="cfg-section">
        <span className="cfg-section-titulo">{t("Tamanho da fonte")}</span>
        <div className="cfg-segmento">
          {TAMANHOS.map((tam) => (
            <button
              key={tam}
              className="btn"
              data-active={prefs.tamanhoFonte === tam}
              onClick={() => salvarPrefs({ tamanhoFonte: tam })}
            >
              {tam}
            </button>
          ))}
        </div>
      </div>
      <div className="cfg-row">
        <span className="cfg-row-titulo">{t("Quebra de linha")}</span>
        <CfgSwitch checked={prefs.quebraLinha} onChange={(v) => salvarPrefs({ quebraLinha: v })} />
      </div>
    </>
  );
}

const ABAS = ["geral", "editor", "aparencia", "ia", "atalhos", "vault", "sobre"] as const;
type Aba = (typeof ABAS)[number];

/**
 * Seção pedida de fora — quem manda é o App (`abrirConfig`).
 *
 * O `n` não é enfeite: pedir a MESMA seção de novo precisa valer. Abrir os
 * atalhos, navegar até Aparência e clicar em "ver atalhos" outra vez manda
 * `atalhos` pela segunda vez, e sem um valor que muda o efeito não roda.
 */
export type PedidoSecao = { aba: SecaoConfig; n: number };
export type SecaoConfig = Aba;

const NOME_ABA: Record<Aba, string> = {
  geral: t("Geral"),
  editor: t("Editor"),
  aparencia: t("Aparência"),
  ia: t("IA & Claude"),
  atalhos: t("Atalhos"),
  vault: t("Vault & Dados"),
  sobre: t("Sobre"),
};

/**
 * Configurações do app: Geral, Editor, Aparência, IA & Claude, Atalhos,
 * Vault & Dados e Sobre, em abas horizontais — a ordem que a barra lateral
 * já anuncia como "Configurações" continua sendo uma tela só, só que agora
 * dividida em vez de uma rolagem infinita de seções.
 */
export function Settings({
  vaultPath,
  onTrocouVault,
  secao,
}: {
  vaultPath: string;
  onTrocouVault: () => void;
  /** Seção a mostrar quando a tela é aberta de fora; ver `PedidoSecao`. */
  secao?: PedidoSecao | null;
}) {
  const [aba, setAba] = useState<Aba>(secao?.aba ?? "geral");

  /**
   * A aba de Configurações continua montada depois de aberta uma vez, com a
   * seção que a pessoa deixou. Sem isto, "Ver todos os atalhos" reabria a
   * última seção vista — e o clique parecia não fazer nada.
   */
  useEffect(() => {
    if (secao) setAba(secao.aba);
    // Só o contador dispara: a seção sozinha nao mudaria em dois pedidos iguais.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secao?.n]);
  const { prefs, salvarPrefs } = usePrefs();
  const [claudeBin, setClaudeBin] = useState("");
  const [autoPull, setAutoPull] = useState(true);
  const [autoPublish, setAutoPublish] = useState(true);
  /** null = ainda lendo o arquivo do Claude Code. */
  const [claude, setClaude] = useState<ClaudeConta | null>(null);
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);

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

  async function exportarTudo() {
    setErro(null);
    setSalvo(null);
    setExportando(true);
    try {
      const caminho = await vaultApi.exportar();
      // null = a pessoa fechou o seletor sem escolher onde salvar — não é erro.
      if (caminho) setSalvo(tf("exportado em {caminho}", { caminho }));
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <span className="label">{t("Configurações")}</span>

      <div className="cfg-tabs" role="tablist">
        {ABAS.map((a) => (
          <button
            key={a}
            role="tab"
            aria-selected={aba === a}
            className="cfg-tab"
            data-active={aba === a}
            onClick={() => setAba(a)}
          >
            {NOME_ABA[a]}
          </button>
        ))}
      </div>

      <div className="cfg-panel">
        {aba === "geral" && (
          <>
            <div className="cfg-section">
              <span className="cfg-section-titulo">{t("Idioma")}</span>
              <select
                className="cfg-select"
                value={idioma()}
                onChange={(e) => trocarIdioma(e.target.value as Idioma)}
              >
                <option value="pt">Português</option>
                <option value="en">English</option>
              </select>
              <p className="cfg-section-dica">{t("Trocar de idioma recarrega a janela.")}</p>
            </div>

            <div className="cfg-row">
              <div className="cfg-row-rotulo">
                <span className="cfg-row-titulo">{t("Iniciar com o sistema")}</span>
              </div>
              <CfgSwitch
                checked={prefs.iniciarComSistema}
                onChange={(v) => salvarPrefs({ iniciarComSistema: v })}
              />
            </div>

            <div className="cfg-row">
              <span className="cfg-row-titulo">{t("Formato de data")}</span>
              <select
                className="cfg-select"
                value={prefs.formatoData}
                onChange={(e) => salvarPrefs({ formatoData: e.target.value as Prefs["formatoData"] })}
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              </select>
            </div>

            <div className="cfg-row">
              <span className="cfg-row-titulo">{t("Formato de hora")}</span>
              <select
                className="cfg-select"
                value={prefs.formatoHora}
                onChange={(e) => salvarPrefs({ formatoHora: e.target.value as Prefs["formatoHora"] })}
              >
                <option value="24h">24h</option>
                <option value="12h">12h</option>
              </select>
            </div>

            <div className="cfg-row">
              <div className="cfg-row-rotulo">
                <span className="cfg-row-titulo">{t("Confirmar antes de excluir")}</span>
              </div>
              <CfgSwitch
                checked={prefs.confirmarExcluir}
                onChange={(v) => salvarPrefs({ confirmarExcluir: v })}
              />
            </div>
          </>
        )}

        {aba === "editor" && (
          <>
            <CampoFonteQuebra />
            <div className="cfg-row">
              <span className="cfg-row-titulo">{t("Densidade da interface")}</span>
              <select
                className="cfg-select"
                value={prefs.densidade}
                onChange={(e) => salvarPrefs({ densidade: e.target.value as Prefs["densidade"] })}
              >
                <option value="compacta">{t("compacta")}</option>
                <option value="padrao">{t("padrão")}</option>
                <option value="confortavel">{t("confortável")}</option>
              </select>
            </div>
          </>
        )}

        {aba === "aparencia" && (
          <>
            <CampoTemaPaleta />
            <div>
              <button
                className="btn"
                title={t("Volta os ícones da barra lateral para a ordem original")}
                onClick={() => {
                  localStorage.removeItem("athena-rail");
                  window.location.reload();
                }}
              >
                {t("Restaurar ordem dos ícones")}
              </button>
            </div>
          </>
        )}

        {aba === "ia" && (
          <>
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
                  onClick={() =>
                    guardar(() => api.config.setClaudeBin(claudeBin.trim() || "claude"), t("caminho salvo"))
                  }
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
          </>
        )}

        {aba === "atalhos" && (
          // Aqui, e nao numa ajuda escondida: atalho que a pessoa nao
          // descobre e o mesmo que atalho que nao existe.
          <div className="atalhos">
            {[
              ["Ctrl", "P", t("abrir uma página da wiki")],
              ["Ctrl", "K", t("buscar em Notes/ e Resumos/, inclusive dentro dos arquivos")],
              ["Ctrl", "N", t("nova nota")],
              ["Ctrl", "W", t("fechar a aba (não dispara enquanto você digita)")],
              ["Ctrl+Shift", "P", t("ir para os Comandos")],
              ["Ctrl+Shift", "I", t("ir para os Comandos, onde fica o ingest")],
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
        )}

        {aba === "vault" && (
          <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <strong style={{ fontSize: 13 }}>Vault</strong>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--c-muted)" }}>
              <code>{vaultPath}</code>
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                title={t("A conta vem de dentro do vault — trocar de pasta pode trocar de conta")}
                onClick={() =>
                  guardar(async () => {
                    // `pick` devolve `{ path: null }` quando a pessoa fecha o
                    // seletor. Recarregar nesse caso jogava o app na Home e
                    // perdia as abas — por um clique em "Cancelar".
                    const { path } = await api.vault.pick();
                    if (path) onTrocouVault();
                  }, t("vault trocado"))
                }
              >
                {t("Trocar pasta do vault")}
              </button>
              <button className="btn" disabled={exportando} onClick={exportarTudo}>
                {exportando ? t("exportando…") : t("Exportar tudo")}
              </button>
            </div>
          </section>
        )}

        {aba === "sobre" && (
          <div className="cfg-sobre">
            <span className="cfg-sobre-logo" aria-hidden>
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 20 12 4l8 16" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8.2 14h7.6" strokeLinecap="round" />
              </svg>
            </span>
            <span className="cfg-sobre-nome">ATHENA</span>
            <span className="cfg-sobre-sub">{t("Seu Segundo Cérebro")}</span>
            {/* "1.0.0" espelha VERSAO em App.tsx (não exportada de lá; App.tsx
                não está na minha lista de arquivos para eu importar dali). */}
            <span className="cfg-sobre-versao">{tf("Versão {v}", { v: "1.0.0" })}</span>
          </div>
        )}
      </div>

      {erro && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
      {salvo && <p style={{ margin: 0, color: "#1d9e75", fontSize: 12 }}>{salvo}</p>}
    </div>
  );
}
