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

/** The database refuses a zero byte, and control characters carry no words. Cut to size first, so a huge text is never worked on whole. */
const clean = (s: string) =>
  s
    .slice(0, MAX_CHARS)
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is being removed.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
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
  try {
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
  } finally {
    // Without this every file read would leave its parsed pages in memory.
    await (doc as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
  }
}

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]{1,8}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] !== "#") return entities[e.toLowerCase()] ?? m;
    const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " ";
  });

/** More XML than any real contract has; what comes after is left out. */
const MAX_XML = 8 * 1024 * 1024;

/**
 * The text of a Word file's main part, read in one pass from left to right, so that no
 * file, however it is built, takes more than a moment. Only the words a reader sees are
 * kept: text that was deleted with tracked changes and field codes are left out.
 */
export function wordText(xmlFull: string): string {
  const xml = xmlFull.slice(0, MAX_XML);
  let out = "";
  let keep = false;
  let at = 0;
  while (at < xml.length && out.length < MAX_CHARS * 2) {
    const open = xml.indexOf("<", at);
    if (open < 0) break;
    if (keep) out += xml.slice(at, open);
    const close = xml.indexOf(">", open + 1);
    if (close < 0) break;
    const tag = xml.slice(open + 1, Math.min(close, open + 40));
    const name = /^\/?[\w:]+/.exec(tag)?.[0] ?? "";
    if (name === "w:t") keep = !xml.startsWith("/>", close - 1);
    else if (name === "/w:t") keep = false;
    else if (name === "w:tab") out += "\t";
    else if (name === "w:br" || name === "w:cr" || name === "/w:p") out += "\n";
    at = close + 1;
  }
  return decode(out);
}

async function wordParts(data: Buffer): Promise<string[]> {
  if (!unpacksWithin(data, MAX_UNPACKED)) return [];
  const xml = await (await JSZip.loadAsync(data)).file("word/document.xml")?.async("string");
  return xml ? [wordText(xml)] : [];
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
    return text.split(PART_BREAK).some((part) => part.trim()) ? text : "";
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
