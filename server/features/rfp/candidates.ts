import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { documents, rfpAnswers, rfpCandidates, rfps } from "../../../db/schema";
import { formatDay } from "../../../shared/dates";
import {
  answerSchema,
  candidateListLabels,
  candidateMoveSchema,
  candidateSchema,
  inEvaluation,
  isOpen,
  issueSchema,
  matchAnswers,
  MAX_ANSWER,
  ndaInPlace,
  reviewBlockers,
  rfpStageLabels,
  type Candidate,
  type RfpDetail,
  type SheetRow,
  unmatchedRowSchema,
} from "../../../shared/rfp";
import type { User } from "../../../shared/types";
import { AppError, notFound } from "../../platform/errors";
import { failFields } from "../../platform/http";
import type { Db, Queryable, Tx } from "../../platform/ports/types";
import { checkDocument, cleanFileName } from "../agreements/service";
import { createVendor, findVendorByName, getVendor } from "../vendors/service";
import { readAnswerSheet } from "./files";
import { change, closed, getRfp, type Changes, type RfpContext } from "./service";

/** More unmatched rows than this are not kept; the upload says how many were left out. */
const MAX_UNMATCHED = 200;
const short = (s: string | null | undefined, max = 160) => (s == null ? null : s.length > max ? `${s.slice(0, max)}…` : s);

/** The RFP a candidate belongs to. */
export async function rfpOfCandidate(db: Queryable, candidateId: string): Promise<string> {
  const row = (await db.select({ rfpId: rfpCandidates.rfpId }).from(rfpCandidates).where(eq(rfpCandidates.id, candidateId)))[0];
  if (!row) throw notFound("That candidate");
  return row.rfpId;
}
const pick = (rfp: RfpDetail, candidateId: string): Candidate => {
  const c = rfp.candidates.find((x) => x.id === candidateId);
  if (!c) throw notFound("That candidate");
  return c;
};

/** Q-4: puts a vendor on the longlist or the shortlist, with the reason. A vendor the app does not know yet is added as a prospect. */
export async function addCandidate(ctx: RfpContext, rfpId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = candidateSchema.parse(input);
  return change(ctx, rfpId, by, async (tx, rfp) => {
    if (!isOpen(rfp.stage)) throw closed();
    let vendorId = v.vendorId;
    let name: string;
    let created = false;
    if (v.newVendor) {
      if (await findVendorByName(tx, v.newVendor.name)) failFields({ "newVendor.name": "A vendor with this name already exists. Choose it from the list instead." });
      // The same transaction, so a candidate is never left without its vendor or the other way round.
      const vendor = await createVendor(tx as unknown as Db, { name: v.newVendor.name, type: v.newVendor.type, status: "prospect", ownerUserId: by.id }, by, ctx.today());
      vendorId = vendor.id;
      name = vendor.name;
      created = true;
    } else {
      const vendor = await getVendor(tx, vendorId!, ctx.today());
      if (vendor.status === "offboarded") failFields({ vendorId: "This vendor has been offboarded and cannot be a candidate." });
      name = vendor.name;
    }
    if (rfp.candidates.some((c) => c.vendorId === vendorId)) failFields({ vendorId: "This vendor is already a candidate in this RFP." });
    await tx.insert(rfpCandidates).values({ rfpId, vendorId: vendorId!, list: v.list, reason: v.reason, createdBy: by.email, updatedBy: by.email });
    return { [`candidate ${name}`]: { from: null, to: `${candidateListLabels[v.list]}${created ? ", added as a prospect vendor" : ""}: ${short(v.reason)}` } };
  });
}

