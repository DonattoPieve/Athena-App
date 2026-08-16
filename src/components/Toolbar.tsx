import { useEditorState, type Editor } from "@tiptap/react";
import { t } from "../lib/i18n";

/**
 * Barra do editor. Cada botao e um comando do Tiptap que tem representacao em
 * markdown — nada aqui gera algo que o serializador nao saiba escrever.
 */
export function Toolbar({ editor, onLink }: { editor: Editor; onLink?: () => void }) {
  // Em v3 o useEditor nao repinta a cada transacao: os estados ativos vem daqui.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      code: e.isActive("code"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      task: e.isActive("taskList"),
      quote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      table: e.isActive("table"),
    }),
  });

  const c = () => editor.chain().focus();

  return (
    <div className="toolbar">
      <Group>
        <Tool label="H1" active={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()} />
        <Tool label="H2" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()} />
        <Tool label="H3" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()} />
      </Group>

      <Group>
        <Tool label="B" active={s.bold} bold onClick={() => c().toggleBold().run()} />
        <Tool label="i" active={s.italic} italic onClick={() => c().toggleItalic().run()} />
        <Tool label="`code`" active={s.code} onClick={() => c().toggleCode().run()} />
      </Group>

      <Group>
        <Tool label={t("lista")} active={s.bullet} onClick={() => c().toggleBulletList().run()} />
        <Tool label="1." active={s.ordered} onClick={() => c().toggleOrderedList().run()} />
        <Tool label={t("tarefa")} active={s.task} onClick={() => c().toggleTaskList().run()} />
      </Group>

      <Group>
        <Tool label={t("citação")} active={s.quote} onClick={() => c().toggleBlockquote().run()} />
        <Tool label={t("bloco de código")} active={s.codeBlock} onClick={() => c().toggleCodeBlock().run()} />
        <Tool label="—" title={t("linha divisória")} onClick={() => c().setHorizontalRule().run()} />
      </Group>

      <Group>
        {onLink && (
          <Tool
            label="[[link]]"
            title={t("Link para outra aula — escolhe da lista de páginas que existem")}
            onClick={onLink}
          />
        )}
        <Tool
          label={t("tabela")}
          active={s.table}
          title={t("Tabela 3×3 com cabeçalho — vira tabela markdown no arquivo")}
          onClick={() =>
            c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        />
        {s.table && (
          <>
            <Tool label={t("+linha")} onClick={() => c().addRowAfter().run()} />
            <Tool label={t("+coluna")} onClick={() => c().addColumnAfter().run()} />
            <Tool label={t("−linha")} onClick={() => c().deleteRow().run()} />
            <Tool label={t("−coluna")} onClick={() => c().deleteColumn().run()} />
          </>
        )}
      </Group>
    </div>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return <div className="toolbar-group">{children}</div>;
}

function Tool({
  label,
  active,
  bold,
  italic,
  title,
  onClick,
}: {
  label: string;
  active?: boolean;
  bold?: boolean;
  italic?: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="btn tool"
      data-active={!!active}
      title={title ?? label}
      onClick={onClick}
      style={{ fontWeight: bold ? 700 : undefined, fontStyle: italic ? "italic" : undefined }}
    >
      {label}
    </button>
  );
}
