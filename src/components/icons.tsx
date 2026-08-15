/**
 * Icones da arvore. SVG inline, sem biblioteca e sem emoji: herdam
 * `currentColor`, entao acompanham tema e paleta sozinhos.
 */

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="tree-chevron" data-open={open} viewBox="0 0 10 10" fill="none" aria-hidden>
      <path d="M3.5 1.5 L7 5 L3.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Mesma silhueta de pasta aberta e fechada, mudando so o preenchimento — o
 * chevron ao lado ja diz se esta aberta. Desenhar duas geometrias diferentes
 * em 15px vira ruido: a "pasta aberta" some e parece outra coisa.
 */
export function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg className="tree-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.6 12.4V4.1a1 1 0 0 1 1-1h3.1l1.4 1.7h6.3a1 1 0 0 1 1 1v6.6a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1z"
        fill="currentColor"
        fillOpacity={open ? 0.38 : 0.16}
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Arquivo comum; `dobrado` marca o canto de folha para .md e afins. */
/**
 * Icones da barra de atividade (o rail estreito). Traco de 1.6 em grade de 24
 * para ficarem legiveis a 18px, que e o tamanho que cabe la.
 */
function Rail({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="rail-icone"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const IconArquivos = () => (
  <Rail>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Rail>
);

export const IconBusca = () => (
  <Rail>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </Rail>
);

/** Terminal de verdade: janela com prompt. */
export const IconTerminal = () => (
  <Rail>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3" />
    <path d="M13 15h4" />
  </Rail>
);

/** Comandos do Athena (ingest, redo, review, delete): raio, nao terminal. */
export const IconComandos = () => (
  <Rail>
    <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12z" />
  </Rail>
);

export const IconMais = () => (
  <Rail>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Rail>
);

export const IconConfig = () => (
  <Rail>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </Rail>
);

export const IconPerfil = () => (
  <Rail>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
  </Rail>
);

export const IconPublicar = () => (
  <Rail>
    <path d="M12 16V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Rail>
);

export const IconLado = ({ direita }: { direita: boolean }) => (
  <Rail>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    {direita ? <path d="M15 4v16" /> : <path d="M9 4v16" />}
  </Rail>
);

export function FileIcon({ material }: { material?: boolean }) {
  return (
    <svg className="tree-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 1.5h5l3 3v10a.5.5 0 0 1-.5.5h-7.5a.5.5 0 0 1-.5-.5v-12a.5.5 0 0 1 .5-.5z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        fill={material ? "currentColor" : "none"}
        fillOpacity={material ? 0.18 : 0}
      />
      <path d="M9 1.5v3h3" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}
