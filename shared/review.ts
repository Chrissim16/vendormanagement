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

/** Where a text stands in a section: which piece (paragraph, item, cell) and where in it. */
function occurrences(units: Run[][], needle: string): { unit: number; at: number }[] {
  const out: { unit: number; at: number }[] = [];
  if (!needle) return out;
  units.forEach((runs, unit) => {
    const text = runsText(runs);
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) out.push({ unit, at });
  });
  return out;
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
      // Insertion exactly at the start of this run, when nothing is removed: before it, in its marks.
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
  const removed = e.removedText ?? "";
  const added = e.addedText ?? "";
  const before = e.beforeText ?? "";
  const after = e.afterText ?? "";
  if (!removed && !added) return { ok: false, why: "not_found" };
  const tries = [{ needle: before + removed + after, lead: before.length }];
  if (removed && (before || after)) tries.push({ needle: removed, lead: 0 });
  for (const t of tries) {
    const found = occurrences(
      units.map((u) => u.runs),
      t.needle,
    );
    if (found.length > 1) return { ok: false, why: "more_than_once" };
    if (found.length === 1) {
      const { unit, at } = found[0]!;
      const start = at + t.lead;
      const u = units[unit]!;
      u.set(replaceIn(u.runs, start, start + removed.length, added));
      // A paragraph or item left without words goes; a table cell may be empty.
      const cleaned = blocks
        .map((b) => (b.kind === "list" ? { ...b, items: b.items.filter((it) => it.length) } : b))
        .filter((b) => (b.kind === "list" ? b.items.length > 0 : b.kind === "table" ? true : b.runs.length > 0));
      return { ok: true, body: toMarkdown(cleaned) };
    }
  }
  return { ok: false, why: "not_found" };
}