/** Moves a candidate between longlist, shortlist and dropped, with the reason for where it now stands. */
export async function moveCandidate(ctx: RfpContext, candidateId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = candidateMoveSchema.parse(input);
  return change(ctx, await rfpOfCandidate(ctx.db, candidateId), by, async (tx, rfp) => {
    if (!isOpen(rfp.stage)) throw closed();
    const c = pick(rfp, candidateId);
    if (c.list === v.list && c.reason === v.reason) return;
    if (c.issuedOn && v.list === "longlist")
      throw new AppError(
        409,
        "already_issued",
        `${c.vendorName} has already been issued the RFP, so it cannot go back to the longlist. Drop it if it is no longer in the running.`,
      );
    await tx.update(rfpCandidates).set({ list: v.list, reason: v.reason, updatedAt: new Date(), updatedBy: by.email }).where(eq(rfpCandidates.id, candidateId));
    return { [`candidate ${c.vendorName}`]: { from: `${candidateListLabels[c.list]}: ${short(c.reason)}`, to: `${candidateListLabels[v.list]}: ${short(v.reason)}` } };
  });
}

/** Takes a candidate off the RFP altogether. Only for one added by mistake: once it has been issued the RFP it is dropped, not removed. */
export async function removeCandidate(ctx: RfpContext, candidateId: string, by: User): Promise<RfpDetail> {
  return change(ctx, await rfpOfCandidate(ctx.db, candidateId), by, async (tx, rfp) => {
    if (!isOpen(rfp.stage)) throw closed();
    const c = pick(rfp, candidateId);
    if (c.issuedOn || c.answered || c.documents.length || rfp.scores.some((s) => s.candidateId === c.id))
      throw new AppError(
        409,
        "candidate_in_use",
        `${c.vendorName} has been issued the RFP or has answers, documents or scores, so it stays in the trail. Move it to Dropped instead.`,
      );
    await tx.delete(rfpCandidates).where(eq(rfpCandidates.id, candidateId));
    return { [`candidate ${c.vendorName}`]: { from: candidateListLabels[c.list], to: "removed" } };
  });
}

/** The candidate, when its RFP and answer sheet may be downloaded: on the shortlist of an RFP that has been approved. */
export function exportable(rfp: RfpDetail, candidateId: string): Candidate {
  const c = pick(rfp, candidateId);
  if (rfp.stage === "drafting" || rfp.stage === "in_review")
    throw new AppError(409, "not_approved", "The RFP has not been approved yet. The documents for candidates are made once it is.");
  if (c.list !== "shortlist") throw new AppError(409, "not_shortlisted", `${c.vendorName} is not on the shortlist. The RFP goes to shortlisted candidates only.`);
  return c;
}

/**
 * Q-5: records that the RFP went out to a shortlisted candidate. Without an NDA in place
 * this is refused until the person has acknowledged the warning. The first issue locks
 * the sections, criteria and questions.
 */
export async function issueCandidate(ctx: RfpContext, candidateId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = issueSchema.parse(input);
  if (v.issuedOn > ctx.today()) failFields({ issuedOn: "The day of issue cannot be in the future." });
  return change(ctx, await rfpOfCandidate(ctx.db, candidateId), by, async (tx, rfp) => {
    if (!["approved", "issued", "evaluating"].includes(rfp.stage))
      throw new AppError(409, "not_approved", isOpen(rfp.stage) ? "The RFP has to be approved before it can be issued to a candidate." : closed().message);
    const c = exportable(rfp, candidateId);
    if (c.issuedOn) throw new AppError(409, "already_issued", `${c.vendorName} was already issued the RFP on ${formatDay(c.issuedOn)}.`);
    const blockers = reviewBlockers(rfp);
    if (blockers.length) throw new AppError(409, "not_ready", `The RFP cannot go out as it is. ${blockers.join(" ")}`);
    const withoutNda = !ndaInPlace(c);
    if (withoutNda && !v.ndaWarningAcknowledged)
      throw new AppError(409, "nda_missing", `No NDA is in place with ${c.vendorName}. Confirm that you want to issue the RFP anyway.`, {
        ndaWarningAcknowledged: "Tick the box to confirm that the RFP goes out without an NDA in place.",
      });
    await tx
      .update(rfpCandidates)
      .set({ issuedOn: v.issuedOn, ndaWarningAcknowledgedBy: withoutNda ? by.email : null, updatedAt: new Date(), updatedBy: by.email })
      .where(eq(rfpCandidates.id, candidateId));
    const changes: Changes = {
      [`candidate ${c.vendorName}`]: { from: "not issued", to: `issued on ${formatDay(v.issuedOn)}${withoutNda ? ", without an NDA in place (warning acknowledged)" : ""}` },
    };
    if (rfp.stage === "approved") {
      await tx.update(rfps).set({ stage: "issued" }).where(eq(rfps.id, rfp.id));
      changes.Stage = { from: rfpStageLabels.approved, to: rfpStageLabels.issued };
    }
    return changes;
  });
}

