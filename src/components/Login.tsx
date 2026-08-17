import { useState } from "react";
import { api, mensagemDeErro, type Account } from "../lib/api";
import { IconGitHub, IconGoogle, IconOlho } from "./icons";
import { t } from "../lib/i18n";

/**
 * Porta de entrada do app. Autentica no MESMO Supabase do site: e-mail e senha
 * do schema (`auth.users`), no formato do `athena login` — entrar aqui é
 * entrar no terminal, e vice-versa.
 *
 * Vem ANTES do vault, e não depois: é a conta que decide qual pasta o app
 * abre (ver electron/main.ts, abrirVaultDaConta). Por isso as credenciais do
 * Supabase usadas aqui são as embutidas no app, não as do `.env.local` de
 * dentro de um vault que ainda não existe.
 */
export function Login({ onEntrou }: { onEntrou: (conta: Account) => void }) {
  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [email2, setEmail2] = useState("");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<null | "form" | "github" | "google">(null);

  const criando = modo === "criar";
  const emailBate = !criando || email.trim().toLowerCase() === email2.trim().toLowerCase();
  const senhaBate = !criando || senha === senha2;
  /**
   * De propósito NÃO checa `ocupado` inteiro, só o envio do formulário.
   *
   * Esperar o provedor não pode travar o e-mail e senha: fechar a aba do
   * navegador não avisa o app, então o `await` do OAuth ficava pendurado até o
   * timeout de 3 minutos e, nesse tempo, não dava para entrar de outro jeito.
   */
  const pronto =
    email.trim().length > 3 && senha.length >= 6 && emailBate && senhaBate && ocupado !== "form";

  function limpar() {
    setErro(null);
    setAviso(null);
  }

  async function enviar() {
    if (!pronto) return;
    // Voltar para o e-mail é desistir do provedor — libera a porta local.
    if (ocupado) await api.account.oauthCancel().catch(() => {});
    limpar();
    setOcupado("form");
    try {
      if (modo === "entrar") {
        onEntrou(await api.account.login(email.trim(), senha));
      } else {
        const conta = await api.account.signUp(email.trim(), senha, nome.trim() || email.trim());
        if (conta) onEntrou(conta);
        else
          setAviso(
            t("Conta criada. Confirme o e-mail que o Supabase enviou e depois entre por aqui."),
          );
      }
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(null);
      setSenha("");
      setSenha2("");
    }
  }

  /**
   * O login abre no navegador do sistema e volta num servidor local. Enquanto
   * isso a janela fica esperando — daí o texto de "abri o navegador", senão
   * parece que o botão não fez nada.
   */
  async function porProvedor(provider: "github" | "google") {
    limpar();
    setOcupado(provider);
    setAviso(t("Abri o navegador. Termine o login por lá — ou use o e-mail aqui embaixo."));
    try {
      onEntrou(await api.account.oauth(provider));
    } catch (e) {
      const msg = mensagemDeErro(e);
      // Cancelar é escolha da pessoa, não defeito: não vira mensagem vermelha.
      if (!msg.includes("cancelado")) setErro(msg);
      setAviso(null);
    } finally {
      setOcupado(null);
    }
  }

  async function desistirDoProvedor() {
    await api.account.oauthCancel().catch(() => {});
    setOcupado(null);
    setAviso(null);
  }

  const esperandoProvedor = ocupado === "github" || ocupado === "google";

  const olho = (
    <button
      type="button"
      className="olho"
      title={ver ? t("Esconder a senha") : t("Mostrar a senha")}
      onClick={() => setVer((v) => !v)}
    >
      <IconOlho aberto={ver} />
    </button>
  );

  return (
    <div className="login-tela">
      <div className="card login-caixa">
        <div className="hero-brilho" />
        <div style={{ position: "relative" }}>
          <h1 className="hero-titulo" style={{ marginTop: 0 }}>
            <span style={{ color: "var(--c-accent)" }}>Athena</span>
          </h1>
          <p style={{ margin: "0 0 20px", fontSize: 12.5, color: "var(--c-muted)" }}>
            {criando
              ? t("Crie a conta que vai ser dona do seu conteúdo.")
              : t("Entre com a conta em que o conteúdo é publicado.")}
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn provedor"
              disabled={!!ocupado}
              onClick={() => porProvedor("google")}
            >
              <IconGoogle />
              {ocupado === "google" ? t("aguardando…") : "Google"}
            </button>
            <button
              className="btn provedor"
              disabled={!!ocupado}
              onClick={() => porProvedor("github")}
            >
              <IconGitHub />
              {ocupado === "github" ? t("aguardando…") : "GitHub"}
            </button>
          </div>

          <div className="ou">
            <span>{t("ou com e-mail")}</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {criando && (
              <input
                className="field"
                placeholder={t("Como quer ser chamado")}
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            )}

            <input
              className="field"
              placeholder={t("E-mail")}
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enviar()}
            />
            {criando && (
              <input
                className="field"
                placeholder={t("Confirme o e-mail")}
                autoComplete="off"
                value={email2}
                onChange={(e) => setEmail2(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && enviar()}
              />
            )}

            <div className="campo-senha">
              <input
                className="field"
                type={ver ? "text" : "password"}
                placeholder={criando ? t("Senha (mínimo 6)") : t("Senha")}
                autoComplete={criando ? "new-password" : "current-password"}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && enviar()}
              />
              {olho}
            </div>
            {criando && (
              <div className="campo-senha">
                <input
                  className="field"
                  type={ver ? "text" : "password"}
                  placeholder={t("Confirme a senha")}
                  autoComplete="new-password"
                  value={senha2}
                  onChange={(e) => setSenha2(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && enviar()}
                />
                {olho}
              </div>
            )}

            {criando && email2 && !emailBate && (
              <p className="conferir">{t("Os dois e-mails não batem.")}</p>
            )}
            {criando && senha2 && !senhaBate && (
              <p className="conferir">{t("As duas senhas não batem.")}</p>
            )}

            <button className="btn btn-primary" disabled={!pronto} onClick={enviar}>
              {ocupado === "form" ? "…" : criando ? t("Criar conta") : t("Entrar")}
            </button>
          </div>

          {erro && <p style={{ margin: "12px 0 0", color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
          {aviso && (
            <p style={{ margin: "12px 0 0", color: "#1d9e75", fontSize: 12 }}>
              {aviso}
              {esperandoProvedor && (
                <button className="link-btn" style={{ marginLeft: 8 }} onClick={desistirDoProvedor}>
                  {t("cancelar")}
                </button>
              )}
            </p>
          )}

          <p style={{ margin: "16px 0 0", fontSize: 11.5, color: "var(--c-muted)" }}>
            {criando ? t("Já tem conta? ") : t("Não tem conta? ")}
            <button
              className="link-btn"
              onClick={() => {
                setModo(criando ? "entrar" : "criar");
                setEmail2("");
                setSenha2("");
                limpar();
              }}
            >
              {criando ? t("entrar") : t("criar uma")}
            </button>
          </p>

        </div>
      </div>
    </div>
  );
}
