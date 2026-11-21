import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { agreements, documents, rfpCandidates, rfps, vendors } from "../../../db/schema";
import { agreementName } from "../../../shared/agreements";
import { MAX_PASSAGES, type AskPassage } from "../../../shared/ask";
import type { Queryable, StoragePort } from "../../platform/ports/types";
import { extractText, PART_BREAK, partName } from "../../platform/text";

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
  /** Documents whose text could be searched, and those that have none. */
  readable: number;
  unreadable: number;
}

export async function findPassages(db: Queryable, text: string, vendorId?: string): Promise<Found> {
  const candidateVendor = sql<string | null>`(select v.name from vendors v where v.id = ${rfpCandidates.vendorId})`;
  const rows = await db
    .select({
      id: documents.id,
      title: documents.title,
      fileName: documents.fileName,
      text: documents.extractedText,
      agreementId: agreements.id,
      agreementKind: agreements.kind,
      agreementTitle: agreements.title,
      vendorName: vendors.name,
      rfpId: rfps.id,
      rfpTitle: rfps.title,
      candidateVendor,
    })
    .from(documents)
    .leftJoin(agreements, eq(agreements.id, documents.agreementId))
    .leftJoin(vendors, eq(vendors.id, agreements.vendorId))
    .leftJoin(rfpCandidates, eq(rfpCandidates.id, documents.rfpCandidateId))
    .leftJoin(rfps, eq(rfps.id, rfpCandidates.rfpId))
    .where(and(isNotNull(documents.extractedText), vendorId ? or(eq(agreements.vendorId, vendorId), eq(rfpCandidates.vendorId, vendorId)) : undefined));
  const readable = rows.filter((r) => r.text);
  const terms = termsOf(text);
  if (!terms.length) return { passages: [], readable: readable.length, unreadable: rows.length - readable.length };

  const all: { row: (typeof rows)[number]; part: string | null; text: string; has: Set<string>; opens: boolean }[] = [];
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
      const hit = terms.filter((t) => p.has.has(t));
      // A word in the passage's first line, usually the clause's heading, counts twice: "Termination" is what that clause is about.
      // Not the document's own opening line, which is its title and says nothing about a clause.
      const heading = new Set(p.opens ? [] : termsOf(p.text.split("\n")[0]!));
      return { ...p, hits: hit.length, score: hit.reduce((n, t) => n + weight.get(t)! * (heading.has(t) ? 2 : 1), 0) };
    })
    // A passage must share at least half of the words looked for, so one common word does not make a match.
    .filter((p) => p.hits > 0 && p.hits * 2 >= terms.length)
    .sort((a, b) => b.score - a.score || b.hits - a.hits || a.row.title.localeCompare(b.row.title));
  return {
    passages: scored.slice(0, MAX_PASSAGES).map(({ row, part, text: passage }) => ({
      documentId: row.id,
      document: row.title,
      where: row.agreementId ? `${agreementName(row.agreementKind!, row.agreementTitle!)} · ${row.vendorName}` : `Sent by ${row.candidateVendor} for the RFP ${row.rfpTitle}`,
      href: row.agreementId ? `/agreements/${row.agreementId}` : `/rfps/${row.rfpId}?tab=responses`,
      part,
      text: passage,
    })),
    readable: readable.length,
    unreadable: rows.length - readable.length,
  };
}

/**
 * Reads the text of documents attached before the app could read them. Safe to run twice:
 * a document that has been read, also when it held no words, is not read again.
 */
export async function readMissingText(db: Queryable, storage: StoragePort): Promise<{ read: number; failed: number }> {
  const rows = await db
    .select({ id: documents.id, fileName: documents.fileName, storageKey: documents.storageKey })
    .from(documents)
    .where(sql`${documents.extractedText} is null`);
  let read = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const data = await storage.get(row.storageKey);
      await db
        .update(documents)
        .set({ extractedText: await extractText(row.fileName.split(".").pop()?.toLowerCase() ?? "", data) })
        .where(eq(documents.id, row.id));
      read++;
    } catch (e) {
      // The file is missing or the store cannot be reached; it is tried again next time.
      console.error(`Could not read the document ${row.id}:`, (e as Error).message);
      failed++;
    }
  }
  return { read, failed };
}
