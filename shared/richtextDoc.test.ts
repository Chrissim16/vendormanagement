import { describe, expect, it } from "vitest";
import { parseBlocks, toMarkdown } from "./richtext";
import { blocksToDoc, docToBlocks, type JSONContent } from "./richtextDoc";

const p = (text: string): JSONContent => ({ type: "paragraph", content: [{ type: "text", text }] });
const cell = (text: string, attrs: Record<string, unknown> = {}): JSONContent => ({ type: "tableCell", attrs, content: [p(text)] });

describe("Q-12 the editor's document and the formatted text", () => {
  it("go back and forth without a change", () => {
    const md = "We **invite** *you*.\n\n## Scope\n\n- a\n- b\n\n1. one\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
    expect(toMarkdown(docToBlocks(blocksToDoc(parseBlocks(md))))).toBe(md);
  });

  it("lays merged cells of a pasted table out over the grid, so no text moves to another column", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("Wide", { colspan: 2 }), cell("C")] },
            { type: "tableRow", content: [cell("Tall", { rowspan: 2 }), cell("b2"), cell("c2")] },
            { type: "tableRow", content: [cell("b3"), cell("c3")] },
          ],
        },
      ],
    };
    expect(toMarkdown(docToBlocks(doc))).toBe("| Wide |   | C |\n| --- | --- | --- |\n| Tall | b2 | c2 |\n|   | b3 | c3 |");
  });

  it("keeps a pasted list with levels as one level, in order", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p("one"), { type: "bulletList", content: [{ type: "listItem", content: [p("one.a")] }] }] },
            { type: "listItem", content: [p("two")] },
          ],
        },
      ],
    };
    expect(toMarkdown(docToBlocks(doc))).toBe("- one\n- one.a\n- two");
  });
});
