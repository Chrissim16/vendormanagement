import JSZip from "jszip";
import { AppError } from "../../../platform/errors";
import { unpacksWithin } from "../../../platform/zip";

/**
 * Small helpers for the inside of a Word file (Office Open XML): opening one safely,
 * writing text into XML, and finding styles by their built-in names. Word files are
 * handled as XML text with JSZip; nothing here needs Word or a browser.
 */

/** More than any template or returned review copy unpacks into. */
const MAX_UNPACKED = 80 * 1024 * 1024;
/** More XML in one part than any real document has. */
export const MAX_PART_CHARS = 20 * 1024 * 1024;

export const WORD_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
export const WORD_TEMPLATE_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml";
const MACRO_MAIN = /macroEnabled/i;

/** Opens a Word file, refusing one that is not a Word file, unpacks into far more than it seems, or carries macros. */
export async function openWord(data: Buffer, refuse: (why: "unreadable" | "macros") => AppError): Promise<JSZip> {
  if (data.length < 4 || data.readUInt32LE(0) !== 0x04034b50 || !unpacksWithin(data, MAX_UNPACKED)) throw refuse("unreadable");
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw refuse("unreadable");
  }
  const types = await zip.file("[Content_Types].xml")?.async("string");
  if (!types || !zip.file("word/document.xml")) throw refuse("unreadable");
  if (MACRO_MAIN.test(types) || zip.file("word/vbaProject.bin")) throw refuse("macros");
  return zip;
}

/** One part of a Word file as text. A part larger than any real document is refused, never cut: a cut part would be written back damaged. */
export async function part(zip: JSZip, name: string): Promise<string | null> {
  const f = zip.file(name);
  if (!f) return null;
  const s = await f.async("string");
  if (s.length > MAX_PART_CHARS)
    throw new AppError(400, "file_too_large", "That Word file holds far more than any real document. Upload the template or review copy as Word saved it.");
  return s;
}

/**
 * Every element with the given name, as its attributes and what is inside it, found by
 * plain searching from left to right: no file, however it is built, takes more than a
 * moment. An element that is never closed ends the search. Elements of this name inside
 * one another are not expected where this is used.
 */
export function* elements(xml: string, name: string): Generator<{ attrs: string; inner: string; start: number; end: number }> {
  const open = `<${name}`;
  const close = `</${name}>`;
  let at = 0;
  for (;;) {
    const start = xml.indexOf(open, at);
    if (start < 0) return;
    const after = xml[start + open.length];
    const tagEnd = xml.indexOf(">", start);
    if (tagEnd < 0) return;
    if (after !== " " && after !== ">" && after !== "/" && after !== "\n" && after !== "\t" && after !== "\r") {
      at = start + open.length;
      continue;
    }
    const attrs = xml.slice(start + open.length, xml[tagEnd - 1] === "/" ? tagEnd - 1 : tagEnd);
    if (xml[tagEnd - 1] === "/") {
      yield { attrs, inner: "", start, end: tagEnd + 1 };
      at = tagEnd + 1;
      continue;
    }
    const end = xml.indexOf(close, tagEnd);
    if (end < 0) return;
    yield { attrs, inner: xml.slice(tagEnd + 1, end), start, end: end + close.length };
    at = end + close.length;
  }
}

/** The tags of an XML text one by one, and the text between them. Linear: a tag's attributes stop at the next "<". */
export const TOKENS = /<(\/?)([\w:]+)([^<>]*?)(\/?)>|([^<]+)/g;

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const decodeXml = (s: string) =>
  s.replace(/&(#x?[0-9a-f]{1,8}|[a-z]{2,6});/gi, (m, e: string) => {
    if (e[0] !== "#") return entities[e.toLowerCase()] ?? m;
    const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " ";
  });
/** Text made safe for XML; characters XML cannot hold at all are left out. */
export const escapeXml = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex -- control characters cannot be written into XML.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The value of an attribute in a tag's text, `w:val` for example. */
export const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name.replace(":", "\\:")}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]!) : null;
};

export interface StyleInfo {
  id: string;
  name: string;
  type: string;
  /** The list the style numbers its paragraphs with, if it has one. */
  numId: string | null;
  /** The style makes a paragraph a top-level heading (outline level 1 in Word's terms). */
  outline: boolean;
}
/**
 * The styles of a document by their built-in name ("heading 1", "list bullet"), lower
 * case. Word keeps the English built-in name in `w:name` whatever the language; the id
 * is translated (a Dutch Word calls Heading 1 "Kop1"), so styles are found by name.
 */
