import { Document, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { passagesOf } from "../features/chat/documents";
import { extractText, PART_BREAK, partName, unwrapped } from "./text";

const pdf = (pages: string[]) =>
  new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: 64 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    pages.forEach((p, i) => {
      if (i) doc.addPage();
      doc.fontSize(11).text(p);
    });
    doc.end();
  });

describe("C-1 reading the words in an uploaded document", () => {
  it("a PDF gives one part per page, with wrapped lines joined into sentences", async () => {
    const long = "The Supplier's total liability under this agreement in any contract year is limited to 150% of the fees paid in that year, whatever the cause.";
    const text = await extractText("pdf", await pdf([`Liability\n${long}`, "Second page."]));
    const parts = text.split(PART_BREAK);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe(`Liability\n${long}`);
    expect(parts[1]).toBe("Second page.");
    expect(partName("a.pdf", 1, 2, parts[1]!)).toBe("page 2");
  });

  it("a Word file gives its paragraphs and table cells, with special characters as written", async () => {
    const data = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: "Fees & payment <net>" }),
              new Paragraph({ text: "Invoices are payable within 30 days." }),
              new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Role")] }), new TableCell({ children: [new Paragraph("Rate é")] })] })] }),
            ],
          },
        ],
      }),
    );
    const text = await extractText("docx", data);
    expect(text).toContain("Fees & payment <net>\nInvoices are payable within 30 days.");
    expect(text).toContain("Role\nRate é");
    expect(text).not.toContain("<w:");
    expect(partName("a.docx", 0, 1, text)).toBeNull();
  });

  it("a workbook gives one part per sheet, named, with a formula's result", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Rates").addRows([
      ["Role", "Day rate"],
      ["Analyst", { formula: "500+20", result: 520 }],
    ]);
    wb.addWorksheet("Notes").addRow(["Valid for one year"]);
    const text = await extractText("xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    const parts = text.split(PART_BREAK);
    expect(parts[0]).toBe("Sheet Rates\nRole | Day rate\nAnalyst | 520");
    expect(partName("a.xlsx", 1, 2, parts[1]!)).toBe("sheet “Notes”");
  });

  it("a file that cannot be read gives no text and no error: old formats, damaged files, files built to swell up", async () => {
    expect(await extractText("doc", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))).toBe("");
    expect(await extractText("pdf", Buffer.from("%PDF-1.7 this is not really a PDF"))).toBe("");
    expect(await extractText("docx", Buffer.from("PK not a zip"))).toBe("");
    // A PDF with a page and no words on it, as a scan is.
    expect(await extractText("pdf", await pdf([""]))).toBe("");
    const bomb = new JSZip();
    bomb.file("[Content_Types].xml", "<Types/>");
    bomb.file("word/document.xml", "<w:p><w:t>" + "A".repeat(70 * 1024 * 1024) + "</w:t></w:p>");
    expect(await extractText("docx", await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }))).toBe("");
  }, 60_000);

  it("text the database would refuse is cleaned", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("S").addRow(["a\u0000b\u0007c"]);
    const read = await extractText("xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    expect([...read].filter((c) => c.charCodeAt(0) < 9)).toEqual([]);
  });
});

describe("C-1 cutting a document into passages", () => {
  it("a laid-out page becomes sentences again", () => {
    expect(unwrapped("Heading\nThis line runs to the right margin and goes on\non the next line.\nShort end.")).toBe(
      "Heading\nThis line runs to the right margin and goes on on the next line.\nShort end.\n",
    );
  });
  it("a heading stays with the clause under it, and nothing is cut inside a word", () => {
    const clause = (n: number) => `${n}. Clause ${n}\n${"The parties agree on this point in full. ".repeat(6).trim()}`;
    const passages = passagesOf([1, 2, 3].map(clause).join("\n"));
    expect(passages).toHaveLength(3);
    passages.forEach((p, i) => expect(p.startsWith(`${i + 1}. Clause ${i + 1}\nThe parties`)).toBe(true));
    const long = passagesOf("word ".repeat(400).trim());
    expect(long.length).toBeGreaterThan(3);
    for (const p of long) expect(p).toMatch(/^(word ?)+$/);
    expect(long.join(" ").split(" ")).toHaveLength(400);
  });
});
