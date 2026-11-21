import PDFDocument from "pdfkit";

/**
 * PDFs are drawn directly (the platform has no browser to print from). This is the small
 * set of building blocks every PDF of the app is made from: a title block, headings,
 * paragraphs, simple tables, and a footer with page numbers on every page.
 */

const INK = "#1A1F2B";
const INK_2 = "#555D70";
const LINE = "#D9DFE8";
const ACCENT = "#0077C8";
const MARGIN = 56;

/**
 * The built-in PDF fonts know Western European characters only. Anything else (for
 * example an emoji in a comment) is replaced, so the file is always readable.
 */
export function printable(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\n\x20-\x7E\u00A1-\u00FF\u2013\u2014\u20AC\u2022]/g, (c) => (c === "\u00A0" ? " " : "?"));
}

export interface Column {
  header: string;
  /** Share of the page width; the shares of a table add up to 1. */
  width: number;
  align?: "left" | "right";
}

export interface Pdf {
  title(context: string, title: string): void;
  heading(text: string): void;
  paragraph(text: string, options?: { muted?: boolean; bold?: boolean }): void;
  /** Two columns of label and value. */
  facts(rows: [label: string, value: string][]): void;
  table(columns: Column[], rows: string[][]): void;
  gap(points?: number): void;
}

/** Builds a PDF by calling `draw` with the building blocks, and returns the file. `footer` is printed on every page next to the page number. */
export function makePdf(info: { title: string; footer: string }, draw: (pdf: Pdf) => void): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: 64, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: printable(info.title), Creator: "Vendor Management" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = doc.page.width - 2 * MARGIN;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const room = (needed: number) => {
    if (doc.y + needed > bottom()) doc.addPage();
  };
  const pdf: Pdf = {
    title(context, title) {
      doc.font("Helvetica").fontSize(10).fillColor(INK_2).text(printable(context), MARGIN, doc.y, { width });
      doc.moveDown(0.3).font("Helvetica-Bold").fontSize(22).fillColor(INK).text(printable(title), { width });
      doc.moveDown(0.8);
    },
    heading(text) {
      room(60);
      doc.moveDown(0.6).font("Helvetica-Bold").fontSize(13).fillColor(INK).text(printable(text), MARGIN, doc.y, { width });
      doc.moveDown(0.4);
    },
    paragraph(text, options = {}) {
      doc
        .font(options.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(10.5)
        .fillColor(options.muted ? INK_2 : INK)
        .text(printable(text), MARGIN, doc.y, { width, lineGap: 2 });
      doc.moveDown(0.4);
    },
    facts(rows) {
      for (const [label, value] of rows) {
        room(20);
        const y = doc.y;
        doc.font("Helvetica").fontSize(10.5).fillColor(INK_2).text(printable(label), MARGIN, y, { width: 150 });
        const after = doc.y;
        doc.fillColor(INK).text(printable(value), MARGIN + 160, y, { width: width - 160 });
        doc.y = Math.max(after, doc.y) + 4;
      }
    },
    table(columns, rows) {
      const x = columns.map((_, i) => MARGIN + columns.slice(0, i).reduce((n, c) => n + c.width, 0) * width);
      const row = (cells: string[], header: boolean) => {
        doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(header ? 9 : 10);
        const height = Math.max(...cells.map((cell, i) => doc.heightOfString(printable(cell), { width: columns[i]!.width * width - 8 }))) + 10;
        room(height);
        const y = doc.y + 5;
        cells.forEach((cell, i) =>
          doc.fillColor(header ? INK_2 : INK).text(printable(cell), x[i]!, y, { width: columns[i]!.width * width - 8, align: columns[i]!.align ?? "left" }),
        );
        doc.y = y + height - 5;
        doc
          .moveTo(MARGIN, doc.y)
          .lineTo(MARGIN + width, doc.y)
          .lineWidth(0.5)
          .strokeColor(LINE)
          .stroke();
      };
      row(
        columns.map((c) => c.header),
        true,
      );
      rows.forEach((r) => row(r, false));
      doc.moveDown(0.6);
    },
    gap(points = 8) {
      doc.y += points;
    },
  };
  draw(pdf);
  // The footer goes on every page once the number of pages is known.
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i);
    const y = doc.page.height - 44;
    doc.page.margins.bottom = 0;
    doc
      .moveTo(MARGIN, y - 8)
      .lineTo(MARGIN + width, y - 8)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(8.5)
      .fillColor(INK_2)
      .text(printable(info.footer), MARGIN, y, { width: width - 80, lineBreak: false });
    doc.fillColor(ACCENT).text(`Page ${i + 1} of ${pages.count}`, MARGIN + width - 80, y, { width: 80, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
