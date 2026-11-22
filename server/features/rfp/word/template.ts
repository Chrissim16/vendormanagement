import type JSZip from "jszip";
import type { Mark, Place, TemplateFound } from "../../../../shared/wordTemplate";
import { AppError } from "../../../platform/errors";
import { BodyWriter, type BodyStyles } from "./body";
import { attr, bodyFont, decodeXml, escapeXml, openWord, part, readRelationships, readStyles, styleNamed, WORD_MAIN, WORD_TEMPLATE_MAIN, writeCustomProperties } from "./ooxml";

/**
 * Q-14: every RFP Word file is made from a Word template: the company's, once an admin
 * has uploaded it, or else the app's own plain one. The template's body is its cover page
 * and stays as it is, with [Title], [Date] and [Version] filled in; its header, footer,
 * logo, fonts and spacing come along untouched. The RFP's text follows the cover page in
 * the template's own heading, list and table styles.
 */

export { MARKS, markLabels, type Mark, type Place, type TemplateFound } from "../../../../shared/wordTemplate";

export const templateRefused = (why: "unreadable" | "macros") =>
  new AppError(
    400,
    why === "macros" ? "template_has_macros" : "not_a_word_file",
    why === "macros"
      ? "That template contains macros, which the app does not take. Save it in Word as a Word Template (.dotx) or a Word Document (.docx) and upload that."
      : "That file could not be read as a Word document. Upload the template as .dotx or .docx, as saved by Word.",
  );

const MARK_RE = /\[(title|date|version)\]/gi;
const SEGMENTS = /<w:t(?=[\s>/])([^>]*?)(?:\/>|>([\s\S]*?)<\/w:t>)|<w:p(?=[\s>/])[^>]*>|<\/w:p>/g;

/**
 * Fills the marks in one part of a document. Word often splits typed text over several
 * pieces ("[", "Title", "]"), so the pieces of each paragraph are read as one text, and
 * the value goes where the mark began. Returns the part and the marks it held.
 */
export function fillMarks(xml: string, values: Partial<Record<Mark, string>> | null): { xml: string; found: Set<Mark> } {
  const found = new Set<Mark>();
  const groups: { start: number; end: number; text: string }[][] = [[]];
  for (const m of xml.matchAll(SEGMENTS)) {
    if (m[0].startsWith("<w:p") || m[0] === "</w:p>") groups.push([]);
    else groups[groups.length - 1]!.push({ start: m.index, end: m.index + m[0].length, text: decodeXml(m[2] ?? "") });
  }
  const edits: { start: number; end: number; xml: string }[] = [];
  for (const g of groups) {
    const full = g.map((s) => s.text).join("");
    const hits = [...full.matchAll(MARK_RE)].map((m) => ({ from: m.index, to: m.index + m[0].length, mark: m[1]!.toLowerCase() as Mark }));
    if (!hits.length) continue;
    hits.forEach((h) => found.add(h.mark));
    if (!values) continue;
    let at = 0;
    for (const s of g) {
      let text = "";
      for (let i = at; i < at + s.text.length; i++) {
        const hit = hits.find((h) => i >= h.from && i < h.to);
        if (!hit) text += full[i];
        else if (i === hit.from) text += values[hit.mark] ?? "";
      }
      at += s.text.length;
      if (text !== s.text) edits.push({ start: s.start, end: s.end, xml: `<w:t xml:space="preserve">${escapeXml(text)}</w:t>` });
    }
  }
  let out = xml;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.xml + out.slice(e.end);
  return { xml: out, found };
}

async function headerFooterParts(zip: JSZip): Promise<{ name: string; kind: "header" | "footer" }[]> {
  const rels = readRelationships(await part(zip, "word/_rels/document.xml.rels"));
  return rels
    .filter((r) => r.type === "header" || r.type === "footer")
    .map((r) => ({ name: `word/${r.target.replace(/^\/?word\//, "").replace(/^\//, "")}`, kind: r.type as "header" | "footer" }))
    .filter((p) => zip.file(p.name));
}

const hasContent = (xml: string) => /<w:t(?=[\s>])[^>]*>[^<]*\S/.test(xml) || /<w:drawing\b|<w:pict\b|<w:object\b/.test(xml);
const bodyOf = (doc: string) => /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? "";

