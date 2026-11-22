import type { Block, Run } from "../../../../shared/richtext";
import { escapeXml } from "./ooxml";

/**
 * Writes the RFP's own text as Word paragraphs, lists and tables (Q-12, Q-14), in the
 * styles a template offers: its headings, list styles and table style, found by name.
 * What a template does not have is written with plain direct formatting instead.
 */

export interface BodyStyles {
  heading: Partial<Record<1 | 2 | 3, string>>;
  listBullet: string | null;
  listNumber: string | null;
  listParagraph: string | null;
  table: string | null;
}

export interface Line {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

const runXml = (r: Line | Run) => {
  const props = [r.bold ? "<w:b/>" : "", r.italic ? "<w:i/>" : "", "color" in r && r.color ? `<w:color w:val="${r.color}"/>` : ""].join("");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`;
};

/**
 * Where a list's numbering goes until the file is put together. Its control characters
 * can never stand in text, which `escapeXml` strips of them, so no words can be taken for it.
 */
const LIST_MARK_OPEN = "\u0001num:";
// eslint-disable-next-line no-control-regex -- the control character is the point: text can never hold it.
export const LIST_MARK = /\u0001num:(\d+)\u0001/g;

/** Collects the body of a document. A list's numbering is filled in when the file is put together. */
export class BodyWriter {
  private out: string[] = [];
  /** One entry per list written, in order: whether it is numbered. */
  readonly lists: boolean[] = [];
  constructor(private styles: BodyStyles) {}

  toString() {
    return this.out.join("");
  }

  paragraph(runs: (Line | Run)[], o: { style?: string | null; keepNext?: boolean; after?: number; pageBreakBefore?: boolean } = {}) {
    const ppr = [
      o.style ? `<w:pStyle w:val="${escapeXml(o.style)}"/>` : "",
      o.keepNext ? "<w:keepNext/>" : "",
      o.pageBreakBefore ? "<w:pageBreakBefore/>" : "",
      o.after != null ? `<w:spacing w:after="${o.after}"/>` : "",
    ].join("");
    this.out.push(`<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${runs.map(runXml).join("")}</w:p>`);
  }

  pageBreak() {
    this.out.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  }

  /** A heading: the template's Heading 1 to 3, or bold text of a matching size where it has none. */
  heading(level: 1 | 2 | 3, runs: (Line | Run)[]) {
    const style = this.styles.heading[level];
    if (style) return this.paragraph(runs, { style });
    const size = { 1: 32, 2: 26, 3: 23 }[level];
    this.out.push(
      // The outline level makes it a heading for Word's navigation, and lets the app find its sections again in a returned copy.
      `<w:p><w:pPr><w:keepNext/><w:spacing w:before="${level === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>${runs
        .map((r) => `<w:r><w:rPr><w:b/>${r.italic ? "<w:i/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${escapeXml(r.text)}</w:t></w:r>`)
        .join("")}</w:p>`,
    );
  }

  list(ordered: boolean, items: Run[][]) {
    const n = this.lists.push(ordered) - 1;
    const style = (ordered ? this.styles.listNumber : this.styles.listBullet) ?? this.styles.listParagraph;
    for (const it of items)
      this.out.push(
        `<w:p><w:pPr>${style ? `<w:pStyle w:val="${escapeXml(style)}"/>` : ""}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${LIST_MARK_OPEN}${n}\u0001"/></w:numPr></w:pPr>${it.map(runXml).join("")}</w:p>`,
      );
  }

  /** A table across the page; the first row is the header and repeats on every page. */
  table(rows: (Line | Run)[][][], o: { widths?: number[]; alignRight?: number[] } = {}) {
    if (!rows.length) return;
    const cols = Math.max(...rows.map((r) => r.length));
    const widths = o.widths ?? Array.from({ length: cols }, () => 1 / cols);
    const pct = widths.map((w) => Math.round(w * 5000));
    const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/>`;
    const tblPr = this.styles.table
      ? `<w:tblStyle w:val="${escapeXml(this.styles.table)}"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>`
      : `<w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar>`;
    const grid = pct.map((w) => `<w:gridCol w:w="${Math.round((w / 5000) * 9000)}"/>`).join("");
    const body = rows
      .map((row, r) => {
        const cells = Array.from({ length: cols }, (_, c) => row[c] ?? []);
        return `<w:tr>${r === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells
          .map((cell, c) => {
            const runs = r === 0 ? cell.map((x) => ({ ...x, bold: true })) : cell;
            const right = o.alignRight?.includes(c) ? '<w:jc w:val="right"/>' : "";
            return `<w:tc><w:tcPr><w:tcW w:w="${pct[c] ?? 0}" w:type="pct"/></w:tcPr><w:p>${right ? `<w:pPr>${right}</w:pPr>` : ""}${runs.map(runXml).join("")}</w:p></w:tc>`;
          })
          .join("")}</w:tr>`;
      })
      .join("");
    this.out.push(`<w:tbl><w:tblPr>${tblPr}</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`);
    // Two tables in a row would melt into one; a paragraph keeps them apart.
    this.out.push("<w:p/>");
  }

  /** A section's formatted text. Its sub-headings sit one level under the section's own heading. */
  blocks(blocks: Block[]) {
    for (const b of blocks) {
      if (b.kind === "paragraph") this.paragraph(b.runs);
      else if (b.kind === "heading") this.heading(b.level, b.runs);
      else if (b.kind === "list") this.list(b.ordered, b.items);
      else this.table(b.rows);
    }
  }
}
