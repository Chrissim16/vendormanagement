import type { JSONContent } from "@tiptap/core";
import { Extension } from "@tiptap/core";
import { ListItem } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import clsx from "clsx";
import { Bold, Columns3, Heading2, Heading3, Italic, List, ListOrdered, Rows3, Table2, Trash2 } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { normalise, parseBlocks, tidyRuns, toMarkdown, type Block, type Run } from "../../../shared/richtext";

/**
 * The editor for formatted text (Q-12), a pattern of its own (design guide, "Formatted
 * text"). It edits exactly what shared/richtext can hold: paragraphs, two levels of
 * sub-heading, bullet and numbered lists of one level, bold, italic and simple tables with
 * a header row. Its value is that text as Markdown, so what it shows is what is saved and
 * what the Word file holds. Tab moves between table cells and otherwise leaves the editor,
 * so the keyboard is never caught in it.
 */

// ---------- Between the editor's document and the app's blocks

const runsOf = (nodes: JSONContent[] | undefined): Run[] =>
  (nodes ?? []).flatMap((n) => {
    if (n.type === "text")
      return [
        {
          text: n.text ?? "",
          ...(n.marks?.some((m) => m.type === "bold") ? { bold: true as const } : {}),
          ...(n.marks?.some((m) => m.type === "italic") ? { italic: true as const } : {}),
        },
      ];
    if (n.type === "hardBreak") return [{ text: " " }];
    // A paragraph inside a list item or a cell: its words, one after the other.
    return [...runsOf(n.content), { text: " " }];
  });

export function docToBlocks(doc: JSONContent): Block[] {
  const out: Block[] = [];
  for (const n of doc.content ?? []) {
    if (n.type === "paragraph") {
      const runs = tidyRuns(runsOf(n.content));
      if (runs.length) out.push({ kind: "paragraph", runs });
    } else if (n.type === "heading") {
      const runs = tidyRuns(runsOf(n.content));
      if (runs.length) out.push({ kind: "heading", level: n.attrs?.level === 3 ? 3 : 2, runs });
    } else if (n.type === "bulletList" || n.type === "orderedList") {
      // A list pasted in with levels is kept as one level.
      const flat = (list: JSONContent): Run[][] =>
        (list.content ?? []).flatMap((li) => [
          tidyRuns(runsOf((li.content ?? []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList"))),
          ...(li.content ?? []).filter((c) => c.type === "bulletList" || c.type === "orderedList").flatMap(flat),
        ]);
      const items = flat(n).filter((it) => it.length);
      if (items.length) out.push({ kind: "list", ordered: n.type === "orderedList", items });
    } else if (n.type === "table") {
      const rows = (n.content ?? []).map((tr) => (tr.content ?? []).map((cell) => tidyRuns(runsOf(cell.content))));
      const width = Math.max(0, ...rows.map((r) => r.length));
      if (width) out.push({ kind: "table", rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? [])) });
    }
  }
  return out;
}

const textNodes = (runs: Run[]): JSONContent[] =>
  runs.map((r) => ({ type: "text", text: r.text, ...(r.bold || r.italic ? { marks: [...(r.bold ? [{ type: "bold" }] : []), ...(r.italic ? [{ type: "italic" }] : [])] } : {}) }));
const para = (runs: Run[]): JSONContent => ({ type: "paragraph", ...(runs.length ? { content: textNodes(runs) } : {}) });

export function blocksToDoc(blocks: Block[]): JSONContent {
  const content = blocks.map((b): JSONContent => {
    if (b.kind === "paragraph") return para(b.runs);
    if (b.kind === "heading") return { type: "heading", attrs: { level: b.level }, content: textNodes(b.runs) };
    if (b.kind === "list") return { type: b.ordered ? "orderedList" : "bulletList", content: b.items.map((it) => ({ type: "listItem", content: [para(it)] })) };
    return {
      type: "table",
      content: b.rows.map((row, r) => ({ type: "tableRow", content: row.map((cell) => ({ type: r === 0 ? "tableHeader" : "tableCell", content: [para(cell)] })) })),
    };
  });
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const markdownOf = (editor: Editor) => toMarkdown(docToBlocks(editor.getJSON()));

/** Tab moves to the next cell of a table and otherwise leaves the editor; lists keep one level. */
const KeyboardStaysFree = Extension.create({
  name: "keyboardStaysFree",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => (editor.isActive("table") ? editor.commands.goToNextCell() : false),
      "Shift-Tab": ({ editor }) => (editor.isActive("table") ? editor.commands.goToPreviousCell() : false),
    };
  },
});
const FlatListItem = ListItem.extend({
  addKeyboardShortcuts() {
    return { Enter: () => this.editor.commands.splitListItem(this.name) };
  },
});
const PlainTable = Table.extend({
  addKeyboardShortcuts() {
    return {};
  },
});

// ---------- The toolbar: one stop for the Tab key; the arrow keys move along it

