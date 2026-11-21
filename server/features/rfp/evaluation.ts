import { and, eq } from "drizzle-orm";
import { rfpScores, rfps } from "../../../db/schema";
import { formatDay } from "../../../shared/dates";
import { cancelSchema, decisionSchema, inEvaluation, isOpen, rfpScoreSchema, rfpStageLabels, type RfpComparison, type RfpDetail } from "../../../shared/rfp";
import type { User } from "../../../shared/types";
import { ask, recordSuggestion, reviewSuggestion } from "../../ai";
import { rfpComparison, type RfpComparisonInput } from "../../ai/prompts/rfp-comparison";
import { AppError, notFound } from "../../platform/errors";
import { failFields } from "../../platform/http";
import type { Db, Tx } from "../../platform/ports/types";
import { replaced } from "../reports/service";
import { getVendor, updateVendor } from "../vendors/service";
import { rfpOfCandidate } from "./candidates";
import { answersFingerprint, change, closed, getRfp, words, type Changes, type RfpContext } from "./service";

const evaluating = (rfp: RfpDetail) => {
  if (!isOpen(rfp.stage)) throw closed();
  if (rfp.stage !== "issued" && rfp.stage !== "evaluating")
    throw new AppError(409, "not_issued", "The RFP has not been issued to a candidate yet. Answers are compared and candidates are scored after that.");
};

/** What the AI is given for one written criterion: its questions and what each candidate in the running answered. */
export function comparisonInputs(rfp: RfpDetail): RfpComparisonInput[] {
  const candidates = rfp.candidates.filter(inEvaluation).map((c) => ({ id: c.id, name: c.vendorName }));
  return rfp.criteria
    .filter((c) => c.part === "written")
    .map((criterion) => ({
      rfpTitle: rfp.title,
      criterion: { id: criterion.id, name: criterion.name },
      candidates,
      questions: rfp.questions
        .filter((q) => q.criterionId === criterion.id)
        .map((q) => ({
          id: q.id,
          number: q.number,
          text: q.text,
          answers: candidates.map((c) => ({ candidateId: c.id, text: rfp.answers.find((a) => a.candidateId === c.id && a.questionId === q.id)?.text ?? null })),
        })),
    }))
    .filter((i) => i.questions.length > 0);
}

/**
 * Q-7: asks the AI to summarise and compare the answers per question and to propose a
 * score per candidate and criterion. One question to the AI per criterion, so each stays
 * small. The result is kept as one suggestion; no score is given by it.
 */
export async function compareAnswers(ctx: RfpContext, rfpId: string, by: User): Promise<RfpDetail> {
  const before = await getRfp(ctx.db, rfpId, ctx.today());
  evaluating(before);
  const running = before.candidates.filter(inEvaluation);
  if (!before.answers.some((a) => running.some((c) => c.id === a.candidateId)))
    throw new AppError(409, "no_answers", "There are no answers to compare yet. Upload a candidate's answer sheet first.");
  const inputs = comparisonInputs(before);
  const answers = await Promise.all(inputs.map((i) => ask(ctx.ai, rfpComparison, i, "compare the answers")));
  const output: RfpComparison = {
    questions: answers.flatMap((a) => a.output.questions),
    scores: answers.flatMap((a, n) => a.output.scores.map((s) => ({ ...s, criterionId: inputs[n]!.criterion.id }))),
  };
  const fingerprint = answersFingerprint(before.candidates, before.answers);
  return change(ctx, rfpId, by, async (tx, rfp) => {
    evaluating(rfp);
    if (rfp.comparison?.status === "proposed") await reviewSuggestion(tx, rfp.comparison.id, "rejected", "system", ctx.now());
    const answered = running.filter((c) => c.answered > 0).length;
    const suggestion = await recordSuggestion(tx, {
      prompt: rfpComparison,
      subjectType: "rfp",
      subjectId: rfpId,
      model: answers[0]?.model ?? "none",
      inputSummary: `${rfp.title}: the answers of ${answered} ${answered === 1 ? "candidate" : "candidates"} to ${rfp.questions.length} questions`,
      output,
      at: ctx.now(),
    });
    // The fingerprint is of the answers the AI was given; if one changed while it was writing, the page says so.
    await tx.update(rfps).set({ comparisonSuggestionId: suggestion.id, comparisonAnswers: fingerprint }).where(eq(rfps.id, rfpId));
    return {
      "AI comparison": {
        from: rfp.comparison ? words(rfp.comparison.status) : null,
        to: `written by the AI (${output.questions.length} questions, ${output.scores.length} proposed scores)`,
      },
    };
  });
}

/** The comparison counts as accepted while every score given with it on screen equals its proposal, and as edited once one differs (AI-1). */
async function settleComparison(ctx: RfpContext, tx: Tx, rfp: RfpDetail, by: User): Promise<Changes> {
  const c = rfp.comparison;
  if (!c) return {};
  const given = await tx.select({ score: rfpScores.score, suggested: rfpScores.suggestedScore }).from(rfpScores).where(eq(rfpScores.suggestionId, c.id));
  if (!given.length) return {};
  const status = given.every((g) => g.score === g.suggested) ? "accepted" : "edited";
  if (status === c.status) return {};
  await reviewSuggestion(tx, c.id, status, by.email, ctx.now());
  return { "AI comparison": { from: words(c.status), to: words(status) } };
}

/**
 * Q-8: a team member's own score for a candidate on a criterion. Taking over the AI's
 * proposal names the comparison that was on screen, and is refused when the AI has
 * written another since.
 */
