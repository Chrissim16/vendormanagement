import { tidyRuns, type Block, type Run } from "./richtext";

/**
 * Between the editor's own document (Tiptap's JSON, Q-12) and the blocks of formatted
 * text. Kept apart from the editor so that it is tested like every other rule.
 */
export interface JSONContent {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
  marks?: { type: string }[];
  text?: string;
}

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
      // A table pasted from Word or Excel can have merged cells; they are laid out over the grid, the words in the first cell and the others left empty, so no text moves to another column.
      const rows: Run[][][] = [];
      const taken: boolean[][] = [];
      (n.content ?? []).forEach((tr, r) => {
        const row = (rows[r] ??= []);
        let c = 0;
        for (const cell of tr.content ?? []) {
          while (taken[r]?.[c]) row[c++] ??= [];
          const span = Math.max(1, Math.min(8, Number(cell.attrs?.colspan) || 1));
          const down = Math.max(1, Math.min(60, Number(cell.attrs?.rowspan) || 1));
          for (let k = 0; k < span; k++) {
            row[c + k] = k === 0 ? tidyRuns(runsOf(cell.content)) : [];
            for (let d = 1; d < down; d++) (taken[r + d] ??= [])[c + k] = true;
          }
          c += span;
        }
        while (taken[r]?.[c]) row[c++] ??= [];
      });
      for (let r = 0; r < rows.length; r++) rows[r] = Array.from({ length: rows[r]!.length }, (_, i) => rows[r]![i] ?? []);
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
