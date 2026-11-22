/**
 * The formatted text of an RFP section (Q-12): paragraphs, sub-headings, bullet and
 * numbered lists, bold, italic and simple tables, and nothing else. It is stored as a
 * small, strict subset of Markdown, so the AI can write it and a person can read it raw,
 * and it is read into blocks here, the same way on the server (Word file, history, the
 * AI's input) and in the screens (the editor, the differences of a rewrite).
 *
 * The subset:
 * - blocks are separated by an empty line;
 * - `## ` starts a sub-heading, `### ` a smaller one (`#` counts as `##`, more than three as `###`);
 * - `- `, `* ` or `+ ` starts a bullet, `1. ` or `1) ` a numbered item; lists have one level;
 * - a line that starts with `|` is a table row; the first row is the header, a `|---|` row under it is optional;
 * - `**` switches bold on or off and `*` italic; a backslash makes the next character plain.
 */

export interface Run {
  text: string;
  bold?: true;
  italic?: true;
}
export type Block =
  | { kind: "paragraph"; runs: Run[] }
  | { kind: "heading"; level: 2 | 3; runs: Run[] }
  | { kind: "list"; ordered: boolean; items: Run[][] }
  /** The first row is the header row. Every row has the same number of cells. */
  | { kind: "table"; rows: Run[][][] };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|/;
const RULE_ROW = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** The runs of one line of inline text. An unmatched `**` or `*` is plain text. */
export function parseInline(src: string): Run[] {
  type Tok = { t: "text"; s: string } | { t: "b" } | { t: "i" };
  const toks: Tok[] = [];
  let buf = "";
  const flush = () => {
    if (buf) toks.push({ t: "text", s: buf });
    buf = "";
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "\\" && i + 1 < src.length) {
      buf += src[++i];
    } else if (c === "*" && src[i + 1] === "*") {
      flush();
      toks.push({ t: "b" });
      i++;
    } else if (c === "*") {
      flush();
      toks.push({ t: "i" });
    } else buf += c;
  }
  flush();
  // An odd number of switches leaves the last one without its partner: that one is a plain character.
  for (const kind of ["b", "i"] as const) {
    const at = toks.flatMap((x, i) => (x.t === kind ? [i] : []));
    if (at.length % 2) toks[at[at.length - 1]!] = { t: "text", s: kind === "b" ? "**" : "*" };
  }
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  for (const x of toks) {
    if (x.t === "b") bold = !bold;
    else if (x.t === "i") italic = !italic;
    else pushRun(runs, { text: x.s, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) });
  }
  return runs;
}

const sameMarks = (a: Run, b: Run) => !!a.bold === !!b.bold && !!a.italic === !!b.italic;
function pushRun(runs: Run[], r: Run) {
  if (!r.text) return;
  const last = runs[runs.length - 1];
  if (last && sameMarks(last, r)) last.text += r.text;
  else runs.push({ ...r });
}
/** Runs with neighbours of the same marks joined and empty ones left out, so equal text has one shape. */
export function tidyRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const text = r.text.replace(/\s+/g, " ");
    // Spaces at the edge of bold or italic words carry no mark, so the same text always has one shape.
    const marked = r.bold || r.italic;
    const lead = marked ? /^\s*/.exec(text)![0] : "";
    const trail = marked && text.length > lead.length ? /\s*$/.exec(text)![0] : "";
    pushRun(out, { text: lead });
    pushRun(out, { text: text.slice(lead.length, text.length - trail.length), ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}) });
    pushRun(out, { text: trail });
  }
  // One space between words, also where two runs meet.
  for (const r of out) r.text = r.text.replace(/\s+/g, " ");
  for (let i = 1; i < out.length; i++) if (/\s$/.test(out[i - 1]!.text)) out[i]!.text = out[i]!.text.replace(/^\s+/, "");
  if (out.length) {
    out[0]!.text = out[0]!.text.replace(/^\s+/, "");
    out[out.length - 1]!.text = out[out.length - 1]!.text.replace(/\s+$/, "");
  }
  return out.filter((r) => r.text);
}

/** Splits a table row into its cells, at the bars that are not escaped. */
function cellsOf(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) buf += s[i] + s[++i]!;
    else if (s[i] === "|") {
      out.push(buf);
      buf = "";
    } else buf += s[i];
  }
  out.push(buf);
  return out.map((c) => c.trim());
}

