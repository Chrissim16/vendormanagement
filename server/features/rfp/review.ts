import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { rfpReviewerRemarks, rfpReviewFiles, rfpReviewRounds, rfpSections } from "../../../db/schema";
import { applySuggestedEdit, applyToHeading, remarkKindLabels, resolutionLabels, type ReviewerRemark } from "../../../shared/review";
import { normalise } from "../../../shared/richtext";
import { contentEditable, isOpen, type RfpDetail } from "../../../shared/rfp";
import type { User } from "../../../shared/types";
import { AppError, notFound } from "../../platform/errors";
import type { Tx } from "../../platform/ports/types";
import { rfpWord, REVIEW_PROPS, type WordContent } from "./files";
import { change, closed, locked, settleDraft, supersedeApprovals, type Changes, type RfpContext } from "./service";
import { templateWithId } from "./template";
import { openWord, readCustomProperties } from "./word/ooxml";
import { readRemarks, type RawRemark } from "./word/review";

/**
 * Q-13: review rounds. Downloading the review copy makes a round with the next version
 * number, unless nothing changed since the last one. A reviewer's returned copy is
 * uploaded to its round; the app reads its comments and tracked changes and places each
 * in the section it stands in. Each remark is then dealt with or set aside by a member.
 */

/** What a review copy is made from: the demand and the document as they stand. */
const snapshot = (r: RfpDetail): WordContent => ({
  title: r.title,
  need: r.need,
  budgetMinor: r.budgetMinor,
  currency: r.currency,
  sponsor: r.sponsor,
  demandApprovedOn: r.demandApprovedOn,
  targetDecisionDate: r.targetDecisionDate,
  ownerName: r.ownerName,
  writtenWeight: r.writtenWeight,
  demoWeight: r.demoWeight,
  sections: r.sections.map((s) => ({ id: s.id, heading: s.heading, body: s.body })),
  criteria: r.criteria.map((c) => ({ ...c })),
  questions: r.questions.map((q) => ({ ...q })),
});

/**
 * The words of a copy without the ids, and the template it is made from: the same text in
 * the same layout is the same version, whatever was saved in between.
 */
export function fingerprint(c: WordContent, templateId: string): string {
  const names = new Map(c.criteria.map((k) => [k.id, k.name]));
  const plain = {
    ...c,
    sections: c.sections.map((s) => [s.heading, normalise(s.body)]),
    criteria: c.criteria.map((k) => [k.name, k.weight, k.part]),
    questions: c.questions.map((q) => [q.number, q.text, names.get(q.criterionId)]),
  };
  return createHash("sha256").update(JSON.stringify({ plain, templateId })).digest("hex");
}

export const reviewCopyName = (title: string, version: number) => `${title} RFP review copy v${version}`;

/**
 * Q-13: the review copy to download. A round is made with the next version number when
 * the RFP changed since the last round; otherwise the last round's copy is given again.
 */