/** The candidate, when answers can be recorded for it: issued, still on the shortlist, and the RFP still running. */
function answering(rfp: RfpDetail, candidateId: string): Candidate {
  if (!isOpen(rfp.stage)) throw closed();
  const c = pick(rfp, candidateId);
  if (!inEvaluation(c)) throw new AppError(409, "not_issued", `${c.vendorName} has not been issued the RFP, or is no longer on the shortlist, so there is no response to record.`);
  return c;
}

/** Once the first answer is in, the RFP is being evaluated. */
async function startEvaluating(tx: Tx, rfp: RfpDetail): Promise<Changes> {
  if (rfp.stage !== "issued") return {};
  await tx.update(rfps).set({ stage: "evaluating" }).where(eq(rfps.id, rfp.id));
  return { Stage: { from: rfpStageLabels.issued, to: rfpStageLabels.evaluating } };
}

async function putAnswer(tx: Tx, candidateId: string, questionId: string, text: string, by: User) {
  await tx
    .insert(rfpAnswers)
    .values({ candidateId, questionId, text, createdBy: by.email, updatedBy: by.email })
    .onConflictDoUpdate({ target: [rfpAnswers.candidateId, rfpAnswers.questionId], set: { text, updatedAt: new Date(), updatedBy: by.email } });
}

async function store(ctx: RfpContext, rfpId: string, candidateId: string, file: { name: string; data: Buffer }) {
  const fileName = cleanFileName(file.name);
  const { ext, contentType } = checkDocument(fileName, file.data);
  const storageKey = `rfps/${rfpId}/${candidateId}/${randomUUID()}.${ext}`;
  try {
    await ctx.storage.put(storageKey, file.data, contentType);
  } catch (e) {
    console.error("Document storage failed:", (e as Error).message);
    throw new AppError(502, "storage_failed", "The file could not be stored. Nothing was changed. Try again.");
  }
  return { fileName, ext, contentType, storageKey };
}
/** Removes a stored file whose record was not saved after all, or is gone. A file that cannot be removed right now is only wasted space. */
const discard = (ctx: RfpContext, key: string) => ctx.storage.remove(key).catch((e) => console.error("Could not remove a stored file:", (e as Error).message));

export interface UploadResult {
  rfp: RfpDetail;
  /** What the app made of the sheet, to tell the person who uploaded it. */
  result: { matched: number; unmatched: number; unanswered: number; shortened: number; notListed: number };
}

/**
 * Q-6: takes a candidate's filled answer sheet, matches its rows to the questions and
 * stores the answers. Rows that fit no question are kept for a person to place by hand.
 * The sheet itself is kept with the candidate's documents.
 */
