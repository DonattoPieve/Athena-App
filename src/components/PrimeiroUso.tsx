import { useEffect, useRef, useState } from "react";
import { api, mensagemDeErro, type ResultadoBootstrap } from "../lib/api";
import { t, tf } from "../lib/i18n";

/**
 * Tela de primeiro uso — o que exigia terminal (clonar o repo, `npm i` dentro
 * de `athena-web`, `athena login`, `athena pull`) vira um botão.
 *
 * Ela aparece DEPOIS do login, quando a conta ainda não tem vault neste PC.
 * Não pede login (já houve) e, no caminho principal, não pede pasta: o vault
 * nasce dentro dos dados do app (`vault:criarInterno`), e é por isso que uma
 * conta não enxerga os arquivos da outra.
 *
 * "Já tenho um vault" e "escolher a pasta" continuam existindo para quem tem
 * o vault antigo no disco — só deixaram de ser o caminho normal.
 *
 * Cada passo é um estado só, porque a pessoa só tem uma chance de ver esta
 * tela sem saber o que esperar.
 */
type Passo =
  | { tipo: "escolha" }
  | { tipo: "criando"; pasta: string }
  | { tipo: "baixando"; pasta: string; linhas: string[] }
  | { tipo: "pronto"; pasta: string; resultado: ResultadoBootstrap }
  | { tipo: "erro"; mensagem: string };

export function PrimeiroUso({
  onEscolherVaultExistente,
  onVaultPronto,
  erro,
}: {
  onEscolherVaultExistente: () => void | Promise<void>;
  /** Vault criado, logado e com o conteúdo baixado — devolve o controle pro App.tsx. */
  onVaultPronto: (pasta: string) => void;
  /** Erro do "Já tenho um vault" (vem do `pick()` do App.tsx — pasta sem CLAUDE.md/Notes/, etc). */
  erro?: string | null;
}) {
  const [passo, setPasso] = useState<Passo>({ tipo: "escolha" });

  /** Linhas do download em andamento — a ref evita fechar sobre estado velho no listener do IPC. */
  const linhasRef = useRef<string[]>([]);

  /** O caminho normal: nenhuma pergunta, nenhuma pasta para escolher. */
  async function comecar() {
    setPasso({ tipo: "criando", pasta: "" });
    try {
      const { path } = await api.vault.criarInterno();
      await executarDownload(path);
    } catch (e) {
      setPasso({ tipo: "erro", mensagem: mensagemDeErro(e) });
    }
  }

  async function escolherPastaNova() {
    setPasso({ tipo: "escolha" });
    try {
      const pasta = await api.vault.escolherPastaNova();
      if (!pasta) return; // cancelou o seletor — fica na tela de escolha
      setPasso({ tipo: "criando", pasta });
      await api.vault.criarNovo(pasta);
      await executarDownload(pasta);
    } catch (e) {
      setPasso({ tipo: "erro", mensagem: mensagemDeErro(e) });
    }
  }

  async function executarDownload(pasta: string) {
    linhasRef.current = [];
    setPasso({ tipo: "baixando", pasta, linhas: [] });
    try {
      const resultado = await api.vault.baixarTudo();
      setPasso({ tipo: "pronto", pasta, resultado });
    } catch (e) {
      setPasso({ tipo: "erro", mensagem: mensagemDeErro(e) });
    }
  }

  // Progresso ao vivo — só ouve enquanto o passo "baixando" está montado.
  useEffect(() => {
    if (passo.tipo !== "baixando") return;
    return api.vault.onLinhaBootstrap((linha) => {
      linhasRef.current = [...linhasRef.current, linha];
      setPasso((atual) =>
        atual.tipo === "baixando" ? { ...atual, linhas: linhasRef.current } : atual,
      );
    });
  }, [passo.tipo]);

  /* ---------------------------------------------------------------- */

  if (passo.tipo === "criando" || passo.tipo === "baixando") {
    const linhas = passo.tipo === "baixando" ? passo.linhas : [];
    return (
      <div className="pu-tela">
        <div className="card pu-caixa">
          <h1 className="pu-titulo">Athena</h1>
          <p className="pu-sub">
            {passo.tipo === "criando"
              ? t("Criando a estrutura do vault…")
              : t("Baixando matérias, páginas e notas do banco…")}
          </p>
          <div className="pu-log">
            {linhas.length === 0 ? (
              <p className="pu-log-vazio">{t("um instante…")}</p>
            ) : (
              linhas.map((l, i) => (
                <p key={i} className="pu-log-linha">
                  {l}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  if (passo.tipo === "pronto") {
    const r = passo.resultado;
    return (
      <div className="pu-tela">
        <div className="card pu-caixa">
          <h1 className="pu-titulo">Athena</h1>
          <p className="pu-sub">{t("Vault pronto.")}</p>
          <p className="pu-resumo">
            {tf("{criados} arquivo(s) criado(s), {iguais} já igual(is).", {
              criados: r.criados,
              iguais: r.iguais,
            })}
          </p>
          {r.conflitos.length > 0 && (
            <div className="pu-alerta">
              <strong>
                {tf("{n} arquivo(s) já existiam com conteúdo diferente e não foram tocados:", {
                  n: r.conflitos.length,
                })}
              </strong>
              <div className="pu-log">
                {r.conflitos.map((c) => (
                  <p key={c} className="pu-log-linha">
                    {c}
                  </p>
                ))}
              </div>
            </div>
          )}
          {r.semR2 && (
            <p className="pu-aviso">
              {t(
                "O material do professor (Notes/INATEL) e os anexos não foram baixados: o portão do " +
                  "R2 não respondeu. As páginas e as notas de aula funcionam normalmente.",
              )}
            </p>
          )}
          <button className="btn btn-primary" onClick={() => onVaultPronto(passo.pasta)}>
            {t("Abrir o vault")}
          </button>
        </div>
      </div>
    );
  }

  if (passo.tipo === "erro") {
    return (
      <div className="pu-tela">
        <div className="card pu-caixa">
          <h1 className="pu-titulo">Athena</h1>
          <p className="pu-erro">{passo.mensagem}</p>
          <button className="btn btn-primary" onClick={() => setPasso({ tipo: "escolha" })}>
            {t("Tentar de novo")}
          </button>
        </div>
      </div>
    );
  }

  // passo.tipo === "escolha"
  return (
    <div className="pu-tela">
      <div className="card pu-caixa">
        <h1 className="pu-titulo">Athena</h1>
        <p className="pu-sub">{t("Esta conta ainda não tem vault neste computador.")}</p>
        <div className="pu-opcoes">
          <button className="btn btn-primary" onClick={() => void comecar()}>
            <span className="pu-opcao-titulo">{t("Começar")}</span>
            <span className="pu-opcao-desc">
              {t("O app cria a pasta e baixa tudo da sua conta. Você não precisa saber onde ela fica.")}
            </span>
          </button>
          <button className="btn" onClick={() => void onEscolherVaultExistente()}>
            <span className="pu-opcao-titulo">{t("Já tenho um vault neste PC")}</span>
            <span className="pu-opcao-desc">
              {t("Escolher a pasta que já tem")} <code>CLAUDE.md</code> {t("e")} <code>Notes/</code>
            </span>
          </button>
        </div>
        <button className="link-btn" onClick={() => void escolherPastaNova()}>
          {t("prefiro escolher a pasta eu mesmo")}
        </button>
        {erro && <p className="pu-erro">{erro}</p>}
      </div>
    </div>
  );
}
