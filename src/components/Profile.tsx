import { useEffect, useState } from "react";
import { api, mensagemDeErro, type Account, type HomeData } from "../lib/api";
import { Avatar } from "./Avatar";
import { t, tf } from "../lib/i18n";
import { CampoFonteQuebra, CampoTemaPaleta } from "./Settings";
import "../styles/config.css";

type Aba = "perfil" | "preferencias" | "atividade";

const ABAS: Aba[] = ["perfil", "preferencias", "atividade"];

const NOME_ABA: Record<Aba, string> = {
  perfil: t("Meu perfil"),
  preferencias: t("Preferências"),
  atividade: t("Atividade"),
};

/**
 * Perfil da conta do Supabase, em abas: Meu perfil (identidade — nome,
 * e-mail, senha, foto), Preferências (as mesmas de Configurações > Aparência
 * e Editor, lendo/gravando o mesmo lugar) e Atividade (o que o log.md do
 * vault registrou, numa linha do tempo).
 *
 * Segurança e Dispositivos ficaram de fora por decisão do dono do projeto:
 * dependeriam de sessão múltipla e 2FA, que este app não tem.
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
  const [aba, setAba] = useState<Aba>("perfil");
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
    <div className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span className="label">{t("Perfil")}</span>
        <button className="btn" onClick={async () => {
          await api.account.logout();
          onSaiu();
        }}>
          {t("Sair")}
        </button>
      </div>

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
        {aba === "perfil" && (
          <>
            <div className="cfg-avatar-linha">
              <div className="cfg-avatar-bloco">
                <span className="cfg-avatar-anel">
                  <Avatar conta={conta} tamanho={72} />
                </span>
                {/* Botão de câmera sobreposto ao avatar: a mesma ação de
                    sempre (api.account.avatarPick), só que agora no lugar
                    onde a pessoa espera encontrá-la num perfil. */}
                <button
                  className="cfg-avatar-camera"
                  disabled={ocupado}
                  title={conta.avatarUrl ? t("Trocar foto") : t("Escolher foto")}
                  onClick={() => foto(() => api.account.avatarPick(), t("foto atualizada"))}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 8h3l2-2h6l2 2h3v11H4z" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="14" r="3.4" />
                  </svg>
                </button>
              </div>
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 14, display: "block" }}>{conta.name}</strong>
                <span style={{ fontSize: 12, color: "var(--c-muted)" }}>{conta.email}</span>
                {conta.avatarUrl && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      className="btn"
                      style={{ padding: "3px 10px", fontSize: 11 }}
                      disabled={ocupado}
                      onClick={() => foto(() => api.account.avatarRemove(), t("foto removida"))}
                    >
                      {t("Remover")}
                    </button>
                  </div>
                )}
                <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--c-muted)" }}>
                  {t("PNG, JPG, WEBP ou GIF, até 2 MB.")}
                </p>
              </div>
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
          </>
        )}

        {aba === "preferencias" && (
          <>
            {/* Mesmos controles das Configurações (Aparência + Editor),
                lendo/gravando localStorage e api.config — nada duplicado
                aqui, os componentes são os mesmos, só importados. */}
            <CampoTemaPaleta />
            <CampoFonteQuebra />
          </>
        )}

        {aba === "atividade" && <Atividade />}
      </div>

      {erro && <p style={{ margin: 0, color: "#e24b4a", fontSize: 12 }}>{erro}</p>}
      {aviso && <p style={{ margin: 0, color: "#1d9e75", fontSize: 12 }}>{aviso}</p>}
    </div>
  );
}

type Evento = HomeData["eventos"][number];

/** O que aconteceu num evento do log, em texto pronto pra tela, e o arquivo
 * de origem (quando existe) — extraídos do texto cru que `vault.ts` já
 * formata como `` `slug` — fonte: `arquivo` — nota do aluno: ... ``. */
function interpretarEvento(e: Evento): {
  tipo: "novo" | "reprocessado" | "removido";
  titulo: string;
  arquivo: string | null;
} {
  if (e.removido) {
    const materia = /^removida matéria:\s*(.+)$/i.exec(e.texto);
    return {
      tipo: "removido",
      titulo: materia
        ? tf("Matéria {codigo} removida", { codigo: materia[1].trim() })
        : tf("{slug} removido", { slug: e.slug ?? e.texto }),
      arquivo: null,
    };
  }
  const arquivo = /fonte:\s*`([^`]+)`/.exec(e.texto)?.[1] ?? null;
  const reprocessado = /\(reprocessado\)/.test(e.texto);
  return {
    tipo: reprocessado ? "reprocessado" : "novo",
    titulo: e.slug ?? e.texto,
    arquivo,
  };
}

/** Ícone por tipo de evento — mesmo path para os três, cor e forma mudam via
 * `data-tipo` no CSS (ver config.css), não aqui. */
function IconeEvento({ tipo }: { tipo: "novo" | "reprocessado" | "removido" }) {
  return (
    <span className="cfg-timeline-icone" data-tipo={tipo} aria-hidden>
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        {tipo === "removido" && <path d="M5 12h14" strokeLinecap="round" />}
        {tipo === "reprocessado" && (
          <path
            d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M4 4v5h5M20 20v-5h-5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {tipo === "novo" && <path d="M12 5v14M5 12h14" strokeLinecap="round" />}
      </svg>
    </span>
  );
}

/**
 * Linha do tempo vertical, agrupada por dia (Hoje / Ontem / data), lida de
 * `api.fs.home()` → `eventos` (a mesma lista que a Home já mostra resumida).
 * O log só guarda granularidade de DIA (ver `## AAAA-MM-DD` em log.md) —
 * não há hora — então o agrupamento por dia É o "quando" de cada item; não
 * inventamos um horário que os dados não têm.
 */
function Atividade() {
  const [dados, setDados] = useState<HomeData | null>(null);

  useEffect(() => {
    api.fs.home().then(setDados);
  }, []);

  if (dados === null) {
    return <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>{t("Lendo o vault…")}</p>;
  }

  if (dados.eventos.length === 0) {
    return <p style={{ margin: 0, fontSize: 12, color: "var(--c-muted)" }}>{t("Sem eventos ainda.")}</p>;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const ontemData = new Date();
  ontemData.setDate(ontemData.getDate() - 1);
  const ontem = ontemData.toISOString().slice(0, 10);

  // `eventos` já vem do main na ordem do log (mais recente primeiro); só
  // agrupamos mantendo essa ordem, sem reordenar por conta própria.
  const grupos: { dia: string; itens: Evento[] }[] = [];
  for (const e of dados.eventos) {
    const grupo = grupos[grupos.length - 1];
    if (grupo && grupo.dia === e.data) grupo.itens.push(e);
    else grupos.push({ dia: e.data, itens: [e] });
  }

  function tituloDia(dia: string): string {
    if (dia === hoje) return t("hoje");
    if (dia === ontem) return t("ontem");
    return dia;
  }

  return (
    <div className="cfg-timeline">
      {grupos.map((g) => (
        <div key={g.dia}>
          <p className="cfg-timeline-dia-titulo">{tituloDia(g.dia)}</p>
          <div className="cfg-timeline-lista">
            {g.itens.map((e, i) => {
              const info = interpretarEvento(e);
              return (
                <div key={i} className="cfg-timeline-item">
                  <IconeEvento tipo={info.tipo} />
                  <span className="cfg-timeline-titulo" title={e.texto}>
                    {info.titulo}
                  </span>
                  {info.arquivo && <span className="cfg-timeline-arquivo">{info.arquivo}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
