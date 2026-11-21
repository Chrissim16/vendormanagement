import { createHash } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { documents, rfpAnswers, rfpCandidates, rfpCriteria, rfpQuestions, rfpScores, rfpSections, rfpSignoffs, rfps, users } from "../../../db/schema";
import { formatDay, type Day } from "../../../shared/dates";
import { formatMoney } from "../../../shared/money";
import type { OpenRfp } from "../../../shared/overview";
import {
  approvalBlocker,
  contentEditable,
  contentLocked,
  contentProblems,
  draftToContent,
  inEvaluation,
  isOpen,
  partLabels,
  reviewBlockers,
  rfpContentSchema,
  rfpDemandSchema,
  rfpResults,
  rfpStageLabels,
  sameAsDraft,
  signoffLabels,
  signoffSchema,
  stageMoveSchema,
  templateDraft,
  type Candidate,
  type RfpComparison,
  type RfpContentInput,
  type RfpDetail,
  type RfpDraft,
  type RfpRow,
  type RfpStage,
} from "../../../shared/rfp";
import { suggestionStatusLabels, type SuggestionStatus } from "../../../shared/scorecards";
import type { Page, User } from "../../../shared/types";
import { z } from "zod";
import { ask, readSuggestion, recordSuggestion, replaced, reviewSuggestion } from "../../ai";
import { rfpDraft } from "../../ai/prompts/rfp-draft";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import { failFields, like } from "../../platform/http";
import type { AiPort, Db, Queryable, StoragePort, Tx } from "../../platform/ports/types";
import { getVendor } from "../vendors/service";

/** What the RFP feature needs: the database, the AI, the place files are kept, and the clock. */
export interface RfpContext {
  db: Db;
  ai: AiPort;
  storage: StoragePort;
  today: () => Day;
  now: () => Date;
}
export type Changes = Record<string, { from: unknown; to: unknown }>;

const personName = sql<string>`coalesce(${users.displayName}, ${users.email})`;
const short = (s: string | null | undefined, max = 160) => (s == null ? null : s.length > max ? `${s.slice(0, max)}…` : s);
export const words = (s: SuggestionStatus) => suggestionStatusLabels[s].toLowerCase();

