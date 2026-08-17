import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";

/**
 * Minimizar, tela cheia e fechar — a moldura da janela, desenhada pelo app.
 *
 * A janela é `frame: false`, então a barra do Windows não existe. Estes três
 * botões moram na ponta direita da faixa de abas, que é o topo da janela nas
 * telas de referência. A faixa em volta é que arrasta (`-webkit-app-region:
 * drag` em `.topo`); aqui dentro tudo é `no-drag`, senão o clique vira
 * arrasto e o botão nunca dispara.
 *
 * Maximizar também responde ao duplo clique na faixa — o gesto do Windows,
 * que quem tem o hábito não precisa aprender.
 */
export function ControlesJanela() {
  const [max, setMax] = useState(false);

  /**
   * O estado vem do main, não daqui.
   *
   * Maximizar não acontece só pelo botão: o snap do Windows (arrastar para o
   * topo, Win+seta) e o duplo clique na faixa também maximizam. Se o ícone
   * fosse um `!max` local, ele passaria a mentir na primeira vez que isso
   * acontecesse — e um botão de restaurar que mostra "maximizar" é pior que
   * botão nenhum.
   */
  useEffect(() => {
    api.win.isMaximized().then(setMax).catch(() => {});
    return api.win.onMaximized(setMax);
  }, []);

  return (
    <div className="titlebar-botoes">
        <button
          className="titlebar-btn"
          title={t("Minimizar")}
          aria-label={t("Minimizar")}
          onClick={() => api.win.minimize()}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3" fill="none">
            <path d="M1.5 6h9" strokeLinecap="round" />
          </svg>
        </button>

        <button
          className="titlebar-btn"
          title={max ? t("Restaurar") : t("Tela cheia")}
          aria-label={max ? t("Restaurar") : t("Tela cheia")}
          onClick={() => api.win.toggleMaximize().then(setMax)}
        >
          {max ? (
            /* Maximizada: dois quadrados, o de trás assomando — o mesmo
               desenho do "restaurar" do Windows. */
            <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3" fill="none">
              <rect x="1.2" y="3.2" width="7.6" height="7.6" rx="1.6" />
              <path d="M3.9 3.2V2.8a1.6 1.6 0 0 1 1.6-1.6h3.7a1.6 1.6 0 0 1 1.6 1.6v3.7a1.6 1.6 0 0 1-1.6 1.6h-.4" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3" fill="none">
              <rect x="1.2" y="1.2" width="9.6" height="9.6" rx="1.8" />
            </svg>
          )}
        </button>

        <button
          className="titlebar-btn titlebar-x"
          title={t("Fechar")}
          aria-label={t("Fechar")}
          onClick={() => api.win.close()}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.3" fill="none">
            <path d="M1.6 1.6l8.8 8.8M10.4 1.6L1.6 10.4" strokeLinecap="round" />
          </svg>
        </button>
    </div>
  );
}
