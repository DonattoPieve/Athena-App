import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// A JetBrains Mono vem empacotada, nao do sistema: o desenho das telas depende
// dela, e maquina sem a fonte instalada cairia num monoespacado qualquer.
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./index.css";
// Uma folha por tela, e nao tudo no index.css: cada uma foi escrita junto com
// a sua tela, e separadas dá para mexer numa sem reler as outras.
import "./styles/home.css";
import "./styles/comandos.css";
import "./styles/config.css";
import "./styles/biblioteca.css";
import "./styles/primeiro-uso.css";
import "./styles/ajuda.css";

/**
 * Arrastar arquivo de fora e solta-lo FORA de um alvo nao pode fazer nada.
 *
 * O padrao do navegador para um arquivo solto na pagina e abri-lo como se
 * fosse um link — a janela do app sai do ar e da lugar ao PDF (ou a uma tela
 * quebrada, porque `file://` e barrado numa pagina servida por localhost).
 * A arvore chama `preventDefault` nos seus proprios alvos; isto cobre todo o
 * resto da janela, que e a maior parte dela.
 *
 * `defaultPrevented` e o que separa os dois casos: quando o evento chega aqui
 * ja cancelado, ele passou por um alvo de verdade (uma pasta da arvore) e o
 * cursor de copia dele esta certo. Quando chega intacto, `dropEffect = "none"`
 * poe o cursor de proibido e o `drop` nem chega a acontecer — em vez do
 * arrastar silenciosamente "funcionar" e nao copiar nada.
 */
window.addEventListener("dragover", (e) => {
  if (!e.defaultPrevented && e.dataTransfer) e.dataTransfer.dropEffect = "none";
  e.preventDefault();
});
window.addEventListener("drop", (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