export async function saveScore(ctx: RfpContext, candidateId: string, criterionId: string, input: unknown, by: User): Promise<RfpDetail> {
  const remove = input === null;
  const v = remove ? null : rfpScoreSchema.parse(input);
  return change(ctx, await rfpOfCandidate(ctx.db, candidateId), by, async (tx, rfp) => {
    evaluating(rfp);
    const c = rfp.candidates.find((x) => x.id === candidateId);
    const k = rfp.criteria.find((x) => x.id === criterionId);
    if (!c) throw notFound("That candidate");
    if (!k) throw notFound("That criterion");
    if (!inEvaluation(c)) throw new AppError(409, "not_issued", `${c.vendorName} has not been issued the RFP, or is no longer on the shortlist, so it is not scored.`);
    const mine = rfp.scores.find((s) => s.candidateId === candidateId && s.criterionId === criterionId && s.evaluatorUserId === by.id);
    const label = `score by ${by.displayName ?? by.email} for ${c.vendorName} on ${k.name}`;
    const where = and(eq(rfpScores.candidateId, candidateId), eq(rfpScores.criterionId, criterionId), eq(rfpScores.evaluatorUserId, by.id));
    if (!v) {
      if (!mine) return;
      await tx.delete(rfpScores).where(where);
      return { [label]: { from: mine.score, to: null }, ...(await settleComparison(ctx, tx, rfp, by)) };
    }
    if (v.suggestionId && v.suggestionId !== rfp.comparison?.id) throw replaced();
    const proposal = rfp.comparison?.output.scores.find((s) => s.candidateId === candidateId && s.criterionId === criterionId);
    if (v.suggestionId && (!proposal || proposal.score !== v.score)) throw replaced();
    const changes: Changes = {};
    if (mine?.score !== v.score)
      changes[label] = {
        from: mine?.score ?? null,
        to: `${v.score}${proposal ? (proposal.score === v.score ? " (as the AI proposed)" : ` (the AI proposed ${proposal.score})`) : ""}`,
      };
    if ((mine?.comment ?? null) !== v.comment) changes[`${label}, comment`] = { from: mine?.comment ?? null, to: v.comment };
    if (!Object.keys(changes).length) return;
    const values = {
      score: v.score,
      comment: v.comment,
      suggestedScore: proposal?.score ?? null,
      suggestionId: proposal ? rfp.comparison!.id : null,
      updatedAt: new Date(),
      updatedBy: by.email,
    };
    await tx
      .insert(rfpScores)
      .values({ candidateId, criterionId, evaluatorUserId: by.id, createdBy: by.email, ...values })
      .onConflictDoUpdate({ target: [rfpScores.candidateId, rfpScores.criterionId, rfpScores.evaluatorUserId], set: values });
    if (rfp.stage === "issued") {
      await tx.update(rfps).set({ stage: "evaluating" }).where(eq(rfps.id, rfp.id));
      changes.Stage = { from: rfpStageLabels.issued, to: rfpStageLabels.evaluating };
    }
    return { ...changes, ...(await settleComparison(ctx, tx, rfp, by)) };
  });
}

/** Q-9: records the winner and the reasons. The winner becomes an active vendor; no agreement is made, and the others stay as they are. */
export async function decide(ctx: RfpContext, rfpId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = decisionSchema.parse(input);
  if (v.decidedOn > ctx.today()) failFields({ decidedOn: "The day of the decision cannot be in the future." });
  return change(ctx, rfpId, by, async (tx, rfp) => {
    evaluating(rfp);
    const winner = rfp.candidates.find((c) => c.id === v.winnerCandidateId);
    if (!winner || !inEvaluation(winner)) failFields({ winnerCandidateId: "Choose one of the shortlisted candidates the RFP was issued to." });
    const vendor = await getVendor(tx, winner!.vendorId, ctx.today());
    if (vendor.status === "offboarded") failFields({ winnerCandidateId: `${vendor.name} has been offboarded and cannot be made the winner.` });
    // The vendor's own history records that it became active, in this same transaction.
    if (vendor.status !== "active") await updateVendor(tx as unknown as Db, vendor.id, { status: "active" }, by, ctx.today());
    await tx.update(rfps).set({ stage: "decided", winnerCandidateId: winner!.id, decidedOn: v.decidedOn, rationale: v.rationale }).where(eq(rfps.id, rfpId));
    return {
      Stage: { from: rfpStageLabels[rfp.stage], to: rfpStageLabels.decided },
      Winner: { from: null, to: `${vendor.name}, decided on ${formatDay(v.decidedOn)}${vendor.status !== "active" ? "; the vendor is now active" : ""}` },
      Reasons: { from: null, to: v.rationale },
    };
  });
}

/** Stops an RFP that will not be decided. Its trail is kept. */
export async function cancelRfp(ctx: RfpContext, rfpId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = cancelSchema.parse(input);
  return change(ctx, rfpId, by, async (tx, rfp) => {
    if (!isOpen(rfp.stage)) throw closed();
    if (rfp.comparison?.status === "proposed") await reviewSuggestion(tx, rfp.comparison.id, "rejected", "system", ctx.now());
    if (rfp.draft?.status === "proposed") await reviewSuggestion(tx, rfp.draft.id, "rejected", "system", ctx.now());
    await tx.update(rfps).set({ stage: "cancelled", cancelReason: v.reason }).where(eq(rfps.id, rfpId));
    return { Stage: { from: rfpStageLabels[rfp.stage], to: rfpStageLabels.cancelled }, "Reason for cancelling": { from: null, to: v.reason } };
  });
}
