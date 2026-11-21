import { agreementName } from "../../../shared/agreements";
import { MAX_PASSAGES, type AskPassage } from "../../../shared/ask";
import type { Queryable } from "../../platform/ports/types";
import { PART_BREAK, partName } from "../../platform/text";
import { documentsWithText } from "../agreements/service";

/**
 * Finding the passages of uploaded documents that a question is about (C-1). The text of
 * each document was read when it was attached; here it is cut into passages and the ones
 * sharing the most words with the question are returned, word for word.
 */

const PASSAGE_CHARS = 420;

/** Words that say nothing about what is being looked for. */
const common = new Set(
  "a an and are as at be been but by can contract contracts did do document documents does for from has have how in is it its of on or our say says should that the their there these this to uploaded was we were what when where which who why will with would about any all us under between into than then they them if not no may shall must each such per".split(
    " ",
  ),
);
/** A word as it is compared: lower case, plural and ending dropped, so "terminate", "terminated" and "termination" meet. */
const stem = (w: string) => {
  const s = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return s.length > 5 ? s.slice(0, 5) : s.replace(/s$/, "");
};
const wordsOf = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).filter((w) => w.length > 1 && !common.has(w.toLowerCase()));
const termsOf = (text: string) =>
  [...new Set((text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).filter((w) => w.length > 1 && !common.has(w.toLowerCase())).map(stem))].filter((t) => t.length > 1);

/** A line that reads as a heading: short, and not a finished sentence or a row of a table. */
const isHeading = (line: string) => line.length <= 60 && !/[.!?;,:]$/.test(line) && !line.includes(" | ");

/**
 * A part of a document cut into passages of a few sentences, never in the middle of a
 * word. A heading stays with the text under it, so a clause keeps its name.
 */
export function passagesOf(part: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  const size = () => current.reduce((n, l) => n + l.length + 1, 0);
  const push = () => {
    // A heading at the very end belongs to what follows.
    const carried = current.length > 1 && isHeading(current.at(-1)!) ? [current.pop()!] : [];
    if (current.join("").trim()) out.push(current.join("\n").trim());
    current = carried;
  };
  for (const paragraph of part
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    for (const piece of paragraph.length > PASSAGE_CHARS ? (paragraph.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraph]) : [paragraph]) {
      // A new heading after a clause's worth of text starts a new passage, so one clause is one passage.
      if (current.length && (size() + piece.length > PASSAGE_CHARS || (isHeading(piece) && size() >= 100 && !isHeading(current.at(-1)!)))) push();
      let rest = piece.trim();
      // One sentence longer than a passage is cut between words.
      while (rest.length > PASSAGE_CHARS) {
        const at = rest.lastIndexOf(" ", PASSAGE_CHARS);
        current.push(rest.slice(0, at > 0 ? at : PASSAGE_CHARS).trim());
        push();
        rest = rest.slice(at > 0 ? at : PASSAGE_CHARS).trim();
      }
      if (rest) current.push(rest);
    }
  }
  if (current.join("").trim()) out.push(current.join("\n").trim());
  return out;
}

export interface Found {
  passages: Omit<AskPassage, "ref">[];
  /** Words that were looked for and occur in none of the documents searched. */
  missing: string[];
  /** Documents whose text could be searched, and those that have none. */
  readable: number;
  unreadable: number;
}

export async function findPassages(db: Queryable, text: string, vendorId?: string): Promise<Found> {
  const rows = await documentsWithText(db, vendorId);
  const readable = rows.filter((r) => r.text);
  const terms = termsOf(text);
  if (!terms.length) return { passages: [], missing: [], readable: readable.length, unreadable: rows.length - readable.length };

  type Row = Awaited<ReturnType<typeof documentsWithText>>[number];
  // The words that only say which document is meant (its name, its agreement, its vendor) are in its opening lines too. They pick the document, not the clause.
  const naming = new Map<Row, Set<string>>(
    readable.map((r) => [r, new Set(termsOf([r.title, r.agreementTitle, r.vendorName, r.rfpTitle, r.candidateVendor].filter(Boolean).join(" ")))]),
  );
  const all: { row: Row; part: string | null; text: string; has: Set<string>; opens: boolean }[] = [];
  for (const row of readable) {
    const parts = row.text!.split(PART_BREAK);
    parts.forEach((part, i) => {
      passagesOf(part).forEach((passage, j) =>
        all.push({ row, part: partName(row.fileName, i, parts.length, part), text: passage, has: new Set(termsOf(passage)), opens: i === 0 && j === 0 }),
      );
    });
  }
  // A word found in few passages says more than one found in many.
  const weight = new Map(terms.map((t) => [t, Math.log(1 + all.length / (1 + all.filter((p) => p.has.has(t)).length))]));
  const scored = all
    .map((p) => {
      // What is asked about this document: the words looked for, without the ones that name it. When nothing else is left, all of them.
      const about = terms.filter((t) => !naming.get(p.row)!.has(t));
      const asked = about.length ? about : terms;
      const hit = asked.filter((t) => p.has.has(t));
      // A word in the passage's first line, usually the clause's heading, counts twice: "Termination" is what that clause is about.
      // Not the document's own opening line, which is its title and says nothing about a clause.
      const heading = new Set(p.opens ? [] : termsOf(p.text.split("\n")[0]!));
      return { ...p, hits: hit.length, needed: asked.length, score: hit.reduce((n, t) => n + weight.get(t)! * (heading.has(t) ? 2 : 1), 0) };
    })
    // A passage must share at least half of the words asked about, so one common word does not make a match.
    .filter((p) => p.hits > 0 && p.hits * 2 >= p.needed)
    .sort((a, b) => b.score - a.score || b.hits - a.hits || a.row.title.localeCompare(b.row.title));
  // A word that is in no document at all is said, so a passage about the rest of the question is not taken for an answer to all of it.
  const everywhere = new Set(all.flatMap((p) => [...p.has]));
  const missing = [...new Set(wordsOf(text).filter((w) => !everywhere.has(stem(w))))].slice(0, 6);
  return {
    passages: scored.slice(0, MAX_PASSAGES).map(({ row, part, text: passage }) => ({
      documentId: row.id,
      document: row.title,
      where: row.agreementId ? `${agreementName(row.agreementKind!, row.agreementTitle!)} · ${row.vendorName}` : `Sent by ${row.candidateVendor} for the RFP ${row.rfpTitle}`,
      href: row.agreementId ? `/agreements/${row.agreementId}` : `/rfps/${row.rfpId}?tab=responses`,
      part,
      text: passage,
    })),
    missing,
    readable: readable.length,
    unreadable: rows.length - readable.length,
  };
}
