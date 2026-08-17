import { useEffect, useState } from "react";
import { api, type Account, type EstadoAtualizacao } from "../lib/api";
import { t, tf } from "../lib/i18n";
import { Avatar } from "./Avatar";
import {
  IconArquivos,
  IconBusca,
  IconComandos,
  IconConfig,
  IconHome,
  IconLivro,
  IconMais,
  IconPerfil,
} from "./icons";

/**
 * Barra lateral esquerda — o menu do app.
 *
 * Substituiu o rail de 44px só com ícones. O rail cabia mais coisa na tela,
 * mas obrigava a passar o mouse em cada botão para descobrir o que ele era;
 * com oito destinos, o rótulo escrito custa 190px e economiza essa descoberta
 * toda vez.
 *
 * A coluna é uma pilha de partes com alturas diferentes: cabeçalho e menu têm
 * o tamanho do conteúdo, o Explorer come o que sobrar (é ele que rola), e o
 * rodapé do vault fica colado embaixo.
 */

export type Destino =
  | "home"
  | "busca"
  | "conteudo"
  | "glossario"
  | "nova-nota"
  | "comandos"
  | "config"
  | "perfil";

const MENU: { id: Destino; icone: React.ReactNode; rotulo: string; atalho?: string }[] = [
  { id: "home", icone: <IconHome />, rotulo: "Home" },
  { id: "busca", icone: <IconBusca />, rotulo: "Buscar", atalho: "Ctrl K" },
  { id: "conteudo", icone: <IconArquivos />, rotulo: "Meu conteúdo" },
  { id: "glossario", icone: <IconLivro />, rotulo: "Glossário" },
  { id: "nova-nota", icone: <IconMais />, rotulo: "Nova nota" },
  { id: "comandos", icone: <IconComandos />, rotulo: "Comandos" },
  { id: "config", icone: <IconConfig />, rotulo: "Configurações" },
  { id: "perfil", icone: <IconPerfil />, rotulo: "Perfil" },
];

export function Sidebar({
  conta,
  ativo,
  onIr,
  explorer,
  vaultPath,
}: {
  conta: Account;
  ativo: Destino | null;
  onIr: (d: Destino) => void;
  /** A árvore do vault, montada pelo App — a lateral só reserva o espaço. */
  explorer: React.ReactNode;
  vaultPath: string;
}) {
  return (
    <aside className="lateral">
      <div className="lateral-marca">
        <span className="lateral-logo" aria-hidden>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 20 12 4l8 16" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.2 14h7.6" strokeLinecap="round" />
          </svg>
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="lateral-nome">ATHENA</span>
          <span className="lateral-sub">{t("Seu Segundo Cérebro")}</span>
        </span>
      </div>

      <button className="lateral-conta" onClick={() => onIr("perfil")} title={conta.email}>
        <Avatar conta={conta} />
        <span className="truncar">{conta.name || conta.email}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <nav className="lateral-menu">
        {MENU.map((m) => (
          <button
            key={m.id}
            className="lateral-item"
            data-ativo={ativo === m.id}
            onClick={() => onIr(m.id)}
          >
            <span className="lateral-icone">{m.icone}</span>
            <span className="truncar">{t(m.rotulo)}</span>
            {m.atalho && <kbd className="lateral-atalho">{m.atalho}</kbd>}
          </button>
        ))}
      </nav>

      <div className="lateral-explorer">{explorer}</div>

      <VaultRodape caminho={vaultPath} />
      <BotaoAtualizacao />
    </aside>
  );
}

/**
 * Atualização do app, no canto de baixo da lateral.
 *
 * Fica no canto justamente porque atualização não é urgente: interromper uma
 * nota aberta com um aviso no meio da tela seria desproporcional. O que faz o
 * olho encontrar sozinho é o brilho — ele só existe quando há algo baixado
 * esperando, e some quando não há.
 *
 * Parado, o botão continua servindo: procura agora, em vez de esperar a
 * checagem automática (de 6 em 6 horas). Um ícone que não faz nada na maior
 * parte do tempo seria pior que ícone nenhum.
 */
function BotaoAtualizacao() {
  const [estado, setEstado] = useState<EstadoAtualizacao>({ fase: "ocioso" });
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api.app.atualizacao().then(setEstado).catch(() => {});
    return api.app.onAtualizacao((e) => {
      setEstado(e);
      setErro(null);
    });
  }, []);

  const texto =
    estado.fase === "pronta"
      ? tf("Atualizar para a v{versao}", { versao: estado.versao })
      : estado.fase === "baixando"
        ? tf("baixando… {pct}%", { pct: estado.pct })
        : estado.fase === "checando"
          ? t("procurando…")
          : estado.fase === "atual"
            ? t("tudo em dia")
            : t("Procurar atualizações");

  return (
    <button
      className="lateral-atualizacao"
      data-fase={estado.fase}
      title={erro ?? texto}
      onClick={() => {
        setErro(null);
        if (estado.fase === "pronta") {
          api.app
            .instalarAtualizacao()
            .catch((e: Error) => setErro(e.message.replace(/^Error: /, "")));
        } else if (estado.fase === "ocioso" || estado.fase === "atual") {
          api.app.procurarAtualizacao().catch(() => {});
        }
      }}
    >
      <span className="lateral-atualizacao-luz" aria-hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="truncar">{erro ?? texto}</span>
    </button>
  );
}

/**
 * Rodapé do vault: onde ele está e quanto ele ocupa.
 *
 * O tamanho é medido de verdade (soma dos arquivos do disco). A barra precisa
 * de um teto para ter comprimento, e teto de disco local não existe — ela usa
 * o maior valor entre 10 GB e o dobro do que já está em uso, para nunca
 * aparecer cheia e sugerir um limite que ninguém impôs.
 */
function VaultRodape({ caminho }: { caminho: string }) {
  const [bytes, setBytes] = useState<number | null>(null);

  useEffect(() => {
    api.vault.tamanho().then(setBytes).catch(() => setBytes(null));
  }, [caminho]);

  const gb = (bytes ?? 0) / 1024 ** 3;
  const teto = Math.max(10, Math.ceil(gb * 2));
  const pct = bytes === null ? 0 : Math.min(100, (gb / teto) * 100);

  return (
    <div className="lateral-vault">
      <div className="lateral-vault-topo">
        <span>Vault</span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="m8 9 4-4 4 4M8 15l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <p className="lateral-vault-caminho" title={caminho}>
        {caminho}
      </p>
      <div className="barra" style={{ height: 4 }}>
        <div className="barra-cheio" style={{ width: `${pct}%` }} />
      </div>
      <p className="lateral-vault-uso">
        {bytes === null ? "—" : `${gb.toFixed(1)} GB / ${teto} GB`}
      </p>
    </div>
  );
}
