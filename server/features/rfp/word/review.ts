import type JSZip from "jszip";
import { attr, decodeXml, part, readStyles } from "./ooxml";

/**
 * Q-13: reads the comments and tracked changes from a review copy a reviewer sent back,
 * with the reviewer's name as Word gives it and the heading each one stands under.
 * The file is read once from left to right, so no file takes more than a moment.
 *
 * What the review copy said is the text with deleted words in and inserted words out:
 * that is the text a suggested edit and a comment are placed against.
 */

export interface RawRemark {
  kind: "comment" | "suggested_edit";
  author: string;
  /** The Heading 1 it stands under, or "Cover page" before the first one. */
  foundUnder: string;
  /** Which of the headings with that text (0 for the first), when a heading occurs more than once. */
  occurrence: number;
  position: number;
  anchorText: string | null;
  text: string | null;
  removedText: string | null;
  addedText: string | null;
  beforeText: string | null;
  afterText: string | null;
}

const MAX_REMARKS = 500;
const MAX_TEXT = 4000;
const CONTEXT = 40;
export const COVER = "Cover page";

const clip = (s: string, max = MAX_TEXT) => (s.length > max ? `${s.slice(0, max)}…` : s);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

type Text = { kind: "same" | "del" | "ins"; text: string; author: string };
type Mark = { kind: "start" | "end" | "ref"; id: string };
type Seg = Text | Mark;
const isMark = (s: Seg): s is Mark => s.kind === "start" || s.kind === "end" || s.kind === "ref";
interface Para {
  style: string | null;
  segs: Seg[];
}

/** A few words before a place, cut at the start of a word. */
function wordsBefore(text: string, at: number): string {
  const from = Math.max(0, at - CONTEXT);
  let s = text.slice(from, at);
  if (from > 0) s = s.slice(s.search(/\s/) + 1 || s.length);
  return s;
}
/** A few words after a place, cut at the end of a word. */
function wordsAfter(text: string, at: number): string {
  const to = Math.min(text.length, at + CONTEXT);
  let s = text.slice(at, to);
  if (to < text.length) {
    const cut = s.search(/\s\S*$/);
    s = cut >= 0 ? s.slice(0, cut) : "";
  }
  return s;
}