/** The blocks of a section's text. Anything that is not a heading, a list or a table is a paragraph. */
export function parseBlocks(md: string | null | undefined): Block[] {
  const lines = (md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const startsBlock = (l: string) => HEADING.test(l) || BULLET.test(l) || NUMBERED.test(l) || TABLE_ROW.test(l);
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      const runs = tidyRuns(parseInline(h[2]!));
      if (runs.length) blocks.push({ kind: "heading", level: h[1]!.length >= 3 ? 3 : 2, runs });
      i++;
      continue;
    }
    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i]!.trim()) {
        const l = lines[i]!;
        const m = (ordered ? NUMBERED : BULLET).exec(l) ?? (ordered ? BULLET : NUMBERED).exec(l);
        if (m) items.push(m[1]!);
        else if (HEADING.test(l) || TABLE_ROW.test(l)) break;
        // A line that is not an item carries on the item before it.
        else items[items.length - 1] += ` ${l.trim()}`;
        i++;
      }
      const runs = items.map((t) => tidyRuns(parseInline(t))).filter((r) => r.length);
      if (runs.length) blocks.push({ kind: "list", ordered, items: runs });
      continue;
    }
    if (TABLE_ROW.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        if (!(rows.length === 1 && RULE_ROW.test(lines[i]!))) rows.push(cellsOf(lines[i]!));
        i++;
      }
      const width = Math.max(...rows.map((r) => r.length));
      blocks.push({ kind: "table", rows: rows.map((r) => Array.from({ length: width }, (_, n) => tidyRuns(parseInline(r[n] ?? "")))) });
      continue;
    }
    const parts: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !(parts.length && startsBlock(lines[i]!))) parts.push(lines[i++]!.trim());
    const runs = tidyRuns(parseInline(parts.join(" ")));
    if (runs.length) blocks.push({ kind: "paragraph", runs });
  }
  return blocks;
}

/** Text written before M11 (Q-12): every line is a paragraph, read as it was typed, with nothing taken for formatting. */
export const plainBlocks = (text: string | null | undefined): Block[] =>
  (text ?? "")
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ kind: "paragraph" as const, runs: [{ text: t.replace(/\s+/g, " ") }] }));

/** Escapes what would otherwise be read as formatting. */
function escapeText(s: string, inTable: boolean): string {
  let out = s.replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
  if (inTable) out = out.replace(/\|/g, "\\|");
  return out;
}
export function inlineToMarkdown(untidy: Run[], inTable = false): string {
  const runs = tidyRuns(untidy);
  let out = "";
  let bold = false;
  let italic = false;
  for (const r of runs) {
    if (!r.text) continue;
    // A mark goes on and off around the words only, so that "** bold**" never appears.
    const lead = /^\s*/.exec(r.text)![0];
    const trail = r.text.length > lead.length ? /\s*$/.exec(r.text)![0] : "";
    const core = r.text.slice(lead.length, r.text.length - trail.length);
    // Marks that end, end before the spaces; marks that begin, begin after them.
    if (core && bold && !r.bold) {
      out += "**";
      bold = false;
    }
    if (core && italic && !r.italic) {
      out += "*";
      italic = false;
    }
    out += escapeText(lead, inTable);
    if (!core) continue;
    if (!bold && r.bold) {
      out += "**";
      bold = true;
    }
    if (!italic && r.italic) {
      out += "*";
      italic = true;
    }
    out += escapeText(core, inTable);
    if (trail) {
      if (bold) {
        out += "**";
        bold = false;
      }
      if (italic) {
        out += "*";
        italic = false;
      }
      out += escapeText(trail, inTable);
    }
  }
  if (bold) out += "**";
  if (italic) out += "*";
  return out;
}
/** A paragraph that would start like a heading, an item or a table row starts with a backslash instead. */
const guardStart = (s: string) => (/^(#|[-+]\s|\d{1,3}[.)]\s|\|)/.test(s) ? `\\${s}` : s);

export function toMarkdown(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.kind === "paragraph") return guardStart(inlineToMarkdown(b.runs));
      if (b.kind === "heading") return `${b.level === 2 ? "##" : "###"} ${inlineToMarkdown(b.runs)}`;
      if (b.kind === "list") return b.items.map((it, n) => `${b.ordered ? `${n + 1}.` : "-"} ${inlineToMarkdown(it)}`).join("\n");
      const row = (r: Run[][]) => `| ${r.map((c) => inlineToMarkdown(c, true) || " ").join(" | ")} |`;
      const [head, ...rest] = b.rows;
      if (!head) return "";
      return [row(head), `|${head.map(() => " --- ").join("|")}|`, ...rest.map(row)].join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

/** The text of runs without their marks. */
export const runsText = (runs: Run[]) => runs.map((r) => r.text).join("");

/** Every piece of text in reading order: paragraphs, headings, list items and table cells. */
export function textUnits(blocks: Block[]): Run[][] {
  return blocks.flatMap((b) => (b.kind === "list" ? b.items : b.kind === "table" ? b.rows.flat() : [b.runs]));
}

/** The words of a section without any formatting, one line per paragraph, item or row. For the history, the AI's input and searching. */
export function plainText(blocks: Block[]): string {
  return blocks
    .flatMap((b) =>
      b.kind === "list"
        ? b.items.map((it, n) => `${b.ordered ? `${n + 1}.` : "•"} ${runsText(it)}`)
        : b.kind === "table"
          ? b.rows.map((r) => r.map(runsText).join(" | "))
          : [runsText(b.runs)],
    )
    .join("\n");
}

/** Whether a stored text has anything in it once read. */
export const isBlank = (md: string | null | undefined) => parseBlocks(md).length === 0;

/** The same text in its one tidy form: what the editor would save for it. */
export const normalise = (md: string | null | undefined): string => toMarkdown(parseBlocks(md));

/** At most this many rows and columns in one table; a Word page has no room for more. */
export const TABLE_LIMITS = { rows: 60, columns: 8 };
