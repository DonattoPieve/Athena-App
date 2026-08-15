import { useState } from "react";
import type { TreeNode } from "../lib/api";

type Props = {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (rel: string) => void;
  readOnly?: boolean;
};

export function Explorer({ nodes, selected, onSelect, readOnly }: Props) {
  if (nodes.length === 0) {
    return (
      <p style={{ color: "var(--c-muted)", padding: "8px 10px", fontSize: 12 }}>
        Nada aqui ainda.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {nodes.map((n) => (
        <Row
          key={n.rel}
          node={n}
          depth={0}
          selected={selected}
          onSelect={onSelect}
          readOnly={readOnly}
        />
      ))}
    </ul>
  );
}

function Row({
  node,
  depth,
  selected,
  onSelect,
  readOnly,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (rel: string) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isSelected = selected === node.rel;

  return (
    <li>
      <button
        className="nav-item"
        data-active={isSelected}
        style={{ paddingLeft: 10 + depth * 14 }}
        onClick={() => {
          if (node.dir) setOpen((o) => !o);
          onSelect(node.rel);
        }}
        title={readOnly ? `${node.rel} — somente leitura` : node.rel}
      >
        <span style={{ opacity: 0.6, width: 10, display: "inline-block" }}>
          {node.dir ? (open ? "v" : ">") : "·"}
        </span>
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.name}
        </span>
      </button>
      {node.dir && open && node.children && node.children.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {node.children.map((c) => (
            <Row
              key={c.rel}
              node={c}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