export async function uploadResponse(ctx: RfpContext, candidateId: string, file: { name: string; data: Buffer }, by: User): Promise<UploadResult> {
  const rfpId = await rfpOfCandidate(ctx.db, candidateId);
  answering(await getRfp(ctx.db, rfpId, ctx.today()), candidateId);
  if (!/\.xlsx$/i.test(file.name)) throw new AppError(400, "file_type", "Upload the answer sheet as an Excel file (.xlsx). Other material can be attached as a document.");
  checkDocument(cleanFileName(file.name), file.data);
  const rows = await readAnswerSheet(file.data);
  const stored = await store(ctx, rfpId, candidateId, file);
  let result: UploadResult["result"] = { matched: 0, unmatched: 0, unanswered: 0, shortened: 0, notListed: 0 };
  let saved = false;
  try {
    const rfp = await change(ctx, rfpId, by, async (tx, now) => {
      const c = answering(now, candidateId);
      const { matched, unmatched } = matchAnswers(rows, now.questions);
      const before = new Map(now.answers.filter((a) => a.candidateId === candidateId).map((a) => [a.questionId, a.text]));
      const changes: Changes = {};
      for (const m of matched) {
        const text = m.text.slice(0, MAX_ANSWER);
        await putAnswer(tx, candidateId, m.questionId, text, by);
        // An answer that was there already and now reads differently is named in the history with both texts, so nothing typed by hand is lost without a trace.
        const was = before.get(m.questionId);
        if (was != null && was !== text)
          changes[`answer of ${c.vendorName} to question ${now.questions.find((q) => q.id === m.questionId)!.number}`] = { from: short(was), to: short(text) };
      }
      const left: SheetRow[] = unmatched
        .slice(0, MAX_UNMATCHED)
        .map((u) => ({ ...u, number: u.number.slice(0, 40), question: u.question.slice(0, 1000), answer: u.answer.slice(0, MAX_ANSWER) }));
      await tx
        .update(rfpCandidates)
        .set({ unmatched: left, responseReceivedOn: c.responseReceivedOn ?? ctx.today(), updatedAt: new Date(), updatedBy: by.email })
        .where(eq(rfpCandidates.id, candidateId));
      await tx.insert(documents).values({
        rfpCandidateId: candidateId,
        title: stored.fileName,
        fileName: stored.fileName,
        contentType: stored.contentType,
        sizeBytes: file.data.length,
        storageKey: stored.storageKey,
        createdBy: by.email,
      });
      const answeredNow = new Set([...before.keys(), ...matched.map((m) => m.questionId)]);
      result = {
        matched: matched.length,
        unmatched: left.length,
        unanswered: now.questions.length - answeredNow.size,
        shortened: [...matched, ...unmatched.slice(0, MAX_UNMATCHED)].filter((x) => ("text" in x ? x.text : x.answer).length > MAX_ANSWER).length,
        notListed: unmatched.length - left.length,
      };
      const stage = await startEvaluating(tx, now);
      saved = true;
      return {
        [`answers of ${c.vendorName}`]: {
          from: `${c.answered} of ${now.questions.length} answered`,
          to: `${answeredNow.size} of ${now.questions.length} answered, from ${stored.fileName} (${left.length} rows could not be matched)`,
        },
        ...changes,
        ...stage,
      };
    });
    return { rfp, result };
  } catch (e) {
    // Only when nothing was saved: once the document's record exists its file must stay, whatever failed afterwards.
    if (!saved) await discard(ctx, stored.storageKey);
    throw e;
  }
}

/** The list of unmatched rows is not the one the person was looking at: a sheet was uploaded, or a colleague placed the row, in the meantime. */
const rowsChanged = () =>
  new AppError(
    409,
    "rows_changed",
    "The rows that could not be matched have changed since this page was loaded: a sheet was uploaded again, or a colleague dealt with this row. Nothing was changed. Look at the list as it is now.",
  );