export function readStyles(stylesXml: string | null): Map<string, StyleInfo> {
  const out = new Map<string, StyleInfo>();
  if (!stylesXml) return out;
  for (const m of elements(stylesXml, "w:style")) {
    const id = attr(m.attrs, "w:styleId");
    const type = attr(m.attrs, "w:type") ?? "paragraph";
    const nameTag = elements(m.inner, "w:name").next().value;
    const name = nameTag ? attr(nameTag.attrs, "w:val") : null;
    if (!id || !name) continue;
    const numTag = elements(m.inner, "w:numId").next().value;
    const key = `${type}:${name.toLowerCase()}`;
    if (!out.has(key)) out.set(key, { id, name, type, numId: numTag ? attr(numTag.attrs, "w:val") : null, outline: /<w:outlineLvl w:val="0"\s*\/>/.test(m.inner) });
  }
  return out;
}
export const styleNamed = (styles: Map<string, StyleInfo>, name: string, type = "paragraph") => styles.get(`${type}:${name}`) ?? null;

/** The font the document's ordinary text is set in, as far as the styles say. */
export function bodyFont(stylesXml: string | null, themeXml: string | null): string | null {
  const defaults = stylesXml ? elements(stylesXml, "w:docDefaults").next().value?.inner : null;
  const normal = stylesXml ? [...elements(stylesXml, "w:style")].find((m) => /<w:name w:val="Normal"\s*\/>/i.test(m.inner))?.inner : null;
  for (const block of [normal, defaults]) {
    const fonts = block ? elements(block, "w:rFonts").next().value?.attrs : null;
    const named = fonts ? attr(fonts, "w:ascii") : null;
    if (named) return named;
    const themed = fonts ? attr(fonts, "w:asciiTheme") : null;
    if (themed && themeXml) {
      const group = elements(themeXml, themed.startsWith("major") ? "a:majorFont" : "a:minorFont").next().value?.inner;
      const latin = group ? elements(group, "a:latin").next().value?.attrs : null;
      const face = latin ? attr(latin, "typeface") : null;
      if (face) return face;
    }
  }
  return null;
}

/** The parts of the main document's relationships, as id, type and target. */
export function readRelationships(relsXml: string | null): { id: string; type: string; target: string }[] {
  if (!relsXml) return [];
  return [...elements(relsXml, "Relationship")].map((m) => ({
    id: attr(m.attrs, "Id") ?? "",
    type: (attr(m.attrs, "Type") ?? "").split("/").pop() ?? "",
    target: attr(m.attrs, "Target") ?? "",
  }));
}

// ---------- Custom document properties: how a review copy says which RFP and version it is (Q-13)

const CUSTOM_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties";
const CUSTOM_TYPE = "application/vnd.openxmlformats-officedocument.custom-properties+xml";
const FMTID = "{D5CDD505-2E9C-101B-9397-08002B2CF9AE}";

export async function readCustomProperties(zip: JSZip): Promise<Record<string, string>> {
  const xml = await part(zip, "docProps/custom.xml");
  const out: Record<string, string> = {};
  if (!xml) return out;
  for (const m of elements(xml, "property")) {
    const name = attr(m.attrs, "name");
    const value = /^\s*<vt:\w+>([^<]*)<\/vt:\w+>/.exec(m.inner)?.[1];
    if (name && value != null) out[name] = decodeXml(value);
  }
  return out;
}

/** Sets the given custom properties as text. The file's own other properties are kept exactly as they were. */
export async function writeCustomProperties(zip: JSZip, props: Record<string, string>): Promise<void> {
  const xml = await part(zip, "docProps/custom.xml");
  const kept: string[] = [];
  let pid = 1;
  for (const m of xml ? elements(xml, "property") : []) {
    if (Object.hasOwn(props, attr(m.attrs, "name") ?? "")) continue;
    kept.push(xml!.slice(m.start, m.end));
    pid = Math.max(pid, Number(attr(m.attrs, "pid")) || 1);
  }
  const ours = Object.entries(props).map(
    ([name, value]) => `<property fmtid="${FMTID}" pid="${++pid}" name="${escapeXml(name)}"><vt:lpwstr>${escapeXml(value)}</vt:lpwstr></property>`,
  );
  zip.file(
    "docProps/custom.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">${[...kept, ...ours].join("")}</Properties>`,
  );
  let types = (await part(zip, "[Content_Types].xml"))!;
  if (!types.includes('PartName="/docProps/custom.xml"')) types = types.replace("</Types>", `<Override PartName="/docProps/custom.xml" ContentType="${CUSTOM_TYPE}"/></Types>`);
  zip.file("[Content_Types].xml", types);
  let rels =
    (await part(zip, "_rels/.rels")) ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  if (!rels.includes(CUSTOM_REL)) {
    const taken = new Set(readRelationships(rels).map((r) => r.id));
    let n = 1;
    while (taken.has(`rIdVm${n}`)) n++;
    rels = rels.replace("</Relationships>", `<Relationship Id="rIdVm${n}" Type="${CUSTOM_REL}" Target="docProps/custom.xml"/></Relationships>`);
  }
  zip.file("_rels/.rels", rels);
}
