import { parseBlocks, runsText, tidyRuns, toMarkdown, type Block, type Run } from "./richtext";

/**
 * Review rounds and the remarks read from reviewers' Word files (Q-13). Pure, so the page
 * can say beforehand whether a suggested edit can be taken over, by the very rule the
 * server applies when it is.
 */

export type RemarkKind = "comment" | "suggested_edit";
export type RemarkStatus = "open" | "dealt_with" | "set_aside";
export type RemarkResolution = "taken_over" | "ai_rewrite" | "by_hand";
export const remarkKindLabels: Record<RemarkKind, string> = { comment: "Comment", suggested_edit: "Suggested edit" };
export const remarkStatusLabels: Record<RemarkStatus, string> = { open: "Open", dealt_with: "Dealt with", set_aside: "Set aside" };
export const resolutionLabels: Record<RemarkResolution, string> = { taken_over: "taken over", ai_rewrite: "rewritten with the AI", by_hand: "by hand" };

export interface ReviewerRemark {
  id: string;
  fileId: string;
  version: number;
  kind: RemarkKind;
  author: string;
  /** The section it is placed in, or null: not placed. */
  sectionId: string | null;
  /** A suggested edit made in the section's heading; taken over into the heading. */
  inHeading: boolean;
  /** The heading it stands under in the file, or "Cover page". */
  foundUnder: string;
  anchorText: string | null;
  text: string | null;
  removedText: string | null;
  addedText: string | null;
  beforeText: string | null;
  afterText: string | null;
  status: RemarkStatus;
  resolution: RemarkResolution | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}
export interface ReturnedFile {
  id: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
}
export interface ReviewRound {
  id: string;
  version: number;
  madeAt: string;
  madeBy: string;
  fileName: string;
  files: ReturnedFile[];
}

/** Q-13: open remarks of any round stop the RFP from being approved. */
export const openRemarks = (remarks: Pick<ReviewerRemark, "status">[]) => remarks.filter((r) => r.status === "open");

export type EditOutcome = { ok: true; body: string } | { ok: false; why: "not_found" | "more_than_once" };

const WORD = /[\p{L}\p{N}_]/u;
/** Whether a match from `at` of `length` characters starts and ends on the edge of a word, so it never takes part of a word. */
const onWordEdges = (text: string, at: number, length: number, needle: string) =>
  (!WORD.test(needle[0] ?? "") || !WORD.test(text[at - 1] ?? "")) && (!WORD.test(needle[needle.length - 1] ?? "") || !WORD.test(text[at + length] ?? ""));

/** Where a text stands in a section, as whole words: which piece (paragraph, item, cell) and where in it. */
function occurrences(texts: string[], needle: string): { unit: number; at: number }[] {
  const out: { unit: number; at: number }[] = [];
  if (!needle) return out;
  texts.forEach((text, unit) => {
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) if (onWordEdges(text, at, needle.length, needle)) out.push({ unit, at });
  });
  return out;
}

/** The removed words alone are distinctive enough to find them without the words around them: two words or more, or a word of six letters or more. */
const distinctive = (removed: string) => removed.trim().split(/\s+/).length >= 2 || (removed.match(/\p{L}/gu)?.length ?? 0) >= 6;

/** Where to make an edit in some pieces of text: by its words with those around them, or else by the removed words alone when they are distinctive. */
type Place = { why: "not_found" | "more_than_once" } | { unit: number; start: number; end: number; why?: never };
function locate(texts: string[], e: { removedText: string | null; addedText: string | null; beforeText: string | null; afterText: string | null }): Place {
  const removed = e.removedText ?? "";
  const before = e.beforeText ?? "";
  const after = e.afterText ?? "";
  if (!removed && !e.addedText) return { why: "not_found" };
  const tries = [{ needle: before + removed + after, lead: before.length }];
  if (removed && (before || after) && distinctive(removed)) tries.push({ needle: removed, lead: 0 });
  for (const t of tries) {
    const found = occurrences(texts, t.needle);
    if (found.length > 1) return { why: "more_than_once" };
    if (found.length === 1) return { unit: found[0]!.unit, start: found[0]!.at + t.lead, end: found[0]!.at + t.lead + removed.length };
  }
  return { why: "not_found" };
}

