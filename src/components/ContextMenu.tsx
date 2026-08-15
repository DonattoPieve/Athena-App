import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem =
  | { kind: "sep" }
  | {
      kind?: "item";
      label: string;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onClick: () => void;
    };

export type MenuState = { x: number; y: number; items: MenuItem[] } | null;

/**
 * Menu de contexto no estilo do VS Code / Obsidian: desenhado pelo app, nao
 * nativo. Motivo: os itens sao comandos do Athena ("Nova nota", "Renomear"),
 * precisam de estado (desabilitado quando a pasta e somente leitura) e do tema
 * atual — coisas que um menu do sistema nao acompanha.
 *
 * Fecha em: clique fora, Esc, scroll, botao direito em outro lugar.
 */
export function ContextMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!state) return;
    const el = ref.current;
    if (!el) return;
    // Nao deixa o menu sair da janela — abrir perto da borda de baixo e o caso
    // normal numa arvore alta, nao a excecao.
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(state.x, window.innerWidth - width - 8),
      y: Math.min(state.y, window.innerHeight - height - 8),
    });
  }, [state]);

  useEffect(() => {
    if (!state) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [state, onClose]);

  if (!state) return null;

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {state.items.map((item, i) =>
        "kind" in item && item.kind === "sep" ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button
            key={i}
            className="ctx-item"
            data-danger={!!(item as any).danger}
            disabled={(item as any).disabled}
            onClick={() => {
              onClose();
              (item as any).onClick();
            }}
          >
            <span>{(item as any).label}</span>
            {(item as any).hint && <span className="ctx-hint">{(item as any).hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Guarda o estado do menu e devolve o handler pronto para o onContextMenu. */
export function useContextMenu() {
  const [state, setState] = useState<MenuState>(null);
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setState({ x: e.clientX, y: e.clientY, items });
  };
  return { state, open, close: () => setState(null) };
}
