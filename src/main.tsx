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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
