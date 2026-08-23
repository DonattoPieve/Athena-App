import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../lib/i18n";

/**
 * Confirmação do app, no lugar do `confirm()` do navegador.
 *
 * O nativo abre uma janela do Windows com o título "athena-app", botões
 * "OK/Cancelar" e a fonte do sistema — some o tema, some a paleta e some a
 * chance de explicar o que vai acontecer. Como as confirmações daqui são
 * destrutivas, o texto importa: dizer que vai para a lixeira (e que dá para
 * voltar) é metade da decisão.
 *
 * `confirmar()` devolve uma Promise, então o código que chama fica igual ao
 * que era com o confirm() — só ganha um await.
 */
export type ConfirmOptions = {
  titulo: string;
  mensagem: string;
  /** Caminho/afetados, mostrados em bloco de código. */
  detalhe?: string;
  /** Nota discreta no rodapé — para onde vai, o que sobrevive. */
  nota?: string;
  confirmar?: string;
  perigo?: boolean;
  /**
   * Caixa de marcar dentro do diálogo, para a decisão que anda junto da
   * principal — hoje só "apagar da nuvem também".
   *
   * Fica aqui, e não num segundo botão, porque são perguntas de nível
   * diferente: o botão decide SE apaga, a caixa decide ATÉ ONDE. Dois botões
   * destrutivos lado a lado convidariam ao clique errado.
   */
  caixa?: { rotulo: string; inicial?: boolean };
};

type Pedido = ConfirmOptions & { resolve: (ok: boolean) => void };

export function useConfirm() {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  /**
   * Estado da caixa, em ref e não em state: quem chamou lê DEPOIS do await,
   * quando o diálogo já saiu da tela — um state teria sido zerado junto.
   */
  const caixaMarcada = useRef(false);

  const confirmar = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        caixaMarcada.current = opts.caixa?.inicial ?? false;
        setPedido({ ...opts, resolve });
      }),
    [],
  );

  const fechar = useCallback(
    (ok: boolean) => {
      pedido?.resolve(ok);
      setPedido(null);
    },
    [pedido],
  );

  const dialogo = pedido ? (
    <ConfirmDialog
      pedido={pedido}
      onFechar={fechar}
      marcada={caixaMarcada}
    />
  ) : null;

  return { confirmar, dialogo, caixaMarcada };
}

function ConfirmDialog({
  pedido,
  onFechar,
  marcada,
}: {
  pedido: Pedido;
  onFechar: (ok: boolean) => void;
  marcada: React.MutableRefObject<boolean>;
}) {
  const [caixa, setCaixa] = useState(pedido.caixa?.inicial ?? false);
  // O foco nasce em Cancelar de propósito: a ação é destrutiva e Enter por
  // reflexo não pode apagar arquivo.
  const cancelar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelar.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFechar]);

  // Portal: o Confirm e chamado de dentro da arvore, do editor e da leitura —
  // lugares com contexto de empilhamento proprio. No <body> ele nunca fica
  // atras de nada.
  return createPortal(
    <div className="modal-backdrop" onClick={() => onFechar(false)}>
      <div
        className="card modal"
        role="dialog"
        aria-modal="true"
        aria-label={pedido.titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="label" style={{ margin: 0 }}>
          Athena
        </p>
        <h2 style={{ margin: "6px 0 8px", fontSize: "1.05rem", fontWeight: 600 }}>
          {pedido.titulo}
        </h2>
        <p style={{ margin: 0, color: "var(--c-muted)", fontSize: 13, lineHeight: 1.6 }}>
          {pedido.mensagem}
        </p>

        {pedido.detalhe && (
          <pre className="modal-detalhe scroll">{pedido.detalhe}</pre>
        )}

        {pedido.caixa && (
          <label
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              margin: "14px 0 0",
              fontSize: 12.5,
              lineHeight: 1.5,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={caixa}
              onChange={(e) => {
                setCaixa(e.target.checked);
                marcada.current = e.target.checked;
              }}
              style={{ marginTop: 2 }}
            />
            <span>{pedido.caixa.rotulo}</span>
          </label>
        )}

        {pedido.nota && (
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--c-muted)" }}>
            {pedido.nota}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button ref={cancelar} className="btn" onClick={() => onFechar(false)}>
            {t("Cancelar")}
          </button>
          <button
            className={pedido.perigo === false ? "btn btn-primary" : "btn btn-danger-solid"}
            onClick={() => onFechar(true)}
          >
            {pedido.confirmar ?? t("Confirmar")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
