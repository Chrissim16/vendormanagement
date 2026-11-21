import ExcelJS from "exceljs";
import JSZip from "jszip";
import { unpacksWithin } from "./zip";

/**
 * The words in an uploaded document, so that questions about what it says can be
 * answered (C-1). A PDF gives one part per page, a workbook one part per sheet, a Word
 * file one part; parts are separated by a form feed. Old .doc and .xls files and scans
 * give nothing. Reading never fails an upload: a file that cannot be read has no text.
 */

export const PART_BREAK = "\f";
/** More than a long contract; what comes after is left out. */
const MAX_CHARS = 400_000;
const MAX_PARTS = 400;
const MAX_UNPACKED = 60 * 1024 * 1024;

/** The database refuses a zero byte, and control characters carry no words. */
const clean = (s: string) =>
  [...s]
    .map((c) => (c.charCodeAt(0) < 32 && c !== "\n" && c !== "\t" ? " " : c))
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * A PDF gives its text line by line as it is laid out. A line that runs to the right
 * margin and does not end a sentence continues on the next one, so the two are joined;
 * a short line (a heading, the end of a paragraph) keeps its line break.
 */
export function unwrapped(page: string): string {
  const lines = page.split("\n").map((l) => l.trim());
  const widest = Math.max(0, ...lines.map((l) => l.length));
  let out = "";
  lines.forEach((line, i) => {
    const runsOn = line.length >= widest * 0.7 && !/[.!?:]$/.test(line) && !!lines[i + 1];
    out += line + (runsOn ? " " : "\n");
  });
  return out;
}

async function pdfParts(data: Buffer): Promise<string[]> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(data));
  const parts: string[] = [];
  let chars = 0;
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PARTS) && chars < MAX_CHARS; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    let text = "";
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) text += (item.str ?? "") + (item.hasEOL ? "\n" : "");
    text = unwrapped(text);
    parts.push(text);
    chars += text.length;
  }
  return parts;
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (entities[e] ?? m),
  );

async function wordParts(data: Buffer): Promise<string[]> {
  if (!unpacksWithin(data, MAX_UNPACKED)) return [];
  const xml = await (await JSZip.loadAsync(data)).file("word/document.xml")?.async("string");
  if (!xml) return [];
  // One line per paragraph; a table cell is a paragraph too.
  const paragraphs = xml.split(/<\/w:p>/).map((p) =>
    decode(
      p
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<w:br\/>/g, "\n")
        .replace(/<w:(?!t[ >])[^>]*>|<\/w:(?!t>)[^>]*>/g, "")
        .replace(/<[^>]+>/g, ""),
    ),
  );
  return [paragraphs.join("\n")];
}

const cell = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if ("result" in o) return cell(o.result);
    if ("text" in o) return cell(o.text);
    return "";
  }
  return String(v);
};

async function sheetParts(data: Buffer): Promise<string[]> {
  if (!unpacksWithin(data, MAX_UNPACKED)) return [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  return wb.worksheets.slice(0, MAX_PARTS).map((ws) => {
    const lines = [`Sheet ${ws.name}`];
    ws.eachRow((row) => {
      const values = (row.values as unknown[])
        .slice(1)
        .map(cell)
        .map((t) => t.trim());
      if (values.some(Boolean)) lines.push(values.filter(Boolean).join(" | "));
    });
    return lines.join("\n");
  });
}

/** The text of a file with the given extension, or an empty text when there is none to read. */
export async function extractText(ext: string, data: Buffer): Promise<string> {
  try {
    const parts = ext === "pdf" ? await pdfParts(data) : ext === "docx" ? await wordParts(data) : ext === "xlsx" ? await sheetParts(data) : [];
    const text = parts.map(clean).join(PART_BREAK).slice(0, MAX_CHARS);
    return text.replace(/\f/g, "").trim() ? text : "";
  } catch (e) {
    console.error(`Could not read the text of a ${ext} file:`, (e as Error).message);
    return "";
  }
}

/** What a part of a file is called, by the file's kind. */
export function partName(fileName: string, index: number, parts: number, text: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return `page ${index + 1}`;
  if (ext === "xlsx") return /^Sheet (.+)$/m.exec(text)?.[1] ? `sheet “${/^Sheet (.+)$/m.exec(text)![1]}”` : `sheet ${index + 1}`;
  return parts > 1 ? `part ${index + 1}` : null;
}
