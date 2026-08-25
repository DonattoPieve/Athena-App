import { useEffect, useRef, useState } from "react";
import { api, mensagemDeErro, type ResultadoBootstrap } from "../lib/api";
import { t, tf } from "../lib/i18n";

/**
 * Tela de primeiro uso — o que exigia terminal (clonar o repo, `npm i` dentro
 * de `athena-web`, `athena login`, `athena pull`) vira um botão.
 *
 * **Um caminho só, e ele não pergunta nada.** Entrar na conta basta: o app
 * cria a pasta dentro dos próprios dados (`vault:criarInterno`) e puxa o texto
 * da conta — rascunhos e resumos. O material do professor nem desce agora,
 * aparece na árvore com ícone de nuvem e vem no primeiro clique.
 *
 * Escolher pasta e apontar para um vault que já existe continuam possíveis,
 * atrás de "outras opções": quem precisa disso tem o vault antigo no disco e
 * sabe o que está procurando. Para todo mundo, onde a pasta fica é assunto do
 * app — e existe uma porta para ela em Configurações → Seus arquivos.
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
  /** As saídas de emergência ficam fechadas: elas confundem quem não precisa. */
  const [avancado, setAvancado] = useState(false);

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
              ? t("Preparando seus arquivos…")
              : t("Baixando suas matérias, resumos e anotações…")}
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
          <p className="pu-sub">{t("Tudo pronto.")}</p>
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
            {t("Abrir o Athena")}
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
        <p className="pu-sub">
          {t("Falta preparar seus arquivos neste computador. É um clique.")}
        </p>
        <div className="pu-opcoes">
          <button className="btn btn-primary" onClick={() => void comecar()}>
            <span className="pu-opcao-titulo">{t("Começar")}</span>
            <span className="pu-opcao-desc">
              {t(
                "Baixa suas anotações e seus resumos da conta. O material do professor vem quando você abrir cada aula.",
              )}
            </span>
          </button>
        </div>

        {/* Fechadas por padrão: são para quem já tem o vault antigo no disco e
            foi atrás disto — oferecer as três lado a lado transformava um
            clique numa decisão que ninguém tem como tomar no primeiro uso. */}
        {avancado ? (
          <div className="pu-opcoes">
            <button className="btn" onClick={() => void onEscolherVaultExistente()}>
              <span className="pu-opcao-titulo">{t("Já tenho uma pasta do Athena neste PC")}</span>
              <span className="pu-opcao-desc">
                {t("Escolher a pasta que já tem")} <code>CLAUDE.md</code> {t("e")} <code>Notes/</code>
              </span>
            </button>
            <button className="btn" onClick={() => void escolherPastaNova()}>
              <span className="pu-opcao-titulo">{t("Criar numa pasta minha")}</span>
              <span className="pu-opcao-desc">
                {t("Você escolhe onde; o resto é igual. Só funciona em pasta vazia.")}
              </span>
            </button>
          </div>
        ) : (
          <button className="link-btn" onClick={() => setAvancado(true)}>
            {t("outras opções")}
          </button>
        )}
        {erro && <p className="pu-erro">{erro}</p>}
      </div>
    </div>
  );
}