function Tool({ label, active, onRun, children, disabled }: { label: string; active?: boolean; onRun: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      // Keep the cursor in the text while a button is clicked.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={clsx(
        "grid h-8 w-8 place-items-center rounded-lg text-ink-2 transition hover:bg-sunk hover:text-ink disabled:opacity-30",
        active && "bg-tint text-accent-ink hover:bg-tint",
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, label }: { editor: Editor; label: string }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      table: e.isActive("table"),
    }),
  });
  const ref = useRef<HTMLDivElement>(null);
  const chain = () => editor.chain().focus();
  // Roving focus: the first enabled button takes Tab; arrows, Home and End move between them.
  useEffect(() => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    if (buttons.length && !buttons.some((b) => b.tabIndex === 0)) buttons[0]!.tabIndex = 0;
  });
  const onKey = (e: KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    const next = buttons[(to + buttons.length) % buttons.length]!;
    buttons.forEach((b) => (b.tabIndex = b === next ? 0 : -1));
    next.focus();
  };
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={`Formatting for ${label.toLowerCase()}`}
      onKeyDown={onKey}
      className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1"
    >
      <Tool label="Bold (Ctrl+B)" active={s.bold} onRun={() => chain().toggleBold().run()}>
        <Bold size={16} aria-hidden />
      </Tool>
      <Tool label="Italic (Ctrl+I)" active={s.italic} onRun={() => chain().toggleItalic().run()}>
        <Italic size={16} aria-hidden />
      </Tool>
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      <Tool label="Heading (Ctrl+Alt+2)" active={s.h2} onRun={() => chain().toggleHeading({ level: 2 }).run()} disabled={s.table}>
        <Heading2 size={16} aria-hidden />
      </Tool>
      <Tool label="Smaller heading (Ctrl+Alt+3)" active={s.h3} onRun={() => chain().toggleHeading({ level: 3 }).run()} disabled={s.table}>
        <Heading3 size={16} aria-hidden />
      </Tool>
      <Tool label="Bullet list (Ctrl+Shift+8)" active={s.bullets} onRun={() => chain().toggleBulletList().run()} disabled={s.table}>
        <List size={16} aria-hidden />
      </Tool>
      <Tool label="Numbered list (Ctrl+Shift+7)" active={s.numbers} onRun={() => chain().toggleOrderedList().run()} disabled={s.table}>
        <ListOrdered size={16} aria-hidden />
      </Tool>
      <span aria-hidden className="mx-1 h-5 w-px bg-line" />
      {!s.table ? (
        <Tool label="Insert a table" onRun={() => chain().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>
          <Table2 size={16} aria-hidden />
        </Tool>
      ) : (
        <>
          <Tool label="Add a row below" onRun={() => chain().addRowAfter().run()}>
            <Rows3 size={16} aria-hidden />
          </Tool>
          <Tool label="Add a column to the right" onRun={() => chain().addColumnAfter().run()}>
            <Columns3 size={16} aria-hidden />
          </Tool>
          <Tool label="Remove this row" onRun={() => chain().deleteRow().run()}>
            <Rows3 size={16} aria-hidden className="text-[var(--crit-text)]" />
          </Tool>
          <Tool label="Remove this column" onRun={() => chain().deleteColumn().run()}>
            <Columns3 size={16} aria-hidden className="text-[var(--crit-text)]" />
          </Tool>
          <Tool label="Remove the table" onRun={() => chain().deleteTable().run()}>
            <Trash2 size={16} aria-hidden />
          </Tool>
        </>
      )}
    </div>
  );
}

/**
 * The editor. `value` and `onChange` carry the text as Markdown. A new `value` from outside
 * (a discard, a colleague's save) replaces what is shown only when it says something else.
 */
export function RichTextEditor({
  value,
  onChange,
  label,
  placeholder,
  invalid,
  describedBy,
}: {
  value: string;
  onChange: (markdown: string) => void;
  label: string;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const changed = useRef(onChange);
  changed.current = onChange;
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        blockquote: false,
        codeBlock: false,
        code: false,
        hardBreak: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        link: false,
        listItem: false,
        listKeymap: false,
      }),
      FlatListItem,
      PlainTable.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      KeyboardStaysFree,
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: blocksToDoc(parseBlocks(value)),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        ...(invalid ? { "aria-invalid": "true" } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
        class: "rich min-h-[96px] px-4 py-3 text-sm",
      },
    },
    onUpdate: ({ editor: e }) => changed.current(markdownOf(e)),
  });
  // Follow a value set from outside, unless it is what the editor already holds.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (normalise(value) !== markdownOf(editor)) editor.commands.setContent(blocksToDoc(parseBlocks(value)), { emitUpdate: false });
  }, [value, editor]);
  useEffect(() => {
    if (!editor) return;
    editor.setOptions({
      editorProps: {
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": label,
          ...(invalid ? { "aria-invalid": "true" } : {}),
          ...(describedBy ? { "aria-describedby": describedBy } : {}),
          class: "rich min-h-[96px] px-4 py-3 text-sm",
        },
      },
    });
  }, [editor, label, invalid, describedBy]);
  if (!editor) return null;
  return (
    <div
      className={clsx(
        "min-w-0 rounded-2xl border bg-surface focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)]",
        invalid ? "border-[var(--crit-text)]" : "border-line-2 hover:border-ink-3",
      )}
    >
      <Toolbar editor={editor} label={label} />
      <EditorContent editor={editor} />
    </div>
  );
}
