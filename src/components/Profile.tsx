import { useState } from "react";
import { api, mensagemDeErro, type Account } from "../lib/api";
import { Avatar } from "./Avatar";
import { t } from "../lib/i18n";

/**
 * Perfil da conta do Supabase: nome, e-mail, senha e sair.
 *
 * Trocar e-mail costuma exigir confirmação no endereço NOVO — até lá o antigo
 * continua valendo. A tela diz isso em vez de fingir que já mudou.
 */
export function Profile({
  conta,
  onSaiu,
  onConta,
}: {
  conta: Account;
  onSaiu: () => void;
  /** A foto nova precisa subir para o App — a lateral mostra a mesma conta. */
  onConta: (c: Account) => void;
}) {
  const [nome, setNome] = useState(conta.name);
  const [email, setEmail] = useState(conta.email);
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function aplicar(campos: { email?: string; password?: string; nome?: string }, ok: string) {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await api.account.update(campos);
      setAviso(
        r.pendente
          ? t("Confirme no e-mail novo para a troca valer. Até lá, o antigo continua.")
          : ok,
      );
      setSenha("");
      setSenha2("");
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  /** O seletor de arquivo e o upload moram no main; aqui so o resultado. */
  async function foto(fn: () => Promise<Account | null>, ok: string) {
    setErro(null);
    setAviso(null);
    setOcupado(true);
    try {
      const nova = await fn();
      if (nova) {
        onConta(nova);
        setAviso(ok);
      }
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  const senhaOk = senha.length >= 6 && senha === senha2;

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <Avatar conta={conta} tamanho={64} />
        <div style={{ minWidth: 0 }}>
          <strong style={{ fontSize: 14, display: "block" }}>{conta.name}</strong>
          <span style={{ fontSize: 12, color: "var(--c-muted)" }}>{conta.email}</span>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              className="btn"
              style={{ padding: "3px 10px", fontSize: 11 }}
              disabled={ocupado}
              onClick={() => foto(() => api.account.avatarPick(), t("foto atualizada"))}
            >
              {conta.avatarUrl ? t("Trocar foto") : t("Escolher foto")}
            </button>
            {conta.avatarUrl && (
              <button
                className="btn"
                style={{ padding: "3px 10px", fontSize: 11 }}
                disabled={ocupado}
                onClick={() => foto(() => api.account.avatarRemove(), t("foto removida"))}
              >
                {t("Remover")}
              </button>
            )}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--c-muted)" }}>
            {t("PNG, JPG, WEBP ou GIF, até 2 MB.")}
          </p>
        </div>
        <button
          className="btn"
          style={{ marginLeft: "auto" }}
          onClick={async () => {
            await api.account.logout();
            onSaiu();
          }}
        >
          {t("Sair")}
        </button>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{t("Nome")}</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" value={nome} onChange={(e) => setNome(e.target.value)} />
          <button
            className="btn"
            disabled={ocupado || !nome.trim() || nome === conta.name}
            onClick={() => aplicar({ nome: nome.trim() }, t("nome atualizado"))}
          >
            {t("Salvar")}
          </button>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{t("E-mail")}</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="field"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            className="btn"
            disabled={ocupado || !email.includes("@") || email === conta.email}
            onClick={() => aplicar({ email: email.trim() }, t("e-mail atualizado"))}
          >
            {t("Trocar")}
          </button>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{t("Senha")}</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            placeholder={t("Nova senha (mínimo 6)")}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            placeholder={t("Repita")}
            value={senha2}
            onChange={(e) => setSenha2(e.target.value)}
          />
          <button
            className="btn"
            disabled={ocupado || !senhaOk}
            onClick={() => aplicar({ password: senha }, t("senha trocada"))}
          >
            {t("Trocar")}
          </button>
        </div>
        {senha && senha2 && senha !== senha2 && (
          <p style={{ margin: 0, fontSize: 11.5, color: "#ba7517" }}>{t("As duas senhas não batem.")}</p>
        )}
      </section>

      {erro && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
      {aviso && <p style={{ margin: 0, color: "#1d9e75", fontSize: 12 }}>{aviso}</p>}


    </div>
  );
}
