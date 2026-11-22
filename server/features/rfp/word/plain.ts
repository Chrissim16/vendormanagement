import { AlignmentType, Document, Footer, Header, LineRuleType, Packer, PageNumber, Paragraph, TextRun } from "docx";

/**
 * The app's own plain layout (Q-14), used while no company template has been uploaded.
 * It is a template like any other, with [Title], [Date] and [Version] on its cover page,
 * so every Word file is made the same way, whichever template is in force.
 */
let made: Promise<Buffer> | null = null;

export function plainTemplate(): Promise<Buffer> {
  made ??= Packer.toBuffer(
    new Document({
      creator: "Vendor Management",
      styles: {
        default: {
          document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { after: 140, line: 276, lineRule: LineRuleType.AUTO } } },
          heading1: { run: { font: "Calibri", size: 32, bold: true, color: "1F2A44" }, paragraph: { spacing: { before: 360, after: 120 }, keepNext: true } },
          heading2: { run: { font: "Calibri", size: 26, bold: true, color: "1F2A44" }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true } },
          heading3: { run: { font: "Calibri", size: 23, bold: true, color: "1F2A44" }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
        },
      },
      sections: [
        {
          headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "[Title]", color: "6B7280", size: 18 })] })] }) },
          footers: {
            default: new Footer({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ["Page ", PageNumber.CURRENT], color: "6B7280", size: 18 })] })],
            }),
          },
          children: [
            new Paragraph({ spacing: { before: 3000 }, children: [new TextRun({ text: "Request for proposal", color: "6B7280", size: 26 })] }),
            new Paragraph({ spacing: { after: 400 }, children: [new TextRun({ text: "[Title]", bold: true, size: 52, color: "1F2A44" })] }),
            new Paragraph({ children: [new TextRun({ text: "[Date]", size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: "[Version]", size: 24 })] }),
          ],
        },
      ],
    }),
  );
  return made;
}
