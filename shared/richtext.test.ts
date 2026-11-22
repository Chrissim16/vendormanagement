import { describe, expect, it } from "vitest";
import { normalise, parseBlocks, parseInline, plainBlocks, plainText, tidyRuns, toMarkdown, type Block } from "./richtext";

describe("formatted section text (Q-12)", () => {
  it("reads paragraphs, headings, lists and tables", () => {
    const md = [
      "We invite you to respond.",
      "It is **important** and *urgent*.",
      "",
      "## Scope",
      "- one",
      "- two",
      "",
      "1. first",
      "2) second",
      "",
      "| Part | Weight |",
      "|---|---|",
      "| Functional | 40% |",
      "| Price \\| terms | 60% |",
    ].join("\n");
    const b = parseBlocks(md);
    expect(b.map((x) => x.kind)).toEqual(["paragraph", "heading", "list", "list", "table"]);
    expect(b[0]).toEqual({
      kind: "paragraph",
      runs: [{ text: "We invite you to respond. It is " }, { text: "important", bold: true }, { text: " and " }, { text: "urgent", italic: true }, { text: "." }],
    });
    expect(b[2]).toMatchObject({ ordered: false, items: [[{ text: "one" }], [{ text: "two" }]] });
    expect(b[3]).toMatchObject({ ordered: true });
    const t = b[4] as Extract<Block, { kind: "table" }>;
    expect(t.rows).toHaveLength(3);
    expect(t.rows[2]![0]).toEqual([{ text: "Price | terms" }]);
  });

  it("writes back what it read, and reads that back the same", () => {
    const samples = [
      "Plain.",
      "A **bold *and italic*** end.",
      "## Heading\n\nText with a \\* star and a back\\\\slash.",
      "- a\n- **b**\n\n1. x\n2. y",
      "| A | B |\n| --- | --- |\n| 1 | two \\| three |",
      "\\# not a heading\n\n\\- not a list\n\n\\1. not numbered",
    ];
    for (const s of samples) {
      const once = toMarkdown(parseBlocks(s));
      expect(parseBlocks(once)).toEqual(parseBlocks(s));
      expect(normalise(once)).toBe(once);
    }
  });

  it("keeps a stray star as a character", () => {
    expect(parseInline("5 * 3 = 15")).toEqual([{ text: "5 * 3 = 15" }]);
    expect(parseInline("**bold** and 2 * 2")).toEqual([{ text: "bold", bold: true }, { text: " and 2 * 2" }]);
  });

  it("opens text from before M11 unchanged, as plain paragraphs", () => {
    const old = "# not a heading\n- not a list\n**not bold**";
    const blocks = plainBlocks(old);
    expect(blocks).toEqual([
      { kind: "paragraph", runs: [{ text: "# not a heading" }] },
      { kind: "paragraph", runs: [{ text: "- not a list" }] },
      { kind: "paragraph", runs: [{ text: "**not bold**" }] },
    ]);
    // Written out and read again, it still says exactly that.
    expect(parseBlocks(toMarkdown(blocks))).toEqual(blocks);
  });

  it("gives the words without formatting", () => {
    expect(plainText(parseBlocks("## Scope\n\n- **one**\n- two\n\n| a | b |\n|-|-|\n| c | d |"))).toBe("Scope\n• one\n• two\na | b\nc | d");
  });

  it("evens out tables with missing cells", () => {
    const t = parseBlocks("| a | b | c |\n| d |")[0] as Extract<Block, { kind: "table" }>;
    expect(t.rows[1]).toHaveLength(3);
  });
});

describe("marks and spaces", () => {
  it("ends bold before the space that follows it, and starts it after the space before it", () => {
    expect(toMarkdown([{ kind: "paragraph", runs: [{ text: "Bold words", bold: true }, { text: " then plain." }] }])).toBe("**Bold words** then plain.");
    expect(toMarkdown([{ kind: "paragraph", runs: [{ text: "Plain " }, { text: "bold", bold: true }, { text: " and " }, { text: "both", bold: true, italic: true }] }])).toBe(
      "Plain **bold** and ***both***",
    );
  });
});

describe("any text the editor can hold", () => {
  it("is read back exactly as it was written, for a thousand random paragraphs", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const pieces = ["word", " ", "*", "**", "\\", "|", "# ", "- ", "1. ", "a_b", "x", "  ", "€ 1,200.00"];
    for (let k = 0; k < 1000; k++) {
      const runs = Array.from({ length: 1 + rnd(6) }, () => ({
        text: Array.from({ length: 1 + rnd(4) }, () => pieces[rnd(pieces.length)]).join(""),
        ...(rnd(2) ? { bold: true as const } : {}),
        ...(rnd(2) ? { italic: true as const } : {}),
      }));
      const kind = rnd(3);
      const block: Block =
        kind === 0 ? { kind: "paragraph", runs } : kind === 1 ? { kind: "list", ordered: !!rnd(2), items: [runs] } : { kind: "table", rows: [[runs, [{ text: "b" }]]] };
      const expected = parseBlocks(toMarkdown([block]));
      const tidy = (b: Block) =>
        JSON.stringify(b.kind === "paragraph" ? tidyRuns(b.runs) : b.kind === "list" ? b.items.map(tidyRuns) : b.kind === "table" ? b.rows.map((r) => r.map(tidyRuns)) : null);
      const want = tidy(block);
      if (want === "[]" || want === "[[]]" || want === '[[[],[{"text":"b"}]]]') continue;
      expect(expected.length, toMarkdown([block])).toBe(1);
      expect(tidy(expected[0]!), toMarkdown([block])).toBe(want);
    }
  });
});