function bodyStyles(stylesXml: string | null): { styles: BodyStyles; names: TemplateFound["styles"]; numbered: { bullet: string | null; number: string | null } } {
  const all = readStyles(stylesXml);
  const h = [1, 2, 3].map((n) => styleNamed(all, `heading ${n}`));
  const bullet = styleNamed(all, "list bullet");
  const number = styleNamed(all, "list number");
  const listParagraph = styleNamed(all, "list paragraph");
  const table = styleNamed(all, "table grid", "table");
  return {
    styles: {
      heading: { 1: h[0]?.id, 2: h[1]?.id, 3: h[2]?.id },
      listBullet: bullet?.id ?? null,
      listNumber: number?.id ?? null,
      listParagraph: listParagraph?.id ?? null,
      table: table?.id ?? null,
    },
    names: {
      heading1: h[0]?.name ?? null,
      heading2: h[1]?.name ?? null,
      heading3: h[2]?.name ?? null,
      listBullet: bullet?.name ?? null,
      listNumber: number?.name ?? null,
      table: table?.name ?? null,
    },
    numbered: { bullet: bullet?.numId ?? null, number: number?.numId ?? null },
  };
}

/** Q-14: what the app finds in an uploaded template. A missing mark is reported, not refused. */
export async function analyseTemplate(data: Buffer): Promise<TemplateFound> {
  const zip = await openWord(data, templateRefused);
  const types = (await part(zip, "[Content_Types].xml"))!;
  const doc = (await part(zip, "word/document.xml"))!;
  const marks: Record<Mark, Place[]> = { title: [], date: [], version: [] };
  const note = (found: Set<Mark>, place: Place) => found.forEach((m) => !marks[m].includes(place) && marks[m].push(place));
  note(fillMarks(doc, null).found, "cover page");
  const hf = await headerFooterParts(zip);
  for (const p of hf) note(fillMarks((await part(zip, p.name)) ?? "", null).found, p.kind);
  const stylesXml = await part(zip, "word/styles.xml");
  return {
    format: types.includes(WORD_TEMPLATE_MAIN) ? "dotx" : "docx",
    coverPage: hasContent(bodyOf(doc)),
    marks,
    header: hf.some((p) => p.kind === "header"),
    footer: hf.some((p) => p.kind === "footer"),
    pictures: Object.keys(zip.files).filter((n) => n.startsWith("word/media/")).length,
    font: bodyFont(stylesXml, await part(zip, "word/theme/theme1.xml")),
    styles: bodyStyles(stylesXml).names,
  };
}

const NUMBERING_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering";
const NUMBERING_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const ownList = (id: number, ordered: boolean) =>
  `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${ordered ? "decimal" : "bullet"}"/><w:lvlText w:val="${ordered ? "%1." : "•"}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>`;

/**
 * Gives every list in the body its own numbering, so each numbered list starts at 1. A
 * list follows the template's list style where it has one, and the app's own otherwise.
 */
