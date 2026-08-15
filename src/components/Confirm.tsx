import { useCallback, useEffect, useRef, useState } from "react";

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
};

type Pedido = ConfirmOptions & { resolve: (ok: boolean) => void };

export function useConfirm() {
  const [pedido, setPedido] = useState<Pedido | null>(null);

  const confirmar = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPedido({ ...opts, resolve })),
    [],
  );

  const fechar = useCallback(
    (ok: boolean) => {
      pedido?.resolve(ok);
      setPedido(null);
    },
    [pedido],
  );

  const dialogo = pedido ? <ConfirmDialog pedido={pedido} onFechar={fechar} /> : null;

  return { confirmar, dialogo };
}

function ConfirmDialog({
  pedido,
  onFechar,
}: {
  pedido: Pedido;
  onFechar: (ok: boolean) => void;
}) {
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

  return (
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

        {pedido.nota && (
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--c-muted)" }}>
            {pedido.nota}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
          <button ref={cancelar} className="btn" onClick={() => onFechar(false)}>
            Cancelar
          </button>
          <button
            className={pedido.perigo === false ? "btn btn-primary" : "btn btn-danger-solid"}
            onClick={() => onFechar(true)}
          >
            {pedido.confirmar ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}