export async function makeRound(ctx: RfpContext, rfpId: string, by: User): Promise<{ rfp: RfpDetail; roundId: string; made: boolean }> {
  const template = await templateWithId(ctx.db, ctx.storage);
  let roundId = "";
  let made = false;
  let stored = false;
  const key = `review/${randomUUID()}.docx`;
  const rfp = await change(ctx, rfpId, by, async (tx, r) => {
    const content = snapshot(r);
    const print = fingerprint(content, template.id);
    const last = (await tx.select().from(rfpReviewRounds).where(eq(rfpReviewRounds.rfpId, rfpId)).orderBy(desc(rfpReviewRounds.version)).limit(1))[0];
    if (last && last.fingerprint === print) {
      roundId = last.id;
      return;
    }
    if (!isOpen(r.stage))
      throw new AppError(409, "rfp_closed", "This RFP is decided or cancelled, so no new review copy is made. The copies of earlier rounds can still be downloaded below.");
    const version = (last?.version ?? 0) + 1;
    const doc = await rfpWord(content, { template: template.data, today: ctx.today(), version, review: { rfpId } });
    await ctx.storage.put(key, doc, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    stored = true;
    const row = (
      await tx
        .insert(rfpReviewRounds)
        .values({ rfpId, version, content, fingerprint: print, fileName: reviewCopyName(r.title, version), storageKey: key, madeBy: by.email })
        .returning()
    )[0]!;
    roundId = row.id;
    made = true;
    return { "Review round": { from: last ? `version ${last.version}` : null, to: `version ${version}: review copy made` } };
  }).catch(async (e) => {
    // The file goes only when the round was not saved; a failure after saving leaves both.
    if (stored && !(await ctx.db.select({ id: rfpReviewRounds.id }).from(rfpReviewRounds).where(eq(rfpReviewRounds.storageKey, key))).length)
      await ctx.storage.remove(key).catch(() => undefined);
    throw e;
  });
  return { rfp, roundId, made };
}

export async function roundFile(ctx: RfpContext, roundId: string): Promise<{ name: string; data: Buffer }> {
  const row = (await ctx.db.select().from(rfpReviewRounds).where(eq(rfpReviewRounds.id, roundId)))[0];
  if (!row) throw notFound("That review round");
  return { name: row.fileName, data: await ctx.storage.get(row.storageKey) };
}
export async function returnedFile(ctx: RfpContext, fileId: string): Promise<{ name: string; data: Buffer }> {
  const row = (await ctx.db.select().from(rfpReviewFiles).where(eq(rfpReviewFiles.id, fileId)))[0];
  if (!row) throw notFound("That file");
  return { name: row.fileName.replace(/\.docx$/i, ""), data: await ctx.storage.get(row.storageKey) };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const reviewOver = () =>
  new AppError(
    409,
    "review_over",
    "Reviewers' remarks are worked on while the RFP is being drafted or is in review. This one has been approved; take it back to drafting first if the review has to be redone.",
  );
const notOurs = (why: string) => new AppError(400, "not_a_review_copy", why);

/** Which section of the round's copy a remark stands in, if it is still there. */
function placeOf(raw: RawRemark, content: WordContent, current: Set<string>): string | null {
  const same = content.sections.filter((s) => squash(s.heading) === raw.foundUnder);
  const s = same[raw.occurrence];
  return s && current.has(s.id) ? s.id : null;
}

/**
 * Q-13: a reviewer's returned copy, uploaded to a round. The file must be a review copy of
 * this RFP; one of another version is put in that version's round, and the answer says so.
 */
export async function uploadReturned(
  ctx: RfpContext,
  roundId: string,
  file: { name: string; data: Buffer },
  by: User,
): Promise<{ rfp: RfpDetail; version: number; otherVersion: boolean; read: { comments: number; edits: number; notPlaced: number; reviewers: string[] } }> {
  const target = (await ctx.db.select().from(rfpReviewRounds).where(eq(rfpReviewRounds.id, roundId)))[0];
  if (!target) throw notFound("That review round");
  if (!/\.docx$/i.test(file.name))
    throw new AppError(400, "wrong_file_type", "Upload the Word file the reviewer sent back, as .docx. A PDF or an old .doc file cannot be read for comments.");
  const zip = await openWord(file.data, (why) =>
    why === "macros"
      ? notOurs("That file contains macros, so it is not a review copy as the app made it. Ask the reviewer to save it as a Word Document (.docx).")
      : notOurs("That file could not be read as a Word document. Upload the .docx the reviewer sent back."),
  );
  const props = await readCustomProperties(zip);
  const rfpMark = props[REVIEW_PROPS.rfp];
  const version = Number(props[REVIEW_PROPS.version]);
  if (!rfpMark)
    throw notOurs(
      "That file is not a review copy made by the app: it does not carry the app's hidden mark. Upload the copy downloaded from this Review tab, as the reviewer sent it back. If the reviewer copied the text into a new file, their remarks have to be entered by hand.",
    );
  if (rfpMark !== target.rfpId) throw notOurs("That file is a review copy of another RFP. Upload it on that RFP's Review tab.");
  const round = (
    await ctx.db
      .select()
      .from(rfpReviewRounds)
      .where(and(eq(rfpReviewRounds.rfpId, target.rfpId), eq(rfpReviewRounds.version, version)))
  )[0];
  if (!round) throw notOurs(`That file says it is version ${props[REVIEW_PROPS.version] || "(none)"} of this RFP, which has no such review round.`);
  const sha256 = createHash("sha256").update(file.data).digest("hex");
  const raw = await readRemarks(zip);
  const content = round.content as WordContent;
  const key = `review/${randomUUID()}.docx`;
  let stored = false;
  let summary = { comments: 0, edits: 0, notPlaced: 0, reviewers: [] as string[] };
  const rfp = await change(ctx, target.rfpId, by, async (tx, r) => {
    if (!contentEditable(r.stage)) throw isOpen(r.stage) ? reviewOver() : closed();
    if (
      (
        await tx
          .select({ id: rfpReviewFiles.id })
          .from(rfpReviewFiles)
          .where(and(eq(rfpReviewFiles.roundId, round.id), eq(rfpReviewFiles.sha256, sha256)))
      ).length
    )
      throw new AppError(409, "already_uploaded", `That very file was already uploaded to version ${round.version}. Its remarks are listed below.`);
    await ctx.storage.put(key, file.data, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    stored = true;
    const row = (
      await tx.insert(rfpReviewFiles).values({ roundId: round.id, fileName: file.name, sizeBytes: file.data.length, storageKey: key, sha256, uploadedBy: by.email }).returning()
    )[0]!;
    const current = new Set(r.sections.map((s) => s.id));
    const values = raw.map((m) => ({
      fileId: row.id,
      rfpId: r.id,
      position: m.position,
      kind: m.kind,
      author: m.author,
      sectionId: placeOf(m, content, current),
      foundUnder: m.foundUnder,
      inHeading: m.inHeading,
      anchorText: m.anchorText,
      text: m.text,
      removedText: m.removedText,
      addedText: m.addedText,
      beforeText: m.beforeText,
      afterText: m.afterText,
    }));
    if (values.length) await tx.insert(rfpReviewerRemarks).values(values);
    summary = {
      comments: values.filter((v) => v.kind === "comment").length,
      edits: values.filter((v) => v.kind === "suggested_edit").length,
      notPlaced: values.filter((v) => !v.sectionId).length,
      reviewers: [...new Set(values.map((v) => v.author))],
    };
    return {
      [`returned review copy ${file.name}`]: {
        from: null,
        to: `uploaded to version ${round.version}: ${summary.comments} comments and ${summary.edits} suggested edits${summary.reviewers.length ? ` by ${summary.reviewers.join(", ")}` : ""}${summary.notPlaced ? `, ${summary.notPlaced} not placed` : ""}`,
      },
    };
  }).catch(async (e) => {
    if (stored && !(await ctx.db.select({ id: rfpReviewFiles.id }).from(rfpReviewFiles).where(eq(rfpReviewFiles.storageKey, key))).length)
      await ctx.storage.remove(key).catch(() => undefined);
    throw e;
  });
  return { rfp, version: round.version, otherVersion: round.id !== target.id, read: summary };
}

/** Removes a returned file uploaded by mistake, with its remarks, as long as nothing was done with them yet. */
export async function removeReturned(ctx: RfpContext, fileId: string, by: User): Promise<RfpDetail> {
  const row = (await ctx.db.select().from(rfpReviewFiles).where(eq(rfpReviewFiles.id, fileId)))[0];
  if (!row) throw notFound("That file");
  const round = (await ctx.db.select().from(rfpReviewRounds).where(eq(rfpReviewRounds.id, row.roundId)))[0]!;
  const rfp = await change(ctx, round.rfpId, by, async (tx, r) => {
    if (!contentEditable(r.stage)) throw isOpen(r.stage) ? reviewOver() : closed();
    const mine = r.review.remarks.filter((m) => m.fileId === fileId);
    if (mine.some((m) => m.status !== "open"))
      throw new AppError(
        409,
        "remarks_worked_on",
        "Some of this file's remarks have already been dealt with or set aside, so the file stays. Open them again first if it really has to go.",
      );
    await tx.delete(rfpReviewFiles).where(eq(rfpReviewFiles.id, fileId));
    return { [`returned review copy ${row.fileName}`]: { from: `version ${round.version}, ${mine.length} remarks`, to: "removed" } };
  });
  await ctx.storage.remove(row.storageKey).catch(() => undefined);
  return rfp;
}

export const remarkActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("take_over") }),
  z.object({ action: z.literal("by_hand") }),
  z.object({ action: z.literal("set_aside") }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("place"), sectionId: z.string().uuid("Choose the section it belongs to.") }),
]);