/** Q-6: an answer typed in by hand, or changed. An empty answer removes it. Placing one of the unmatched rows takes it off that list. */
export async function saveAnswer(ctx: RfpContext, candidateId: string, questionId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = answerSchema.parse(input);
  return change(ctx, await rfpOfCandidate(ctx.db, candidateId), by, async (tx, rfp) => {
    const c = answering(rfp, candidateId);
    const q = rfp.questions.find((x) => x.id === questionId);
    if (!q) throw notFound("That question");
    const before = rfp.answers.find((a) => a.candidateId === candidateId && a.questionId === questionId)?.text ?? null;
    const changes: Changes = {};
    if ((before ?? "") !== v.text) {
      if (v.text) await putAnswer(tx, candidateId, questionId, v.text, by);
      else await tx.delete(rfpAnswers).where(and(eq(rfpAnswers.candidateId, candidateId), eq(rfpAnswers.questionId, questionId)));
      changes[`answer of ${c.vendorName} to question ${q.number}`] = { from: short(before), to: short(v.text) || null };
    }
    // Placing a row names the row by its place and by what it says; a row of another sheet that happens to sit in the same place is not taken for it.
    const placed = v.fromUnmatchedRow == null ? null : c.unmatched.find((u) => u.row === v.fromUnmatchedRow && u.answer.trim() === v.text);
    if (v.fromUnmatchedRow != null && !placed) throw rowsChanged();
    const left = placed ? c.unmatched.filter((u) => u !== placed) : c.unmatched;
    if (placed) changes[`unmatched row ${v.fromUnmatchedRow} of ${c.vendorName}'s answer sheet`] = { from: "not matched", to: `placed under question ${q.number}` };
    if (!Object.keys(changes).length) return;
    await tx
      .update(rfpCandidates)
      .set({ unmatched: left, responseReceivedOn: c.responseReceivedOn ?? (v.text ? ctx.today() : null), updatedAt: new Date(), updatedBy: by.email })
      .where(eq(rfpCandidates.id, candidateId));
    return { ...changes, ...(v.text ? await startEvaluating(tx, rfp) : {}) };
  });
}

/** Sets aside a row of the answer sheet that belongs to no question. */
export async function discardUnmatched(ctx: RfpContext, candidateId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = unmatchedRowSchema.parse(input);
  return change(ctx, await rfpOfCandidate(ctx.db, candidateId), by, async (tx, rfp) => {
    const c = answering(rfp, candidateId);
    const gone = c.unmatched.find((u) => u.row === v.row && u.answer === v.answer);
    if (!gone) throw rowsChanged();
    await tx
      .update(rfpCandidates)
      .set({ unmatched: c.unmatched.filter((u) => u !== gone), updatedAt: new Date(), updatedBy: by.email })
      .where(eq(rfpCandidates.id, candidateId));
    return { [`unmatched row ${v.row} of ${c.vendorName}'s answer sheet`]: { from: short(gone.answer), to: "set aside" } };
  });
}

/** Q-6: attaches another document a candidate sent with its response. */
export async function addDocument(ctx: RfpContext, candidateId: string, file: { name: string; data: Buffer }, by: User): Promise<RfpDetail> {
  const rfpId = await rfpOfCandidate(ctx.db, candidateId);
  const stored = await store(ctx, rfpId, candidateId, file);
  let saved = false;
  try {
    return await change(ctx, rfpId, by, async (tx, rfp) => {
      const c = answering(rfp, candidateId);
      await tx.insert(documents).values({
        rfpCandidateId: candidateId,
        title: stored.fileName,
        fileName: stored.fileName,
        contentType: stored.contentType,
        sizeBytes: file.data.length,
        storageKey: stored.storageKey,
        createdBy: by.email,
      });
      saved = true;
      return { [`document ${stored.fileName} of ${c.vendorName}`]: { from: null, to: "attached" } };
    });
  } catch (e) {
    if (!saved) await discard(ctx, stored.storageKey);
    throw e;
  }
}

export async function removeDocument(ctx: RfpContext, documentId: string, by: User): Promise<RfpDetail> {
  const doc = (await ctx.db.select().from(documents).where(eq(documents.id, documentId)))[0];
  if (!doc?.rfpCandidateId) throw notFound("That document");
  const rfp = await change(ctx, await rfpOfCandidate(ctx.db, doc.rfpCandidateId), by, async (tx, now) => {
    if (!isOpen(now.stage)) throw closed();
    const c = pick(now, doc.rfpCandidateId!);
    if (!c.documents.some((d) => d.id === documentId)) throw notFound("That document");
    await tx.delete(documents).where(eq(documents.id, documentId));
    return { [`document ${doc.fileName} of ${c.vendorName}`]: { from: "attached", to: "removed" } };
  });
  await discard(ctx, doc.storageKey);
  return rfp;
}