async function addLists(zip: JSZip, lists: boolean[], styleNum: { bullet: string | null; number: string | null }): Promise<string[]> {
  if (!lists.length) return [];
  let xml = await part(zip, "word/numbering.xml");
  if (!xml) {
    xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${W_NS}"></w:numbering>`;
    let types = (await part(zip, "[Content_Types].xml"))!;
    if (!types.includes('PartName="/word/numbering.xml"')) types = types.replace("</Types>", `<Override PartName="/word/numbering.xml" ContentType="${NUMBERING_TYPE}"/></Types>`);
    zip.file("[Content_Types].xml", types);
    let rels =
      (await part(zip, "word/_rels/document.xml.rels")) ??
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    if (!rels.includes(NUMBERING_REL))
      rels = rels.replace("</Relationships>", `<Relationship Id="rIdVmNumbering" Type="${NUMBERING_REL}" Target="numbering.xml"/></Relationships>`);
    zip.file("word/_rels/document.xml.rels", rels);
  }
  const abstractOf = new Map([...xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g)].map((m) => [m[1]!, m[2]!]));
  let nextAbstract = Math.max(-1, ...[...xml.matchAll(/w:abstractNumId="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  let nextNum = Math.max(0, ...[...xml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  const newAbstracts: string[] = [];
  const own: Partial<Record<"bullet" | "number", string>> = {};
  const abstractFor = (ordered: boolean) => {
    const kind = ordered ? "number" : "bullet";
    const viaStyle = styleNum[kind] ? abstractOf.get(styleNum[kind]!) : undefined;
    if (viaStyle) return viaStyle;
    if (!own[kind]) {
      own[kind] = String(nextAbstract++);
      newAbstracts.push(ownList(Number(own[kind]), ordered));
    }
    return own[kind]!;
  };
  const ids: string[] = [];
  const nums = lists.map((ordered) => {
    const id = String(nextNum++);
    ids.push(id);
    return `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractFor(ordered)}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
  });
  // Every abstract list comes before the first list that uses one, as Word requires.
  const lastAbstract = xml.lastIndexOf("</w:abstractNum>");
  const firstNum = xml.search(/<w:num\b/);
  const at = lastAbstract >= 0 ? lastAbstract + "</w:abstractNum>".length : firstNum >= 0 ? firstNum : xml.lastIndexOf("</w:numbering>");
  xml = xml.slice(0, at) + newAbstracts.join("") + xml.slice(at);
  const cleanup = xml.indexOf("<w:numIdMacAtCleanup");
  const end = cleanup >= 0 ? cleanup : xml.lastIndexOf("</w:numbering>");
  xml = xml.slice(0, end) + nums.join("") + xml.slice(end);
  zip.file("word/numbering.xml", xml);
  return ids;
}

/** A template opened to make one file from. */
export interface OpenTemplate {
  styles: BodyStyles;
  /** Puts the file together: the cover page with its marks filled in, then the body. */
  finish(body: BodyWriter, o: { marks: Record<Mark, string>; properties?: Record<string, string>; title: string }): Promise<Buffer>;
}

export async function openTemplate(data: Buffer): Promise<OpenTemplate> {
  const zip = await openWord(data, templateRefused);
  const stylesXml = await part(zip, "word/styles.xml");
  const { styles, numbered } = bodyStyles(stylesXml);
  return {
    styles,
    async finish(body, o) {
      let doc = (await part(zip, "word/document.xml"))!;
      doc = fillMarks(doc, o.marks).xml;
      for (const p of await headerFooterParts(zip)) zip.file(p.name, fillMarks((await part(zip, p.name))!, o.marks).xml);
      const ids = await addLists(zip, body.lists, numbered);
      const bodyXml = body.toString().replace(/\{\{num:(\d+)\}\}/g, (_, n: string) => ids[Number(n)] ?? "0");
      const close = doc.lastIndexOf("</w:body>");
      if (close < 0) throw templateRefused("unreadable");
      const finalSect = doc.lastIndexOf("<w:sectPr", close);
      const sectEnd = finalSect >= 0 ? doc.indexOf("</w:sectPr>", finalSect) : -1;
      // The body's own last section settings close the body; the RFP's text goes in front of them.
      const insertAt = finalSect >= 0 && sectEnd >= 0 && !doc.slice(sectEnd + "</w:sectPr>".length, close).trim() ? finalSect : close;
      const before = doc.slice(doc.indexOf("<w:body>") + "<w:body>".length, insertAt);
      // A cover page that ends with a section break of its own already starts the text on a new page.
      const endsWithBreak = /<w:sectPr\b[\s\S]*?<\/w:sectPr>\s*<\/w:pPr>(?:(?!<w:p[\s>])[\s\S])*<\/w:p>\s*$/.test(before);
      const lead = hasContent(before) && !endsWithBreak ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : "";
      doc = doc.slice(0, insertAt) + lead + bodyXml + doc.slice(insertAt);
      zip.file("word/document.xml", doc);
      let types = (await part(zip, "[Content_Types].xml"))!;
      types = types.split(WORD_TEMPLATE_MAIN).join(WORD_MAIN);
      zip.file("[Content_Types].xml", types);
      const core = await part(zip, "docProps/core.xml");
      if (core && /<dc:title\b/.test(core))
        zip.file("docProps/core.xml", core.replace(/<dc:title\b[^>]*>[\s\S]*?<\/dc:title>|<dc:title\s*\/>/, `<dc:title>${escapeXml(o.title)}</dc:title>`));
      if (o.properties) await writeCustomProperties(zip, o.properties);
      return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    },
  };
}

/** For tests and the settings page: the style names a template's paragraphs use, by id. */
export const styleIdName = (stylesXml: string | null) => new Map([...readStyles(stylesXml).values()].map((s) => [s.id, s.name]));
export { attr };