/** The comments of a file by id: who wrote them, what they say, and which comment a reply answers. */
async function readComments(zip: JSZip): Promise<Map<string, { author: string; text: string; parent: string | null }>> {
  const out = new Map<string, { author: string; text: string; parent: string | null }>();
  const xml = await part(zip, "word/comments.xml");
  if (!xml) return out;
  const lastPara = new Map<string, string>();
  for (const m of xml.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const id = attr(m[1]!, "w:id");
    if (id == null) continue;
    const paras = [...m[2]!.matchAll(/<w:p\b([^>]*)>([\s\S]*?)<\/w:p>/g)];
    const text = paras.map((p) => [...p[2]!.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((t) => decodeXml(t[1]!)).join("")).join("\n");
    const paraId = paras.length ? attr(paras[paras.length - 1]![1]!, "w14:paraId") : null;
    if (paraId) lastPara.set(paraId, id);
    out.set(id, { author: attr(m[1]!, "w:author") || "Unknown reviewer", text: squash(text.replace(/\n/g, " \n ")).replace(/ \n /g, "\n"), parent: null });
  }
  // A reply names the paragraph of the comment it answers (commentsExtended).
  const ext = await part(zip, "word/commentsExtended.xml");
  for (const m of ext?.matchAll(/<w15:commentEx\b([^>]*)\/?>/g) ?? []) {
    const id = lastPara.get(attr(m[1]!, "w15:paraId") ?? "");
    const parent = lastPara.get(attr(m[1]!, "w15:paraIdParent") ?? "");
    if (id && parent && out.has(id)) out.get(id)!.parent = parent;
  }
  return out;
}

/** Reads every comment and tracked change in the main text of a returned review copy. */
export async function readRemarks(zip: JSZip): Promise<RawRemark[]> {
  const xml = (await part(zip, "word/document.xml")) ?? "";
  const styles = readStyles(await part(zip, "word/styles.xml"));
  const heading1 = new Set([...styles.values()].filter((s) => s.type === "paragraph" && s.name.toLowerCase() === "heading 1").map((s) => s.id));
  const comments = await readComments(zip);

  const paras: Para[] = [];
  const stack: Para[] = [];
  const changes: { kind: "del" | "ins"; author: string }[] = [];
  let pending: Seg[] = [];
  let textKind: "t" | "del" | null = null;
  let inPPrChange = 0;
  const cur = () => stack[stack.length - 1];
  const push = (s: Seg) => (cur() ? cur()!.segs.push(s) : pending.push(s));
  const addText = (raw: string, del: boolean) => {
    const change = changes[changes.length - 1];
    const kind = del ? "del" : change?.kind === "ins" ? "ins" : "same";
    push({ kind, text: decodeXml(raw), author: change?.author ?? "" });
  };

  const body = xml.indexOf("<w:body");
  const re = /<(\/?)([\w:]+)([^>]*?)(\/?)>|([^<]+)/g;
  re.lastIndex = Math.max(0, body);
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[5] !== undefined) {
      if (textKind) addText(m[5], textKind === "del");
      continue;
    }
    const [, close, name, attrs, selfClose] = m;
    if (name === "w:body" && close) break;
    if (inPPrChange && name !== "w:pPrChange") continue;
    switch (name) {
      case "w:p":
        if (close) {
          const p = stack.pop();
          if (p) paras.push(p);
        } else if (!selfClose) {
          stack.push({ style: null, segs: pending });
          pending = [];
        }
        break;
      case "w:pPrChange":
        if (!selfClose) inPPrChange += close ? -1 : 1;
        break;
      case "w:pStyle":
        if (cur()) cur()!.style = attr(attrs!, "w:val");
        break;
      case "w:ins":
      case "w:moveTo":
      case "w:del":
      case "w:moveFrom":
        // A self-closing one marks a changed paragraph mark, not text.
        if (selfClose) break;
        if (close) changes.pop();
        else changes.push({ kind: name === "w:ins" || name === "w:moveTo" ? "ins" : "del", author: attr(attrs!, "w:author") || "Unknown reviewer" });
        break;
      case "w:t":
        textKind = close || selfClose ? null : "t";
        break;
      case "w:delText":
        textKind = close || selfClose ? null : "del";
        break;
      case "w:tab":
      case "w:br":
      case "w:cr":
        if (!close) {
          const change = changes[changes.length - 1];
          push({ kind: change?.kind ?? "same", text: " ", author: change?.author ?? "" });
        }
        break;
      case "w:commentRangeStart":
        push({ kind: "start", id: attr(attrs!, "w:id") ?? "" });
        break;
      case "w:commentRangeEnd":
        // Between paragraphs, an end belongs to the paragraph just finished.
        if (cur()) push({ kind: "end", id: attr(attrs!, "w:id") ?? "" });
        else paras[paras.length - 1]?.segs.push({ kind: "end", id: attr(attrs!, "w:id") ?? "" });
        break;
      case "w:commentReference":
        push({ kind: "ref", id: attr(attrs!, "w:id") ?? "" });
        break;
    }
  }

  // What the review copy said, paragraph after paragraph, and where each remark stands in it.
  let whole = "";
  let heading = COVER;
  const seen = new Map<string, number>();
  let occurrence = 0;
  const starts = new Map<string, { at: number; under: string; occurrence: number; position: number }>();
  const ends = new Map<string, number>();
  const out: RawRemark[] = [];
  let position = 0;
  for (const p of paras) {
    let original = "";
    for (const s of p.segs) if (!isMark(s) && s.kind !== "ins") original += s.text;
    if (p.style && heading1.has(p.style) && squash(original)) {
      heading = squash(original);
      occurrence = seen.get(heading) ?? 0;
      seen.set(heading, occurrence + 1);
    }
    const base = whole.length;
    let at = 0;
    let group: { start: number; removed: string; added: string; author: string } | null = null;
    const flush = () => {
      if (!group) return;
      const g = group;
      group = null;
      if (!squash(g.removed) && !squash(g.added)) return;
      out.push({
        kind: "suggested_edit",
        author: g.author,
        foundUnder: heading,
        occurrence,
        position: position++,
        anchorText: null,
        text: null,
        removedText: clip(g.removed),
        addedText: clip(g.added),
        beforeText: wordsBefore(original, g.start),
        afterText: wordsAfter(original, g.start + g.removed.length),
      });
    };
    for (const s of p.segs) {
      if (isMark(s)) {
        if (s.kind === "end") ends.set(s.id, base + at);
        else if (!starts.has(s.id)) starts.set(s.id, { at: base + at, under: heading, occurrence, position: position++ });
        continue;
      }
      if (s.kind === "same") {
        flush();
        at += s.text.length;
        continue;
      }
      if (group && group.author !== s.author) flush();
      group ??= { start: at, removed: "", added: "", author: s.author };
      if (s.kind === "del") {
        group.removed += s.text;
        at += s.text.length;
      } else group.added += s.text;
    }
    flush();
    whole += `${original}\n`;
  }

  for (const [id, c] of comments) {
    // A reply stands where the comment it answers stands.
    let root = id;
    for (let hops = 0; comments.get(root)?.parent && hops < 20; hops++) root = comments.get(root)!.parent!;
    const start = starts.get(root) ?? starts.get(id);
    const end = ends.get(root) ?? ends.get(id);
    const anchor = start && end != null && end > start.at ? squash(whole.slice(start.at, end)) : "";
    out.push({
      kind: "comment",
      author: c.author,
      foundUnder: start?.under ?? COVER,
      occurrence: start?.occurrence ?? 0,
      position: start?.position ?? position++,
      anchorText: anchor ? clip(anchor, 600) : null,
      text: clip(c.text || ""),
      removedText: null,
      addedText: null,
      beforeText: null,
      afterText: null,
    });
  }
  return out.sort((a, b) => a.position - b.position).slice(0, MAX_REMARKS);
}