/** What the comparison read: every answer of the candidates in the running. Changes whenever one of them does. */
export function answersFingerprint(candidates: Pick<Candidate, "id" | "list" | "issuedOn">[], answers: { candidateId: string; questionId: string; text: string }[]): string {
  const running = new Set(candidates.filter(inEvaluation).map((c) => c.id));
  const lines = answers
    .filter((a) => running.has(a.candidateId))
    .map((a) => `${a.candidateId}|${a.questionId}|${a.text}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** Everything about one RFP, as its page shows it. */
export async function getRfp(db: Queryable, id: string, today: Day): Promise<RfpDetail> {
  const row = (await db.select({ rfp: rfps, ownerName: personName }).from(rfps).innerJoin(users, eq(users.id, rfps.ownerUserId)).where(eq(rfps.id, id)))[0];
  if (!row) throw notFound("That RFP");
  const r = row.rfp;
  const [sections, criteria, questions, signoffs, candidateRows] = await Promise.all([
    db.select().from(rfpSections).where(eq(rfpSections.rfpId, id)).orderBy(asc(rfpSections.position)),
    db.select().from(rfpCriteria).where(eq(rfpCriteria.rfpId, id)).orderBy(asc(rfpCriteria.position)),
    db.select().from(rfpQuestions).where(eq(rfpQuestions.rfpId, id)).orderBy(asc(rfpQuestions.number)),
    db.select().from(rfpSignoffs).where(eq(rfpSignoffs.rfpId, id)).orderBy(asc(rfpSignoffs.onDate), asc(rfpSignoffs.createdAt)),
    db.select().from(rfpCandidates).where(eq(rfpCandidates.rfpId, id)).orderBy(asc(rfpCandidates.createdAt), asc(rfpCandidates.id)),
  ]);
  const candidateIds = candidateRows.map((c) => c.id);
  const none = candidateIds.length === 0;
  const [answers, scores, files, vendorRows] = await Promise.all([
    none ? [] : db.select().from(rfpAnswers).where(inArray(rfpAnswers.candidateId, candidateIds)),
    none
      ? []
      : db
          .select({ score: rfpScores, evaluatorName: personName })
          .from(rfpScores)
          .innerJoin(users, eq(users.id, rfpScores.evaluatorUserId))
          .where(inArray(rfpScores.candidateId, candidateIds))
          .orderBy(asc(personName)),
    none ? [] : db.select().from(documents).where(inArray(documents.rfpCandidateId, candidateIds)).orderBy(desc(documents.createdAt)),
    Promise.all(candidateRows.map((c) => getVendor(db, c.vendorId, today))),
  ]);
  const candidates: Candidate[] = candidateRows.map((c, i) => ({
    id: c.id,
    vendorId: c.vendorId,
    vendorName: vendorRows[i]!.name,
    vendorStatus: vendorRows[i]!.status,
    vendorType: vendorRows[i]!.type,
    nda: vendorRows[i]!.nda,
    list: c.list,
    reason: c.reason,
    issuedOn: c.issuedOn,
    ndaWarningAcknowledgedBy: c.ndaWarningAcknowledgedBy,
    responseReceivedOn: c.responseReceivedOn,
    unmatched: c.unmatched,
    answered: answers.filter((a) => a.candidateId === c.id).length,
    documents: files
      .filter((f) => f.rfpCandidateId === c.id)
      .map((f) => ({ id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes, createdAt: f.createdAt.toISOString(), createdBy: f.createdBy })),
  }));
  const running = candidates.filter(inEvaluation).map((c) => c.id);
  const plainScores = scores.map(({ score: s, evaluatorName }) => ({
    candidateId: s.candidateId,
    criterionId: s.criterionId,
    evaluatorUserId: s.evaluatorUserId,
    evaluatorName,
    score: s.score,
    comment: s.comment,
    suggestedScore: s.suggestedScore,
  }));
  const plainAnswers = answers.map((a) => ({ candidateId: a.candidateId, questionId: a.questionId, text: a.text }));
  const [draft, comparison] = await Promise.all([readSuggestion<RfpDraft>(db, r.draftSuggestionId), readSuggestion<RfpComparison>(db, r.comparisonSuggestionId)]);
  const winner = candidates.find((c) => c.id === r.winnerCandidateId);
  return {
    id: r.id,
    title: r.title,
    need: r.need,
    budgetMinor: r.budgetMinor,
    currency: r.currency,
    sponsor: r.sponsor,
    demandApprovedOn: r.demandApprovedOn,
    targetDecisionDate: r.targetDecisionDate,
    ownerUserId: r.ownerUserId,
    ownerName: row.ownerName,
    writtenWeight: r.writtenWeight,
    demoWeight: r.demoWeight,
    stage: r.stage,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy,
    sections: sections.map((s) => ({ id: s.id, heading: s.heading, body: s.body })),
    criteria: criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, part: c.part })),
    questions: questions.map((q) => ({ id: q.id, number: q.number, text: q.text, criterionId: q.criterionId })),
    signoffs: signoffs.map((s) => ({
      id: s.id,
      reviewerName: s.reviewerName,
      reviewerRole: s.reviewerRole,
      outcome: s.outcome,
      onDate: s.onDate,
      comment: s.comment,
      resolvedOn: s.resolvedOn,
      superseded: s.superseded,
      createdBy: s.createdBy,
    })),
    candidates,
    answers: plainAnswers,
    scores: plainScores,
    results: rfpResults(
      r,
      criteria,
      running,
      plainScores.filter((s) => running.includes(s.candidateId)),
    ),
    draft,
    comparison,
    comparisonOutdated: !!comparison && r.comparisonAnswers !== answersFingerprint(candidates, plainAnswers),
    decision:
      r.stage === "decided" && winner && r.decidedOn && r.rationale
        ? { winnerCandidateId: winner.id, winnerName: winner.vendorName, decidedOn: r.decidedOn, rationale: r.rationale }
        : null,
    cancelReason: r.cancelReason,
  };
}

const sorts = { title: sql`lower(${rfps.title})`, stage: rfps.stage, owner: sql`lower(${personName})`, target: rfps.targetDecisionDate, updated: rfps.updatedAt };
export type RfpSort = keyof typeof sorts;
export const rfpSorts = Object.keys(sorts) as RfpSort[];
export interface RfpFilter {
  q?: string;
  /** One stage, "open" for everything still running, or nothing for all. */
  stage?: RfpStage | "open";
  sort: RfpSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** Q-11: the RFPs with their stage, owner and target date. */
export async function listRfps(db: Queryable, f: RfpFilter): Promise<Page<RfpRow>> {
  const where: SQL[] = [];
  if (f.q) where.push(ilike(rfps.title, like(f.q)));
  if (f.stage === "open") where.push(notInArray(rfps.stage, ["decided", "cancelled"]));
  else if (f.stage) where.push(eq(rfps.stage, f.stage));
  const cond = where.length ? and(...where) : undefined;
  const col = sorts[f.sort];
  const winner = sql<string | null>`(select v.name from rfp_candidates c join vendors v on v.id = c.vendor_id where c.id = ${rfps.winnerCandidateId})`;
  const [items, total] = await Promise.all([
    db
      .select({
        rfp: rfps,
        ownerName: personName,
        candidates: sql<number>`(select count(*)::int from rfp_candidates c where c.rfp_id = ${rfps.id} and c.list <> 'dropped')`,
        winnerName: winner,
      })
      .from(rfps)
      .innerJoin(users, eq(users.id, rfps.ownerUserId))
      .where(cond)
      .orderBy(f.dir === "desc" ? sql`${col} desc nulls last` : sql`${col} asc nulls last`, asc(rfps.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(rfps)
      .where(cond),
  ]);
  return {
    items: items.map(({ rfp: r, ownerName, candidates, winnerName }) => ({
      id: r.id,
      title: r.title,
      stage: r.stage,
      ownerUserId: r.ownerUserId,
      ownerName,
      targetDecisionDate: r.targetDecisionDate,
      candidates,
      winnerName,
      updatedAt: r.updatedAt.toISOString(),
    })),
    total: total[0]?.n ?? 0,
  };
}

/** For the dashboard and the monthly report: the RFPs still running, the nearest target date first. */
export async function openRfps(db: Queryable): Promise<OpenRfp[]> {
  const rows = await db
    .select({ id: rfps.id, title: rfps.title, stage: rfps.stage })
    .from(rfps)
    .where(notInArray(rfps.stage, ["decided", "cancelled"]))
    .orderBy(sql`${rfps.targetDecisionDate} asc nulls last`, asc(sql`lower(${rfps.title})`));
  return rows.map((r) => ({ id: r.id, title: r.title, stage: rfpStageLabels[r.stage] }));
}

/** For a vendor's panel: the RFPs it is or was a candidate in. */
export async function rfpsOfVendor(db: Queryable, vendorId: string) {
  const rows = await db
    .select({ id: rfps.id, title: rfps.title, stage: rfps.stage, list: rfpCandidates.list, won: sql<boolean>`${rfps.winnerCandidateId} = ${rfpCandidates.id}` })
    .from(rfpCandidates)
    .innerJoin(rfps, eq(rfps.id, rfpCandidates.rfpId))
    .where(eq(rfpCandidates.vendorId, vendorId))
    .orderBy(desc(rfps.createdAt));
  return rows.map((r) => ({ ...r, won: !!r.won }));
}

export const lock = (tx: Queryable, id: string) => tx.execute(sql`select 1 from rfps where id = ${id} for update`);

/**
 * One change to an RFP: locks it, reads it as it stands, lets `apply` check the rules and
 * make the change, and writes the history entry in the same transaction. `apply` returns
 * what changed in words; when nothing did, nothing is recorded.
 */
export async function change(ctx: RfpContext, id: string, by: User, apply: (tx: Tx, rfp: RfpDetail) => Promise<Changes | void>): Promise<RfpDetail> {
  const today = ctx.today();
  await ctx.db.transaction(async (tx) => {
    await lock(tx, id);
    const rfp = await getRfp(tx, id, today);
    const changes = await apply(tx, rfp);
    if (!changes || !Object.keys(changes).length) return;
    await tx.update(rfps).set({ updatedAt: new Date(), updatedBy: by.email }).where(eq(rfps.id, id));
    await audit(tx, { userEmail: by.email, action: "update", entityType: "rfp", entityId: id, summary: rfp.title, changes });
  });
  return getRfp(ctx.db, id, today);
}

export const closed = () => new AppError(409, "rfp_closed", "This RFP is decided or cancelled, so nothing on it can be changed any more.");
/** Why the document or the part weights cannot be changed at this stage. */
const locked = (stage: RfpStage) =>
  contentLocked(stage)
    ? new AppError(
        409,
        "rfp_locked",
        "The RFP has been issued to a candidate, so its sections, criteria, questions and weights can no longer be changed. Every candidate must answer the same questions.",
      )
    : new AppError(409, "rfp_approved", "The RFP is approved as it is. To change it, take it back to drafting on the Review tab; it then needs approving again.");

/**
 * The document or its weights changed: an approval given before speaks for an earlier
 * version and no longer counts (Q-3). It stays in the trail, marked as such.
 */
async function supersedeApprovals(tx: Tx, rfp: RfpDetail): Promise<Changes> {
  const earlier = rfp.signoffs.filter((x) => x.outcome === "approved" && !x.superseded);
  if (!earlier.length) return {};
  await tx
    .update(rfpSignoffs)
    .set({ superseded: true })
    .where(and(eq(rfpSignoffs.rfpId, rfp.id), eq(rfpSignoffs.outcome, "approved")));
  return {
    [earlier.length === 1 ? `approval by ${earlier[0]!.reviewerName}` : `${earlier.length} approvals`]: {
      from: "counted",
      to: "no longer counted: the document was changed afterwards",
    },
  };
}

async function checkOwner(db: Queryable, ownerUserId: string) {
  const owner = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, ownerUserId), eq(users.active, true)))
  )[0];
  if (!owner) failFields({ ownerUserId: "Choose an owner who has access to the app." });
}
const demandLabels: Record<string, string> = {
  title: "Title",
  need: "Need",
  budgetMinor: "budgetMinor",
  currency: "currency",
  sponsor: "Sponsor",
  demandApprovedOn: "Demand approved on",
  targetDecisionDate: "Target decision date",
  ownerUserId: "ownerUserId",
  writtenWeight: "Weight of the written answers",
  demoWeight: "Weight of demo and interview",
};

/** Q-1: records the approved demand. The RFP starts in drafting, with the template's two weights. */
export async function createRfp(ctx: RfpContext, input: unknown, by: User): Promise<RfpDetail> {
  const v = rfpDemandSchema.parse(input);
  if (v.demandApprovedOn && v.demandApprovedOn > ctx.today()) failFields({ demandApprovedOn: "The approval date cannot be in the future." });
  const id = await ctx.db.transaction(async (tx) => {
    await checkOwner(tx, v.ownerUserId);
    const row = (
      await tx
        .insert(rfps)
        .values({ ...v, createdBy: by.email, updatedBy: by.email })
        .returning()
    )[0]!;
    await audit(tx, { userEmail: by.email, action: "create", entityType: "rfp", entityId: row.id, summary: row.title });
    return row.id;
  });
  return getRfp(ctx.db, id, ctx.today());
}

/** Changes the demand. Fields that were not sent keep their value. The two part weights are fixed once the RFP is issued. */
export async function updateRfp(ctx: RfpContext, id: string, input: unknown, by: User): Promise<RfpDetail> {
  const sent = z.record(z.string(), z.unknown()).parse(input ?? {});
  return change(ctx, id, by, async (tx, rfp) => {
    if (!isOpen(rfp.stage)) throw closed();
    const current = Object.fromEntries(Object.keys(demandLabels).map((k) => [k, rfp[k as keyof RfpDetail]]));
    const next = rfpDemandSchema.parse({ ...current, ...Object.fromEntries(Object.entries(sent).filter(([k]) => Object.hasOwn(demandLabels, k))) });
    if (next.demandApprovedOn && next.demandApprovedOn !== rfp.demandApprovedOn && next.demandApprovedOn > ctx.today())
      failFields({ demandApprovedOn: "The approval date cannot be in the future." });
    if (next.ownerUserId !== rfp.ownerUserId) await checkOwner(tx, next.ownerUserId);
    const changes: Changes = {};
    for (const k of Object.keys(demandLabels) as (keyof typeof next)[]) if (next[k] !== current[k]) changes[demandLabels[k]!] = { from: current[k], to: next[k] };
    const weights = "Weight of the written answers" in changes || "Weight of demo and interview" in changes;
    if (weights && !contentEditable(rfp.stage)) throw locked(rfp.stage);
    if (Object.keys(changes).length) await tx.update(rfps).set(next).where(eq(rfps.id, id));
    return { ...changes, ...(weights ? await supersedeApprovals(tx, rfp) : {}) };
  });
}

/** What changed between two versions of the document, in words for the history. */
function contentChanges(before: RfpDetail, after: RfpContentInput): Changes {
  const changes: Changes = {};
  const oldSections = new Map(before.sections.map((s) => [s.heading, s.body]));
  const newSections = new Map(after.sections.map((s) => [s.heading, s.body]));
  for (const [heading, body] of newSections) {
    if (!oldSections.has(heading)) changes[`section ${heading}`] = { from: null, to: "added" };
    else if ((oldSections.get(heading) ?? null) !== (body ?? null)) changes[`section ${heading}`] = { from: short(oldSections.get(heading)), to: short(body) };
  }
  for (const heading of oldSections.keys()) if (!newSections.has(heading)) changes[`section ${heading}`] = { from: "listed", to: "removed" };
  if (before.sections.map((s) => s.heading).join("\n") !== after.sections.map((s) => s.heading).join("\n") && !Object.keys(changes).length)
    changes["order of the sections"] = { from: null, to: "changed" };

  const says = (c: { weight: number; part: "written" | "demo" }) => `${c.weight}% of ${partLabels[c.part].toLowerCase()}`;
  const oldCriteria = new Map(before.criteria.map((c) => [`${c.part}:${c.name}`, c]));
  const newCriteria = new Map(after.criteria.map((c) => [`${c.part}:${c.name}`, c]));
  for (const [k, c] of newCriteria) {
    const was = oldCriteria.get(k);
    if (!was) changes[`criterion ${c.name}`] = { from: null, to: says(c) };
    else if (was.weight !== c.weight) changes[`criterion ${c.name}`] = { from: says(was), to: says(c) };
  }
  for (const [k, c] of oldCriteria) if (!newCriteria.has(k)) changes[`criterion ${c.name}`] = { from: says(c), to: "removed" };

  const nameOfOld = new Map(before.criteria.map((c) => [c.id, c.name]));
  const nameOfNew = new Map(after.criteria.map((c) => [c.key, c.name]));
  const oldQuestions = before.questions.map((q) => `${q.text}\u0000${nameOfOld.get(q.criterionId)}`);
  const newQuestions = after.questions.map((q) => `${q.text}\u0000${nameOfNew.get(q.criterionKey)}`);
  const added = newQuestions.filter((q) => !oldQuestions.includes(q)).length;
  const removed = oldQuestions.filter((q) => !newQuestions.includes(q)).length;
  if (added || removed || oldQuestions.join("\n") !== newQuestions.join("\n"))
    changes["question list"] = {
      from: `${oldQuestions.length} questions`,
      to: `${newQuestions.length} questions${added || removed ? ` (${[added && `${added} new or reworded`, removed && `${removed} removed or reworded`].filter(Boolean).join(", ")})` : " (order changed)"}`,
    };
  return changes;
}

/** Replaces the sections, criteria and questions with what was sent. Questions are numbered in the order given. */
async function writeContent(tx: Tx, rfpId: string, c: RfpContentInput) {
  await tx.delete(rfpQuestions).where(eq(rfpQuestions.rfpId, rfpId));
  await tx.delete(rfpCriteria).where(eq(rfpCriteria.rfpId, rfpId));
  await tx.delete(rfpSections).where(eq(rfpSections.rfpId, rfpId));
  if (c.sections.length) await tx.insert(rfpSections).values(c.sections.map((s, i) => ({ rfpId, position: i + 1, heading: s.heading, body: s.body })));
  const ids = new Map<string, string>();
  if (c.criteria.length) {
    const rows = await tx
      .insert(rfpCriteria)
      .values(c.criteria.map((x, i) => ({ rfpId, position: i + 1, name: x.name, weight: x.weight, part: x.part })))
      .returning();
    rows.forEach((row) => ids.set(c.criteria[row.position - 1]!.key, row.id));
  }
  if (c.questions.length) await tx.insert(rfpQuestions).values(c.questions.map((q, i) => ({ rfpId, number: i + 1, text: q.text, criterionId: ids.get(q.criterionKey)! })));
}

/** After the document changed: an AI draft that was taken over now counts as accepted or as edited, whichever is true (AI-1). */
async function settleDraft(ctx: RfpContext, tx: Tx, rfp: RfpDetail, by: User): Promise<Changes> {
  const draft = rfp.draft;
  if (!draft || (draft.status !== "accepted" && draft.status !== "edited")) return {};
  const now = await getRfp(tx, rfp.id, ctx.today());
  const status = sameAsDraft(now, draft.output) ? "accepted" : "edited";
  if (status === draft.status) return {};
  await reviewSuggestion(tx, draft.id, status, by.email, ctx.now());
  return { "AI draft": { from: words(draft.status), to: words(status) } };
}

/** Q-2: saves the whole document as a person left it. Weights within a part must add up to 100 and every question belongs to one written criterion. */
export async function saveContent(ctx: RfpContext, id: string, input: unknown, by: User): Promise<RfpDetail> {
  const content = rfpContentSchema.parse(input);
  const problems = contentProblems(content);
  if (Object.keys(problems).length) failFields(problems);
  return change(ctx, id, by, async (tx, rfp) => {
    if (!isOpen(rfp.stage)) throw closed();
    if (!contentEditable(rfp.stage)) throw locked(rfp.stage);
    const changes = contentChanges(rfp, content);
    if (!Object.keys(changes).length) return;
    await writeContent(tx, id, content);
    return { ...changes, ...(await settleDraft(ctx, tx, rfp, by)), ...(await supersedeApprovals(tx, rfp)) };
  });
}

const draftCounts = (d: { sections: unknown[]; criteria: unknown[]; questions: unknown[] }) =>
  `${d.sections.length} sections, ${d.criteria.length} criteria, ${d.questions.length} questions`;
const hasContent = (r: RfpDetail) => r.sections.length + r.criteria.length + r.questions.length > 0;

/** Starts the document from the template without the AI: the usual sections, still to be written, and the usual criteria. */
export async function startFromTemplate(ctx: RfpContext, id: string, by: User): Promise<RfpDetail> {
  return change(ctx, id, by, async (tx, rfp) => {
    if (rfp.stage !== "drafting") throw new AppError(409, "not_drafting", "The template can only be used while the RFP is being drafted.");
    if (hasContent(rfp)) throw new AppError(409, "not_empty", "The RFP already has sections, criteria or questions. The template only fills an empty one.");
    const draft = templateDraft();
    await writeContent(tx, id, draftToContent(draft));
    return { Document: { from: null, to: `started from the template (${draftCounts(draft)})` }, ...(await supersedeApprovals(tx, rfp)) };
  });
}

/** Q-2: asks the AI for a draft from the need and the template, and keeps it as a suggestion. The document itself is not touched. */
export async function suggestDraft(ctx: RfpContext, id: string, by: User): Promise<RfpDetail> {
  const before = await getRfp(ctx.db, id, ctx.today());
  const drafting = () => new AppError(409, "not_drafting", "The AI drafts an RFP while it is being drafted. This one has moved on.");
  if (before.stage !== "drafting") throw drafting();
  // The budget and the sponsor are not passed on: the document goes to vendors.
  const { output, model } = await ask(ctx.ai, rfpDraft, { title: before.title, need: before.need, targetDecisionDate: before.targetDecisionDate }, "write a draft");
  return change(ctx, id, by, async (tx, rfp) => {
    if (rfp.stage !== "drafting") throw drafting();
    if (rfp.draft?.status === "proposed") await reviewSuggestion(tx, rfp.draft.id, "rejected", "system", ctx.now());
    const suggestion = await recordSuggestion(tx, {
      prompt: rfpDraft,
      subjectType: "rfp",
      subjectId: id,
      model,
      inputSummary: `${rfp.title}: the need and the template`,
      output,
      at: ctx.now(),
    });
    await tx.update(rfps).set({ draftSuggestionId: suggestion.id }).where(eq(rfps.id, id));
    return { "AI draft": { from: rfp.draft ? words(rfp.draft.status) : null, to: `written by the AI (${draftCounts(output)})` } };
  });
}

/** A person takes the AI's draft over as the document, or rejects it. Taking it over replaces what the document held. */
export async function reviewDraft(ctx: RfpContext, id: string, input: unknown, by: User): Promise<RfpDetail> {
  const { action, suggestionId } = z.object({ action: z.enum(["accept", "reject"]), suggestionId: z.string().uuid() }).parse(input);
  return change(ctx, id, by, async (tx, rfp): Promise<Changes | void> => {
    const draft = rfp.draft;
    if (!draft) throw new AppError(409, "no_suggestion", "There is no AI draft for this RFP. Ask the AI for one first.");
    // The person read one draft; if the AI has written another since, that one has not been read.
    if (draft.id !== suggestionId) throw replaced();
    if (!isOpen(rfp.stage)) throw closed();
    if (action === "reject") {
      if (draft.status !== "proposed") return;
      await reviewSuggestion(tx, draft.id, "rejected", by.email, ctx.now());
      return { "AI draft": { from: words(draft.status), to: words("rejected") } };
    }
    if (rfp.stage !== "drafting") throw new AppError(409, "not_drafting", "A draft can only be taken over while the RFP is being drafted.");
    if (draft.status === "accepted") return;
    await writeContent(tx, id, draftToContent(draft.output));
    await reviewSuggestion(tx, draft.id, "accepted", by.email, ctx.now());
    return {
      ...(await supersedeApprovals(tx, rfp)),
      "AI draft": { from: words(draft.status), to: words("accepted") },
      Document: { from: hasContent(rfp) ? draftCounts(rfp) : null, to: `the AI's draft (${draftCounts(draft.output)})` },
    };
  });
}

