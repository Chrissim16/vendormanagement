import { eq } from "drizzle-orm";
import { rfpSections } from "../../../db/schema";
import { normalise, parseBlocks, TABLE_LIMITS } from "../../../shared/richtext";
import { contentEditable, isOpen, rewriteAskSchema, rewriteReviewSchema, type RfpDetail } from "../../../shared/rfp";
import type { User } from "../../../shared/types";
import { ask, recordSuggestion, replaced, reviewSuggestion } from "../../ai";
import { rfpSectionRewrite } from "../../ai/prompts/rfp-section-rewrite";
import { AppError, notFound } from "../../platform/errors";
import { resolveRemarks } from "./review";
import { change, closed, getRfp, locked, settleDraft, supersedeApprovals, textPrint, words, type Changes, type RfpContext } from "./service";

/**
 * Q-12: the AI rewrites one section when a member asks, in their own words or for
 * reviewers' remarks (Q-13). The rewrite is a suggestion next to the section; it changes
 * nothing until a member uses it, as it is or edited, or rejects it. It follows the locks
 * of editing.
 */

const cannot = (r: RfpDetail) => (!isOpen(r.stage) ? closed() : locked(r.stage));

async function sectionOf(ctx: RfpContext, sectionId: string) {
  const row = (await ctx.db.select({ rfpId: rfpSections.rfpId }).from(rfpSections).where(eq(rfpSections.id, sectionId)))[0];
  if (!row) throw notFound("That section");
  return row.rfpId;
}

export async function askRewrite(ctx: RfpContext, sectionId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = rewriteAskSchema.parse(input);
  const rfpId = await sectionOf(ctx, sectionId);
  const before = await getRfp(ctx.db, rfpId, ctx.today());
  const pick = (r: RfpDetail) => {
    if (!contentEditable(r.stage)) throw cannot(r);
    const s = r.sections.find((x) => x.id === sectionId);
    if (!s) throw notFound("That section");
    const remarks = v.remarkIds.map((id) => r.review.remarks.find((m) => m.id === id));
    if (remarks.some((m) => !m || m.sectionId !== sectionId || m.status !== "open"))
      throw new AppError(409, "remark_not_open", "One of the chosen remarks is no longer open in this section. Look at the page again and choose again.");
    return { s, remarks: remarks.map((m) => m!) };
  };
  const { s, remarks } = pick(before);
  if (!s.body)
    throw new AppError(
      409,
      "section_empty",
      "This section has no text yet, so there is nothing to rewrite. Write a first version, or ask the AI for a draft of the whole RFP while drafting.",
    );
  // The budget and the sponsor are not passed on: the document goes to vendors.
  const { output, model } = await ask(
    ctx.ai,
    rfpSectionRewrite,
    {
      title: before.title,
      heading: s.heading,
      body: s.body,
      instruction: v.instruction,
      remarks: remarks.map((m) => ({ reviewer: m.author, comment: m.text, onWords: m.anchorText, removes: m.removedText, adds: m.addedText })),
    },
    "rewrite this section",
  );
  return change(ctx, rfpId, by, async (tx, r) => {
    const now = pick(r).s;
    if (normalise(now.body) !== normalise(s.body))
      throw new AppError(409, "section_changed", "The section was changed while the AI was writing, so its rewrite would be of an older text. Nothing was changed. Ask again.");
    if (now.rewrite?.status === "proposed") await reviewSuggestion(tx, now.rewrite.id, "rejected", "system", ctx.now());
    const suggestion = await recordSuggestion(tx, {
      prompt: rfpSectionRewrite,
      subjectType: "rfp_section",
      subjectId: sectionId,
      model,
      inputSummary: `${s.heading}: the text${v.instruction ? ", an instruction" : ""}${remarks.length ? `, ${remarks.length} reviewers' remarks` : ""}`,
      output,
      at: ctx.now(),
    });
    await tx
      .update(rfpSections)
      .set({ rewriteSuggestionId: suggestion.id, rewriteFor: { remarkIds: remarks.map((m) => m.id), basedOn: textPrint(s.body), instruction: v.instruction } })
      .where(eq(rfpSections.id, sectionId));
    return {
      [`AI rewrite of ${s.heading}`]: {
        from: now.rewrite ? words(now.rewrite.status) : null,
        to: `written by the AI${v.instruction ? ` for "${v.instruction.slice(0, 120)}"` : ""}${remarks.length ? ` for ${remarks.length === 1 ? "a remark" : `${remarks.length} remarks`} by ${[...new Set(remarks.map((m) => m.author))].join(", ")}` : ""}`,
      },
    };
  });
}

