import { deflateSync } from "node:zlib";
import { AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, LineRuleType, Packer, PageNumber, Paragraph, TabStopType, TextRun } from "docx";
import JSZip from "jszip";
import { WORD_MAIN, WORD_TEMPLATE_MAIN } from "./ooxml";

/**
 * An invented company template (Q-14), for trying the app: "Larkspur & Vale", which does
 * not exist, with a logo drawn here. It has what a real company template has: a cover
 * page with [Title], [Date] and [Version] among its own words, a header with the logo, a
 * footer with page numbers, its own fonts, colours and heading styles. The company's real
 * template is never in the project; an admin uploads it in the app at work.
 */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** The invented logo: a teal disc with a leaf-shaped cut and two bars, as a small PNG. */
export function exampleLogo(): Buffer {
  const w = 360;
  const h = 120;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const at = y * (w * 4 + 1) + 1 + x * 4;
      const disc = (x - 60) ** 2 + (y - 60) ** 2 < 50 ** 2;
      const leaf = (x - 75) ** 2 + (y - 45) ** 2 < 30 ** 2 && (x - 45) ** 2 + (y - 75) ** 2 < 30 ** 2;
      const bar = x >= 130 && x <= 340 && ((y >= 38 && y <= 54) || (y >= 66 && y <= 76 && x <= 280));
      const [r, g, b, a] = disc && !leaf ? [14, 116, 120, 255] : leaf ? [244, 176, 64, 255] : bar ? [31, 42, 68, 255] : [255, 255, 255, 0];
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
      raw[at + 3] = a;
    }
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const TEAL = "0E7478";
const NAVY = "1F2A44";

let made: Promise<Buffer> | null = null;

/** The example template as a Word template file (.dotx). */
export function exampleTemplate(): Promise<Buffer> {
  made ??= (async () => {
    const logo = exampleLogo();
    const docx = await Packer.toBuffer(
      new Document({
        creator: "Larkspur & Vale (invented example)",
        title: "RFP template",
        styles: {
          default: {
            document: { run: { font: "Georgia", size: 21, color: "222222" }, paragraph: { spacing: { after: 160, line: 288, lineRule: LineRuleType.AUTO } } },
            heading1: {
              run: { font: "Trebuchet MS", size: 30, bold: true, color: TEAL },
              paragraph: { spacing: { before: 420, after: 140 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: TEAL, space: 4 } } },
            },
            heading2: { run: { font: "Trebuchet MS", size: 25, bold: true, color: NAVY }, paragraph: { spacing: { before: 260, after: 100 }, keepNext: true } },
            heading3: { run: { font: "Trebuchet MS", size: 22, bold: true, italics: true, color: NAVY }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true } },
          },
          paragraphStyles: [
            { id: "ListBullet", name: "List Bullet", basedOn: "Normal", run: {}, paragraph: { indent: { left: 567, hanging: 283 }, spacing: { after: 80 } } },
            { id: "ListNumber", name: "List Number", basedOn: "Normal", run: {}, paragraph: { indent: { left: 567, hanging: 340 }, spacing: { after: 80 } } },
          ],
        },
        sections: [
          {
            properties: { titlePage: true },
            headers: {
              first: new Header({ children: [new Paragraph({ children: [] })] }),
              default: new Header({
                children: [
                  new Paragraph({
                    tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
                    children: [
                      new ImageRun({ type: "png", data: logo, transformation: { width: 96, height: 32 } }),
                      new TextRun({ text: "\t[Title]", font: "Trebuchet MS", size: 17, color: "6B7280" }),
                    ],
                  }),
                ],
              }),
            },
            footers: {
              first: new Footer({ children: [new Paragraph({ children: [] })] }),
              default: new Footer({
                children: [
                  new Paragraph({
                    tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
                    children: [
                      new TextRun({ text: "Larkspur & Vale · Confidential", font: "Trebuchet MS", size: 16, color: "6B7280" }),
                      new TextRun({ children: ["\tPage ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], font: "Trebuchet MS", size: 16, color: "6B7280" }),
                    ],
                  }),
                ],
              }),
            },
            children: [
              new Paragraph({ children: [new ImageRun({ type: "png", data: logo, transformation: { width: 240, height: 80 } })] }),
              new Paragraph({ spacing: { before: 2400 }, children: [new TextRun({ text: "REQUEST FOR PROPOSAL", font: "Trebuchet MS", size: 22, bold: true, color: TEAL })] }),
              new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ text: "[Title]", font: "Trebuchet MS", size: 56, bold: true, color: NAVY })] }),
              new Paragraph({ children: [new TextRun({ text: "Issued on [Date]", size: 24 })] }),
              new Paragraph({ children: [new TextRun({ text: "[Version]", size: 24 })] }),
              new Paragraph({
                spacing: { before: 2400 },
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: "Prepared by the Finance IT team of Larkspur & Vale, an invented organisation used only to try this app.",
                    size: 18,
                    italics: true,
                    color: "6B7280",
                  }),
                ],
              }),
            ],
          },
        ],
      }),
    );
    // Saved as a Word template, the way an admin would have it.
    const zip = await JSZip.loadAsync(docx);
    const types = await zip.file("[Content_Types].xml")!.async("string");
    zip.file("[Content_Types].xml", types.split(WORD_MAIN).join(WORD_TEMPLATE_MAIN));
    return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  })();
  return made;
}
