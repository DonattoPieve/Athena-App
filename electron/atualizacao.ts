import { app, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * Atualização automática — o app se atualiza sozinho, do GitHub Releases.
 *
 * Sem isto, publicar uma versão nova não muda nada para quem já instalou: o
 * `.exe` que a pessoa baixou é o que ela vai usar para sempre. O
 * `electron-updater` fecha esse buraco lendo o `latest.yml` que o
 * electron-builder publica junto do instalador (ver `build.publish` no
 * package.json e `.github/workflows/release.yml`).
 *
 * COMO SE COMPORTA, e por quê:
 *
 * - Baixa em silêncio, no fundo. Um aviso "existe versão nova, quer baixar?"
 *   só serve para ser ignorado; quando a pessoa finalmente aceita, ainda tem
 *   que esperar o download.
 * - Só INSTALA quando o app fecha, ou quando a pessoa clica no botão que
 *   aparece no rodapé do Task Center. Reiniciar sozinho no meio de uma nota
 *   aberta seria a pior coisa que este app poderia fazer — vale mais a regra
 *   de nunca perder trabalho do que ter a versão nova cinco minutos antes.
 * - Nunca instala com o Claude Code rodando (`ocupado()`), mesmo se pedirem: o
 *   ingest está no meio de escrever arquivo no vault.
 * - Erro não vira pop-up. Falha de rede aqui não é problema do usuário e ele
 *   não pode fazer nada a respeito; fica no log da sessão.
 *
 * Em desenvolvimento o updater não roda: sem `app.isPackaged` o
 * electron-updater procura um `dev-app-update.yml` que não existe e reclama.
 */

export type EstadoAtualizacao =
  | { fase: "ocioso" }
  | { fase: "baixando"; pct: number }
  | { fase: "pronta"; versao: string }
  | { fase: "erro"; mensagem: string };

/** Uma vez a cada 6 h. Mais que isso é gastar rede para nada. */
const INTERVALO_MS = 6 * 60 * 60 * 1000;
/** Espera antes da primeira checagem: a abertura já tem o pull disputando rede. */
const ATRASO_INICIAL_MS = 8000;

let estado: EstadoAtualizacao = { fase: "ocioso" };

export function iniciarAtualizador(opcoes: {
  /** Manda o estado para todas as janelas. */
  send: (canal: string, dados: unknown) => void;
  /** Verdadeiro enquanto o Claude Code estiver rodando algum comando. */
  ocupado: () => boolean;
  /** Log da sessão — é onde o erro fica visível sem incomodar. */
  log: (linha: string) => void;
}) {
  const { send, ocupado, log } = opcoes;

  function mudar(novo: EstadoAtualizacao) {
    estado = novo;
    send("app:atualizacao", novo);
  }

  ipcMain.handle("app:atualizacao", () => estado);

  ipcMain.handle("app:instalarAtualizacao", () => {
    if (estado.fase !== "pronta") {
      throw new Error("Não há atualização baixada.");
    }
    if (ocupado()) {
      throw new Error(
        "O Claude Code está rodando um comando. Espere terminar — reiniciar agora " +
          "interromperia a escrita no vault.",
      );
    }
    // `isSilent: true` pula o assistente do NSIS; `isForceRunAfter` reabre o app.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  });

  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // O log do electron-updater é útil no diagnóstico e some se ninguém o pega.
  autoUpdater.logger = {
    info: (m: unknown) => log(`[updater] ${String(m)}`),
    warn: (m: unknown) => log(`[updater] ${String(m)}`),
    error: (m: unknown) => log(`[updater] ${String(m)}`),
    debug: () => {},
  };

  autoUpdater.on("download-progress", (p) => {
    mudar({ fase: "baixando", pct: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    mudar({ fase: "pronta", versao: info.version });
  });
  autoUpdater.on("error", (e) => {
    // Volta para "ocioso" em vez de deixar o erro na tela: a próxima checagem
    // pode dar certo, e um aviso permanente de algo que o usuário não controla
    // é só ruído.
    log(`[updater] falhou: ${e.message}`);
    estado = { fase: "ocioso" };
  });

  const checar = () => {
    autoUpdater.checkForUpdates().catch(() => {
      // o handler de `error` acima já registrou
    });
  };
  setTimeout(checar, ATRASO_INICIAL_MS);
  setInterval(checar, INTERVALO_MS);
}