/** Uses the rewrite as it is, uses it as the member edited it, or rejects it. Using it deals with the remarks it was asked for. */
export async function reviewRewrite(ctx: RfpContext, sectionId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = rewriteReviewSchema.parse(input);
  const rfpId = await sectionOf(ctx, sectionId);
  return change(ctx, rfpId, by, async (tx, r): Promise<Changes | void> => {
    const s = r.sections.find((x) => x.id === sectionId);
    if (!s) throw notFound("That section");
    const rw = s.rewrite;
    if (!rw) throw new AppError(409, "no_suggestion", "There is no AI rewrite of this section. Ask for one first.");
    if (rw.id !== v.suggestionId) throw replaced();
    if (!contentEditable(r.stage)) throw cannot(r);
    if (rw.status !== "proposed") return;
    if (v.action === "reject") {
      await reviewSuggestion(tx, rw.id, "rejected", by.email, ctx.now());
      return { [`AI rewrite of ${s.heading}`]: { from: words("proposed"), to: words("rejected") } };
    }
    if (rw.outdated)
      throw new AppError(409, "rewrite_outdated", "The section was changed after the AI rewrote it, so using the rewrite would undo that change. Reject it, or ask the AI again.");
    const body = normalise(v.body ?? rw.output.body);
    if (!body) throw new AppError(400, "invalid", "The rewrite has no text left. Write something, or reject it.", { body: "Write the text of the section." });
    // The rules of a saved section hold for a rewrite too.
    if (parseBlocks(body).some((b) => b.kind === "table" && (b.rows.length > TABLE_LIMITS.rows || (b.rows[0]?.length ?? 0) > TABLE_LIMITS.columns)))
      throw new AppError(400, "invalid", `A table has at most ${TABLE_LIMITS.rows} rows and ${TABLE_LIMITS.columns} columns. Make it smaller before using the text.`, {
        body: `A table has at most ${TABLE_LIMITS.rows} rows and ${TABLE_LIMITS.columns} columns.`,
      });
    if (body.length > 20_000) throw new AppError(400, "invalid", "The text is longer than a section may be (20,000 characters).", { body: "At most 20,000 characters." });
    const status = body === normalise(rw.output.body) ? "accepted" : "edited";
    await tx.update(rfpSections).set({ body, bodyFormat: "markdown" }).where(eq(rfpSections.id, sectionId));
    await reviewSuggestion(tx, rw.id, status, by.email, ctx.now());
    const open = r.review.remarks.filter((m) => rw.remarkIds.includes(m.id) && m.status === "open");
    await resolveRemarks(
      tx,
      open.map((m) => m.id),
      "ai_rewrite",
      by,
      ctx.now(),
    );
    // The remarks it answered are dealt with; their history says so.
    const remarkChanges: Changes = Object.fromEntries(
      open.map((m) => [`${m.kind === "comment" ? "comment" : "suggested edit"} by ${m.author} (version ${m.version})`, { from: "open", to: "dealt with: rewritten with the AI" }]),
    );
    return {
      [`section ${s.heading}`]: { from: "as it was", to: `the AI's rewrite${status === "edited" ? ", edited" : ""}` },
      [`AI rewrite of ${s.heading}`]: { from: words("proposed"), to: words(status) },
      ...remarkChanges,
      ...(await settleDraft(ctx, tx, r, by)),
      ...(await supersedeApprovals(tx, r)),
    };
  });
}
