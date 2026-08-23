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

export const IconHome = () => (
  <Rail>
    <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M9 21v-7h6v7" />
  </Rail>
);

export const IconRaio = () => (
  <Rail>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Rail>
);

export const IconRelogio = () => (
  <Rail>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Rail>
);

export const IconGrafico = () => (
  <Rail>
    <path d="M3 3v18h18" />
    <path d="m7 14 4-4 3 3 5-6" />
  </Rail>
);

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

/** Livro aberto — glossario. */
export const IconLivro = () => (
  <Rail>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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

/**
 * Olho de mostrar senha. Fechado = risco por cima, que e como todo campo de
 * senha sinaliza "escondida" — sem o risco a pessoa nao sabe qual e o estado.
 */
export const IconOlho = ({ aberto }: { aberto: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.8" />
    {!aberto && <path d="m4 20 16-16" />}
  </svg>
);

/** Marca do Google nas cores oficiais — monocromatica ninguem reconhece. */
export const IconGoogle = () => (
  <svg viewBox="0 0 48 48" width="15" height="15" aria-hidden>
    <path fill="#4285F4" d="M45 24.3c0-1.6-.1-2.7-.4-4H24v7.5h12c-.2 2-1.5 5-4.4 7l6.7 5.2C42.2 36.3 45 30.9 45 24.3z" />
    <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8 41.2 15.4 46 24 46z" />
    <path fill="#FBBC05" d="M11.5 28.4c-.5-1.4-.7-2.9-.7-4.4s.3-3 .7-4.4l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 9.9l7.1-5.5z" />
    <path fill="#EA4335" d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.4 29.9 2 24 2 15.4 2 8 6.8 4.4 14.1l7.1 5.5C13.3 14.3 18.2 10.5 24 10.5z" />
  </svg>
);

export const IconGitHub = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
    <path d="M12 1.5A10.5 10.5 0 0 0 8.7 22c.5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.6-1.2-1.6-1-.6.1-.6.1-.6 1 .1 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.2.4-2.1 1.1-2.9-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 2.9 1.1a10 10 0 0 1 5.3 0c2-1.4 2.9-1.1 2.9-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.7 1.1 2.9 0 4-2.5 4.9-4.8 5.2.4.3.7 1 .7 2v3c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z" />
  </svg>
);

/** Lupa do "abrir maior" — o mesmo desenho do IconBusca, em tamanho de botao. */
export const IconLupa = () => (
  <svg
    viewBox="0 0 24 24"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
    <path d="M8.5 11h5M11 8.5v5" />
  </svg>
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

/**
 * Material que esta na conta mas ainda nao nesta maquina.
 *
 * Nuvem VAZIA = so no bucket, o clique e que traz. Nuvem CHEIA (com a seta
 * apagada) = ja foi aberto uma vez, entao o arquivo esta no cache e abre sem
 * internet. A diferenca importa: uma linha promete rede, a outra nao.
 */
export function NuvemIcon({ baixado }: { baixado?: boolean }) {
  return (
    <svg className="tree-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4.6 12.2a3 3 0 0 1-.3-6 3.9 3.9 0 0 1 7.4.9 2.6 2.6 0 0 1-.5 5.1z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity={baixado ? 0.32 : 0}
      />
      {!baixado && (
        <path
          d="M8 7.4v4m0 0L6.4 9.9M8 11.4l1.6-1.5"
          stroke="currentColor"
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
