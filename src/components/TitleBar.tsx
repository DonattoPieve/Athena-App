import { api } from "../lib/api";
import { t } from "../lib/i18n";

/**
 * Barra de título do próprio app.
 *
 * A janela é `frame: false`: a barra do Windows (ícone, título, minimizar,
 * maximizar, X) some e esta entra no lugar. Duas consequências que precisam
 * ser resolvidas aqui dentro, senão a janela fica presa:
 *
 *   - **arrastar**: `-webkit-app-region: drag` na faixa. Sem isso não há como
 *     mover a janela pela tela.
 *   - **maximizar**: como só existe o X, o duplo clique na faixa faz o que o
 *     botão de maximizar fazia. É o mesmo gesto do Windows, então não precisa
 *     ser ensinado.
 *
 * Redimensionar continua funcionando pelas bordas — isso o Electron mantém em
 * janela sem moldura.
 */
export function TitleBar() {
  return (
    <div className="titlebar" onDoubleClick={() => api.win.toggleMaximize()}>
      <span className="titlebar-marca" aria-hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M4 20 12 4l8 16" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 14h8" strokeLinecap="round" />
        </svg>
      </span>
      <span className="titlebar-nome">Athena</span>

      <button className="titlebar-x" title={t("Fechar")} aria-label={t("Fechar")} onClick={() => api.win.close()}>
        <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6">
          <path d="M1 1l10 10M11 1L1 11" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
