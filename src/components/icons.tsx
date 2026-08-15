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

/** Arquivo comum; `material` marca PDF/PPT com preenchimento. */
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

export const IconComandos = () => (
  <Rail>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3" />
    <path d="M13 15h4" />
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
