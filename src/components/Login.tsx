import { useState } from "react";
import { api, mensagemDeErro, type Account } from "../lib/api";

/**
 * Porta de entrada do app. Autentica no MESMO Supabase do site: e-mail e senha
 * do schema (`auth.users`), sessão gravada em `<vault>/.athena/session.json`
 * no formato do `athena login`. Entrar aqui é entrar no terminal, e vice-versa.
 *
 * Vem depois de escolher o vault, não antes: a URL e a chave publicável saem
 * do `athena-web/.env.local`, que mora dentro do vault.
 *
 * A senha é usada uma vez e descartada — o que fica em disco é o token de
 * renovação. `SERVICE_ROLE` não existe no projeto: o app escreve como usuário
 * normal e apanha do RLS igual a todo mundo.
 */
export function Login({
  vaultPath,
  onEntrou,
  onTrocarVault,
}: {
  vaultPath: string;
  onEntrou: (conta: Account) => void;
  onTrocarVault: () => void;
}) {
  const [modo, setModo] = useState<"entrar" | "criar">("entrar");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const pronto = email.trim().length > 3 && senha.length >= 6;

  async function enviar() {
    if (!pronto || ocupado) return;
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      if (modo === "entrar") {
        onEntrou(await api.account.login(email.trim(), senha));
      } else {
        const conta = await api.account.signUp(email.trim(), senha, nome.trim() || email.trim());
        if (conta) onEntrou(conta);
        else
          setAviso(
            "Conta criada. Confirme o e-mail que o Supabase enviou e depois entre por aqui.",
          );
      }
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
      setSenha("");
    }
  }

  return (
    <div className="login-tela">
      <div className="card login-caixa">
        <div className="hero-brilho" />
        <div style={{ position: "relative" }}>
          <h1 className="hero-titulo" style={{ marginTop: 0 }}>
            <span style={{ color: "var(--c-accent)" }}>Athena</span>
          </h1>
          <p style={{ margin: "0 0 20px", fontSize: 12.5, color: "var(--c-muted)" }}>
            {modo === "entrar"
              ? "Entre com a conta em que o conteúdo é publicado."
              : "Crie a conta que vai ser dona do seu conteúdo."}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {modo === "criar" && (
              <input
                className="field"
                placeholder="Como quer ser chamado"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            )}
            <input
              className="field"
              placeholder="E-mail"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enviar()}
            />
            <input
              className="field"
              type="password"
              placeholder={modo === "criar" ? "Senha (mínimo 6)" : "Senha"}
              autoComplete={modo === "criar" ? "new-password" : "current-password"}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enviar()}
            />

            <button className="btn btn-primary" disabled={!pronto || ocupado} onClick={enviar}>
              {ocupado ? "…" : modo === "entrar" ? "Entrar" : "Criar conta"}
            </button>
          </div>

          {erro && <p style={{ margin: "12px 0 0", color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
          {aviso && <p style={{ margin: "12px 0 0", color: "#1d9e75", fontSize: 12 }}>{aviso}</p>}

          <p style={{ margin: "16px 0 0", fontSize: 11.5, color: "var(--c-muted)" }}>
            {modo === "entrar" ? "Não tem conta? " : "Já tem conta? "}
            <button
              className="link-btn"
              onClick={() => {
                setModo(modo === "entrar" ? "criar" : "entrar");
                setErro(null);
                setAviso(null);
              }}
            >
              {modo === "entrar" ? "criar uma" : "entrar"}
            </button>
          </p>

          <hr style={{ border: "none", borderTop: "1px solid var(--c-border)", margin: "18px 0 12px" }} />

          <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>
            Vault: <code>{vaultPath}</code>
            <button className="link-btn" style={{ marginLeft: 8 }} onClick={onTrocarVault}>
              trocar
            </button>
          </p>
          <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--c-muted)" }}>
            A senha não é gravada. Fica só o token de renovação em{" "}
            <code>.athena/session.json</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