const remarkName = (m: Pick<ReviewerRemark, "kind" | "author" | "version">) => `${remarkKindLabels[m.kind].toLowerCase()} by ${m.author} (version ${m.version})`;

/** Marks remarks as dealt with in a transaction that changed the RFP. */
export async function resolveRemarks(tx: Tx, ids: string[], how: "taken_over" | "ai_rewrite" | "by_hand", by: User, at: Date) {
  if (ids.length)
    await tx.update(rfpReviewerRemarks).set({ status: "dealt_with", resolution: how, resolvedBy: by.email, resolvedAt: at }).where(inArray(rfpReviewerRemarks.id, ids));
}

/**
 * Q-13: what a member does with a remark: takes a suggested edit over into its section,
 * marks it as dealt with by hand, sets it aside, opens it again, or places one the app
 * could not place. Each is in the RFP's history.
 */
export async function actOnRemark(ctx: RfpContext, remarkId: string, input: unknown, by: User): Promise<RfpDetail> {
  const v = remarkActionSchema.parse(input);
  const row = (await ctx.db.select({ rfpId: rfpReviewerRemarks.rfpId }).from(rfpReviewerRemarks).where(eq(rfpReviewerRemarks.id, remarkId)))[0];
  if (!row) throw notFound("That remark");
  return change(ctx, row.rfpId, by, async (tx, r): Promise<Changes | void> => {
    const m = r.review.remarks.find((x) => x.id === remarkId);
    if (!m) throw notFound("That remark");
    if (!contentEditable(r.stage)) throw !isOpen(r.stage) ? closed() : r.stage === "approved" ? reviewOver() : locked(r.stage);
    const name = remarkName(m);
    if (v.action === "reopen") {
      if (m.status === "open") return;
      await tx.update(rfpReviewerRemarks).set({ status: "open", resolution: null, resolvedBy: null, resolvedAt: null }).where(eq(rfpReviewerRemarks.id, remarkId));
      return { [name]: { from: m.status === "set_aside" ? "set aside" : "dealt with", to: "open" } };
    }
    if (m.status !== "open")
      throw new AppError(
        409,
        "remark_closed",
        `This remark was already ${m.status === "set_aside" ? "set aside" : "dealt with"}${m.resolvedBy ? ` by ${m.resolvedBy}` : ""}. Open it again first.`,
      );
    if (v.action === "place") {
      const s = r.sections.find((x) => x.id === v.sectionId);
      if (!s) throw new AppError(400, "invalid", "That section is not in this RFP any more. Choose one from the list.", { sectionId: "Choose the section it belongs to." });
      if (m.sectionId === s.id) return;
      await tx.update(rfpReviewerRemarks).set({ sectionId: s.id }).where(eq(rfpReviewerRemarks.id, remarkId));
      return { [name]: { from: m.sectionId ? "placed" : "not placed", to: `placed in ${s.heading}` } };
    }
    if (v.action === "set_aside") {
      await tx.update(rfpReviewerRemarks).set({ status: "set_aside", resolution: null, resolvedBy: by.email, resolvedAt: ctx.now() }).where(eq(rfpReviewerRemarks.id, remarkId));
      return { [name]: { from: "open", to: "set aside" } };
    }
    if (v.action === "by_hand") {
      await resolveRemarks(tx, [remarkId], "by_hand", by, ctx.now());
      return { [name]: { from: "open", to: `dealt with ${resolutionLabels.by_hand}` } };
    }
    // Taking a suggested edit over changes the section, as a save of the document would.
    if (m.kind !== "suggested_edit")
      throw new AppError(409, "not_an_edit", "A comment has no edit to take over. Change the text, or ask the AI to, and mark the comment as dealt with.");
    const s = r.sections.find((x) => x.id === m.sectionId);
    if (!s) throw new AppError(409, "not_placed", "This suggested edit is not placed in a section. Place it first, or make the change by hand.");
    if (m.inHeading) {
      // An edit the reviewer made in the heading changes the heading.
      const h = applyToHeading(s.heading, m);
      if (!h.ok)
        throw new AppError(
          409,
          "edit_not_applicable",
          `The words this edit changes are no longer in the heading "${s.heading}" as it is now. Make the change by hand and mark it as dealt with.`,
        );
      if (r.sections.some((x) => x.id !== s.id && x.heading.toLowerCase() === h.heading.toLowerCase()))
        throw new AppError(409, "edit_not_applicable", `Another section is already called "${h.heading}". Make the change by hand and mark it as dealt with.`);
      await tx.update(rfpSections).set({ heading: h.heading }).where(eq(rfpSections.id, s.id));
      await resolveRemarks(tx, [remarkId], "taken_over", by, ctx.now());
      return {
        [`heading of section ${s.heading}`]: { from: s.heading, to: h.heading },
        [name]: { from: "open", to: `dealt with: ${resolutionLabels.taken_over}` },
        ...(await settleDraft(ctx, tx, r, by)),
        ...(await supersedeApprovals(tx, r)),
      };
    }
    const result = applySuggestedEdit(s.body, m);
    if (!result.ok)
      throw new AppError(
        409,
        "edit_not_applicable",
        result.why === "more_than_once"
          ? `The words this edit changes stand more than once in "${s.heading}", so the app cannot tell which to change. Make the change by hand and mark it as dealt with.`
          : `The words this edit changes are no longer in "${s.heading}" as it is now. Make the change by hand and mark it as dealt with.`,
      );
    await tx
      .update(rfpSections)
      .set({ body: result.body || null, bodyFormat: "markdown" })
      .where(eq(rfpSections.id, s.id));
    await resolveRemarks(tx, [remarkId], "taken_over", by, ctx.now());
    return {
      [`section ${s.heading}`]: { from: m.removedText || null, to: m.addedText || "(removed)" },
      [name]: { from: "open", to: `dealt with: ${resolutionLabels.taken_over}` },
      ...(await settleDraft(ctx, tx, r, by)),
      ...(await supersedeApprovals(tx, r)),
    };
  });
}