/** The runs with the characters from `start` to `end` replaced by `text`, which takes the marks of the run it lands in. */
function replaceIn(runs: Run[], start: number, end: number, text: string): Run[] {
  const out: Run[] = [];
  let pos = 0;
  let placed = !text;
  for (const r of runs) {
    const from = pos;
    const to = pos + r.text.length;
    pos = to;
    if (to <= start || from >= end) {
      // Words added where nothing is removed take the marks of the words before them, as in Word; at the very start, those of the first words.
      if (!placed && start === end && to === start && start > 0) {
        out.push({ ...r, text: r.text + text });
        placed = true;
        continue;
      }
      if (!placed && from === start && start === end) {
        out.push({ ...r, text });
        placed = true;
      }
      out.push(r);
      continue;
    }
    const keepBefore = r.text.slice(0, Math.max(0, start - from));
    const keepAfter = r.text.slice(Math.max(0, end - from));
    out.push({ ...r, text: keepBefore + (placed ? "" : text) + keepAfter });
    placed = true;
  }
  if (!placed) {
    const last = runs[runs.length - 1];
    out.push({ ...(last ?? {}), text });
  }
  return tidyRuns(out);
}

/** Every piece of text of the blocks, in reading order, with a way to put a changed piece back. */
function editableUnits(blocks: Block[]): { runs: Run[]; set: (r: Run[]) => void }[] {
  const out: { runs: Run[]; set: (r: Run[]) => void }[] = [];
  for (const b of blocks) {
    if (b.kind === "list") b.items.forEach((it, i) => out.push({ runs: it, set: (r) => (b.items[i] = r) }));
    else if (b.kind === "table") b.rows.forEach((row) => row.forEach((cell, i) => out.push({ runs: cell, set: (r) => (row[i] = r) })));
    else out.push({ runs: b.runs, set: (r) => (b.runs = r) });
  }
  return out;
}

/**
 * Q-13: takes a reviewer's suggested edit over into a section's text. The edit is found by
 * the words it removes with a few words around them, as they stood in the review copy;
 * where the words around it have changed, by the removed words alone. Either must stand
 * in the section exactly once, as it is now; otherwise nothing changes and the edit is
 * done by hand.
 */
export function applySuggestedEdit(
  body: string | null,
  e: { removedText: string | null; addedText: string | null; beforeText: string | null; afterText: string | null },
): EditOutcome {
  const blocks = parseBlocks(body);
  const units = editableUnits(blocks);
  const place = locate(
    units.map((u) => runsText(u.runs)),
    e,
  );
  if (place.why) return { ok: false, why: place.why };
  const u = units[place.unit]!;
  u.set(replaceIn(u.runs, place.start, place.end, e.addedText ?? ""));
  // A paragraph or item left without words goes; a table cell may be empty.
  const cleaned = blocks
    .map((b) => (b.kind === "list" ? { ...b, items: b.items.filter((it) => it.length) } : b))
    .filter((b) => (b.kind === "list" ? b.items.length > 0 : b.kind === "table" ? true : b.runs.length > 0));
  return { ok: true, body: toMarkdown(cleaned) };
}

/** A reviewer's edit of a section's heading, by the same rule. */
export function applyToHeading(
  heading: string,
  e: { removedText: string | null; addedText: string | null; beforeText: string | null; afterText: string | null },
): { ok: true; heading: string } | { ok: false; why: "not_found" | "more_than_once" } {
  const place = locate([heading], e);
  if (place.why) return { ok: false, why: place.why };
  const next = (heading.slice(0, place.start) + (e.addedText ?? "") + heading.slice(place.end)).replace(/\s+/g, " ").trim();
  return next ? { ok: true, heading: next } : { ok: false, why: "not_found" };
}