/** Q-3: moves an RFP between drafting, in review and approved. The later stages follow from what is done (issuing, answers, the decision). */
export async function moveStage(ctx: RfpContext, id: string, input: unknown, by: User): Promise<RfpDetail> {
  const { to } = stageMoveSchema.parse(input);
  return change(ctx, id, by, async (tx, rfp) => {
    if (rfp.stage === to) return;
    const refuse = (message: string) => new AppError(409, "stage_refused", message);
    if (to === "in_review") {
      if (rfp.stage !== "drafting" && rfp.stage !== "approved") throw refuse(`An RFP that is ${rfpStageLabels[rfp.stage].toLowerCase()} cannot go back to review.`);
      const blockers = reviewBlockers(rfp);
      if (blockers.length) throw refuse(`The draft is not ready for review. ${blockers.join(" ")}`);
    } else if (to === "drafting") {
      if (rfp.stage !== "in_review" && rfp.stage !== "approved") throw refuse(`An RFP that is ${rfpStageLabels[rfp.stage].toLowerCase()} cannot go back to drafting.`);
    } else {
      if (rfp.stage !== "in_review") throw refuse("Only an RFP that is in review can be marked as approved.");
      const blocker = approvalBlocker(rfp.signoffs);
      if (blocker) throw refuse(blocker);
    }
    await tx.update(rfps).set({ stage: to }).where(eq(rfps.id, id));
    return { Stage: { from: rfpStageLabels[rfp.stage], to: rfpStageLabels[to] } };
  });
}

