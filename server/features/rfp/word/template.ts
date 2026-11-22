import type JSZip from "jszip";
import type { Mark, Place, TemplateFound } from "../../../../shared/wordTemplate";
import { AppError } from "../../../platform/errors";
import { BodyWriter, LIST_MARK, type BodyStyles } from "./body";
import {
  attr,
  bodyFont,
  decodeXml,
  elements,
  escapeXml,
  openWord,
  part,
  readRelationships,
  readStyles,
  styleNamed,
  TOKENS,
  WORD_MAIN,
  WORD_TEMPLATE_MAIN,
  writeCustomProperties,
} from "./ooxml";

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

/**
 * Fills the marks in one part of a document. Word often splits typed text over several
 * pieces ("[", "Title", "]"), so the pieces of each paragraph are read as one text, and
 * the value goes where the mark began. Returns the part and the marks it held. The part
 * is read once from left to right, so no file takes more than a moment.
 */
export function fillMarks(xml: string, values: Partial<Record<Mark, string>> | null): { xml: string; found: Set<Mark> } {
  const found = new Set<Mark>();
  const groups: { start: number; end: number; text: string }[][] = [[]];
  let open: { start: number; text: string } | null = null;
  for (const m of xml.matchAll(TOKENS)) {
    if (m[5] !== undefined) {
      if (open) open.text += m[5];
      continue;
    }
    const [, close, name, , self] = m;
    if (name === "w:p") groups.push([]);
    else if (name === "w:t") {
      if (!close && !self) open = { start: m.index, text: "" };
      else if (close && open) {
        groups[groups.length - 1]!.push({ start: open.start, end: m.index + m[0].length, text: decodeXml(open.text) });
        open = null;
      }
    }
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

const hasContent = (xml: string) => [...elements(xml, "w:t")].some((t) => /\S/.test(t.inner)) || /<w:drawing\b|<w:pict\b|<w:object\b/.test(xml);
const bodyOf = (doc: string) => {
  const from = doc.indexOf("<w:body>");
  const to = doc.lastIndexOf("</w:body>");
  return from >= 0 && to > from ? doc.slice(from + "<w:body>".length, to) : "";
};

/**
 * Where the body's own last section settings start: the last `w:sectPr` directly in the
 * body, not one inside a tracked change of section settings, and not one that ends a
 * paragraph. The RFP's text goes in front of it. Without one, in front of `</w:body>`.
 */
export function finalSectionAt(doc: string): number {
  const close = doc.lastIndexOf("</w:body>");
  if (close < 0) return -1;
  let depth = 0;
  let last: { start: number; end: number } | null = null;
  let start = -1;
  for (const m of doc.matchAll(/<(\/?)w:sectPr(?=[\s>/])[^<>]*?(\/?)>/g)) {
    if (m.index > close) break;
    if (m[1]) {
      depth--;
      if (depth === 0) last = { start, end: m.index + m[0].length };
    } else if (m[2]) {
      if (depth === 0) last = { start: m.index, end: m.index + m[0].length };
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return last && !doc.slice(last.end, close).trim() ? last.start : close;
}

/** Whether what comes before the RFP's text ends with a paragraph that carries a section break, which starts a new page by itself. */
function endsWithSectionBreak(before: string): boolean {
  const end = before.lastIndexOf("</w:sectPr>");
  if (end < 0) return false;
  const rest = before.slice(end + "</w:sectPr>".length);
  return /^\s*<\/w:pPr>/.test(rest) && !/<w:p[\s>]/.test(rest) && /<\/w:p>\s*$/.test(rest);
}

/** Word's own comments and tracked changes in a template would go out in every file, also to vendors. */
export async function leftovers(zip: JSZip): Promise<string[]> {
  const out: string[] = [];
  const parts = ["word/document.xml", ...(await headerFooterParts(zip)).map((p) => p.name)];
  let comments = false;
  let changes = false;
  for (const name of parts) {
    const xml = (await part(zip, name)) ?? "";
    if (/<w:commentReference\b|<w:commentRangeStart\b/.test(xml)) comments = true;
    if (/<w:(ins|del|moveFrom|moveTo)\s[^<>]*w:author=/.test(xml)) changes = true;
  }
  if (comments || zip.file("word/comments.xml")) out.push("comments");
  if (changes) out.push("tracked changes");
  return out;
}

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
  // The template may keep its numbering under another name; its relationship says where.
  const rel = readRelationships(await part(zip, "word/_rels/document.xml.rels")).find((r) => r.type === "numbering");
  const name = rel ? `word/${rel.target.replace(/^\/?word\//, "").replace(/^\//, "")}` : "word/numbering.xml";
  let xml = await part(zip, name);
  if (!xml) {
    xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${W_NS}"></w:numbering>`;
    let types = (await part(zip, "[Content_Types].xml"))!;
    if (!types.includes(`PartName="/${name}"`)) types = types.replace("</Types>", `<Override PartName="/${name}" ContentType="${NUMBERING_TYPE}"/></Types>`);
    zip.file("[Content_Types].xml", types);
    let rels =
      (await part(zip, "word/_rels/document.xml.rels")) ??
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    if (!rel) rels = rels.replace("</Relationships>", `<Relationship Id="rIdVmNumbering" Type="${NUMBERING_REL}" Target="${name.slice("word/".length)}"/></Relationships>`);
    zip.file("word/_rels/document.xml.rels", rels);
  }
  const nums = [...elements(xml, "w:num")];
  const abstractOf = new Map(nums.map((m) => [attr(m.attrs, "w:numId") ?? "", attr(elements(m.inner, "w:abstractNumId").next().value?.attrs ?? "", "w:val") ?? ""] as const));
  const abstracts = [...elements(xml, "w:abstractNum")];
  let nextAbstract = Math.max(-1, ...abstracts.map((m) => Number(attr(m.attrs, "w:abstractNumId")) || 0)) + 1;
  let nextNum = Math.max(0, ...nums.map((m) => Number(attr(m.attrs, "w:numId")) || 0)) + 1;
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
  const added = lists.map((ordered) => {
    const id = String(nextNum++);
    ids.push(id);
    return `<w:num w:numId="${id}"><w:abstractNumId w:val="${abstractFor(ordered)}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
  });
  // Every abstract list comes before the first list that uses one, as Word requires.
  const at = abstracts.length ? abstracts[abstracts.length - 1]!.end : nums.length ? nums[0]!.start : xml.lastIndexOf("</w:numbering>");
  xml = xml.slice(0, at) + newAbstracts.join("") + xml.slice(at);
  const cleanup = xml.indexOf("<w:numIdMacAtCleanup");
  const end = cleanup >= 0 ? cleanup : xml.lastIndexOf("</w:numbering>");
  xml = xml.slice(0, end) + added.join("") + xml.slice(end);
  zip.file(name, xml);
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
      const bodyXml = body.toString().replace(LIST_MARK, (_, n: string) => ids[Number(n)] ?? "0");
      // The body's own last section settings close the body; the RFP's text goes in front of them.
      const insertAt = finalSectionAt(doc);
      if (insertAt < 0 || doc.indexOf("<w:body>") < 0) throw templateRefused("unreadable");
      const before = doc.slice(doc.indexOf("<w:body>") + "<w:body>".length, insertAt);
      // A cover page that ends with a section break of its own already starts the text on a new page.
      const lead = hasContent(before) && !endsWithSectionBreak(before) ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : "";
      doc = doc.slice(0, insertAt) + lead + bodyXml + doc.slice(insertAt);
      zip.file("word/document.xml", doc);
      let types = (await part(zip, "[Content_Types].xml"))!;
      types = types.split(WORD_TEMPLATE_MAIN).join(WORD_MAIN);
      zip.file("[Content_Types].xml", types);
      const core = await part(zip, "docProps/core.xml");
      const title = core ? elements(core, "dc:title").next().value : undefined;
      if (core && title) zip.file("docProps/core.xml", core.slice(0, title.start) + `<dc:title>${escapeXml(o.title)}</dc:title>` + core.slice(title.end));
      if (o.properties) await writeCustomProperties(zip, o.properties);
      return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    },
  };
}

/** For tests and the settings page: the style names a template's paragraphs use, by id. */
export const styleIdName = (stylesXml: string | null) => new Map([...readStyles(stylesXml).values()].map((s) => [s.id, s.name]));
export { attr };

/**
 * Q-14: what an upload must pass besides being readable. A template with comments or
 * tracked changes would hand them to every reader, vendors included; and a trial file is
 * made from it, so that a template the app cannot make a sound file from is refused at once.
 */
export async function checkTemplate(data: Buffer): Promise<void> {
  const zip = await openWord(data, templateRefused);
  const left = await leftovers(zip);
  if (left.length)
    throw new AppError(
      400,
      "template_has_remarks",
      `That template still has ${left.join(" and ")} in it, which would end up in every RFP Word file, also the copies for vendors. Open it in Word, accept or reject every change and delete every comment, save it, and upload it again.`,
    );
  const t = await openTemplate(data);
  const w = new BodyWriter(t.styles);
  w.heading(1, [{ text: "Trial" }]);
  w.list(true, [[{ text: "one" }]]);
  w.table([[[{ text: "a" }]], [[{ text: "b" }]]]);
  const made = await t.finish(w, { title: "Trial", marks: { title: "Trial", date: "1 Jan 2027", version: "Version 1" } });
  const JSZipModule = (await import("jszip")).default;
  const doc = await (await JSZipModule.loadAsync(made)).file("word/document.xml")?.async("string");
  const at = doc?.indexOf("Trial</w:t>") ?? -1;
  const end = doc?.lastIndexOf("</w:body>") ?? -1;
  const sect = doc ? finalSectionAt(doc) : -1;
  if (!doc || at < 0 || end < at || (sect >= 0 && sect < at))
    throw new AppError(
      400,
      "template_unusable",
      "The app could not make a sound Word file from that template. Save it again in Word as a Word Template (.dotx) and upload that; if it still fails, try it without its last section break.",
    );
}
