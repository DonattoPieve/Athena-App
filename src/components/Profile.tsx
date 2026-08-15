import { useState } from "react";
import { api, mensagemDeErro, type Account } from "../lib/api";

/**
 * Perfil da conta do Supabase: nome, e-mail, senha e sair.
 *
 * Trocar e-mail costuma exigir confirmação no endereço NOVO — até lá o antigo
 * continua valendo. A tela diz isso em vez de fingir que já mudou.
 */
export function Profile({ conta, onSaiu }: { conta: Account; onSaiu: () => void }) {
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
          ? "Confirme no e-mail novo para a troca valer. Até lá, o antigo continua."
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

  const senhaOk = senha.length >= 6 && senha === senha2;

  return (
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="label">Perfil</span>
        <strong style={{ fontSize: 13 }}>{conta.name}</strong>
        <span style={{ fontSize: 12, color: "var(--c-muted)" }}>{conta.email}</span>
        <button
          className="btn"
          style={{ marginLeft: "auto" }}
          onClick={async () => {
            await api.account.logout();
            onSaiu();
          }}
        >
          Sair
        </button>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Nome</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" value={nome} onChange={(e) => setNome(e.target.value)} />
          <button
            className="btn"
            disabled={ocupado || !nome.trim() || nome === conta.name}
            onClick={() => aplicar({ nome: nome.trim() }, "nome atualizado")}
          >
            Salvar
          </button>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>E-mail</strong>
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
            onClick={() => aplicar({ email: email.trim() }, "e-mail atualizado")}
          >
            Trocar
          </button>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>Senha</strong>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            placeholder="Nova senha (mínimo 6)"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            placeholder="Repita"
            value={senha2}
            onChange={(e) => setSenha2(e.target.value)}
          />
          <button
            className="btn"
            disabled={ocupado || !senhaOk}
            onClick={() => aplicar({ password: senha }, "senha trocada")}
          >
            Trocar
          </button>
        </div>
        {senha && senha2 && senha !== senha2 && (
          <p style={{ margin: 0, fontSize: 11.5, color: "#ba7517" }}>As duas senhas não batem.</p>
        )}
      </section>

      {erro && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
      {aviso && <p style={{ margin: 0, color: "#1d9e75", fontSize: 12 }}>{aviso}</p>}

      <p style={{ margin: 0, fontSize: 11, color: "var(--c-muted)" }}>
        Sair apaga a sessão desta máquina (<code>.athena/session.json</code>) — o mesmo efeito de{" "}
        <code>athena logout</code>. O conteúdo no disco não é tocado.
      </p>
    </div>
  );
}