const signoffName = (s: { reviewerName: string; outcome: "approved" | "changes_requested" }) => `sign-off by ${s.reviewerName}`;

/** Q-3: records what a reviewer decided. Reviewers are often outside the team, so a member records it for them. */
export async function addSignoff(ctx: RfpContext, id: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = signoffSchema.parse(input);
  if (v.onDate > ctx.today()) failFields({ onDate: "The date cannot be in the future." });
  return change(ctx, id, by, async (tx, rfp) => {
    if (rfp.stage !== "in_review") throw new AppError(409, "not_in_review", "Sign-offs are recorded while the RFP is in review. Send it for review first.");
    await tx.insert(rfpSignoffs).values({ ...v, rfpId: id, createdBy: by.email, updatedBy: by.email });
    return { [signoffName(v)]: { from: null, to: `${signoffLabels[v.outcome]} on ${formatDay(v.onDate)}${v.comment ? `: ${short(v.comment)}` : ""}` } };
  });
}

/** Marks a requested change as dealt with (or open again), or removes a sign-off recorded by mistake. */
export async function changeSignoff(ctx: RfpContext, signoffId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = z.union([z.object({ resolved: z.boolean() }), z.object({ remove: z.literal(true) })]).parse(input);
  const row = (await ctx.db.select().from(rfpSignoffs).where(eq(rfpSignoffs.id, signoffId)))[0];
  if (!row) throw notFound("That sign-off");
  return change(ctx, row.rfpId, by, async (tx, rfp) => {
    const s = rfp.signoffs.find((x) => x.id === signoffId);
    if (!s) throw notFound("That sign-off");
    if (rfp.stage !== "drafting" && rfp.stage !== "in_review")
      throw new AppError(
        409,
        "review_over",
        "The review is over: this RFP has been approved, so its sign-offs can no longer be changed. Take it back to drafting first if the review has to be redone.",
      );
    if ("remove" in v) {
      await tx.delete(rfpSignoffs).where(eq(rfpSignoffs.id, signoffId));
      return { [signoffName(s)]: { from: signoffLabels[s.outcome], to: "removed" } };
    }
    if (s.outcome !== "changes_requested") throw new AppError(409, "not_a_change_request", "Only requested changes can be marked as dealt with.");
    if (!!s.resolvedOn === v.resolved) return;
    await tx
      .update(rfpSignoffs)
      .set({ resolvedOn: v.resolved ? ctx.today() : null, updatedAt: new Date(), updatedBy: by.email })
      .where(eq(rfpSignoffs.id, signoffId));
    return { [`changes requested by ${s.reviewerName}`]: { from: v.resolved ? "open" : "dealt with", to: v.resolved ? "dealt with" : "open" } };
  });
}

/** How an RFP's budget reads in a document. */
export const budgetWords = (r: Pick<RfpDetail, "budgetMinor" | "currency">) => (r.budgetMinor == null ? "Not set" : formatMoney(r.budgetMinor, r.currency));
