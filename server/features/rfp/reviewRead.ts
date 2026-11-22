import { asc, desc, eq, inArray } from "drizzle-orm";
import { rfpReviewerRemarks, rfpReviewFiles, rfpReviewRounds } from "../../../db/schema";
import type { ReviewerRemark, ReviewRound } from "../../../shared/review";
import type { Queryable } from "../../platform/ports/types";

/** The rounds of an RFP with their returned files, and every remark read from them, for the RFP's page. */
export async function reviewOf(db: Queryable, rfpId: string): Promise<{ rounds: ReviewRound[]; remarks: ReviewerRemark[] }> {
  const rounds = await db.select().from(rfpReviewRounds).where(eq(rfpReviewRounds.rfpId, rfpId)).orderBy(desc(rfpReviewRounds.version));
  if (!rounds.length) return { rounds: [], remarks: [] };
  const files = await db
    .select()
    .from(rfpReviewFiles)
    .where(
      inArray(
        rfpReviewFiles.roundId,
        rounds.map((r) => r.id),
      ),
    )
    .orderBy(asc(rfpReviewFiles.uploadedAt));
  const remarks = await db.select().from(rfpReviewerRemarks).where(eq(rfpReviewerRemarks.rfpId, rfpId)).orderBy(asc(rfpReviewerRemarks.position));
  const versionOf = new Map(files.map((f) => [f.id, rounds.find((r) => r.id === f.roundId)!.version]));
  const fileOrder = new Map(files.map((f, i) => [f.id, i]));
  return {
    rounds: rounds.map((r) => ({
      id: r.id,
      version: r.version,
      madeAt: r.madeAt.toISOString(),
      madeBy: r.madeBy,
      fileName: r.fileName,
      files: files
        .filter((f) => f.roundId === r.id)
        .map((f) => ({ id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes, uploadedAt: f.uploadedAt.toISOString(), uploadedBy: f.uploadedBy })),
    })),
    remarks: remarks
      .sort((a, b) => (versionOf.get(a.fileId) ?? 0) - (versionOf.get(b.fileId) ?? 0) || fileOrder.get(a.fileId)! - fileOrder.get(b.fileId)! || a.position - b.position)
      .map((m) => ({
        id: m.id,
        fileId: m.fileId,
        version: versionOf.get(m.fileId) ?? 0,
        kind: m.kind,
        author: m.author,
        sectionId: m.sectionId,
        foundUnder: m.foundUnder,
        inHeading: m.inHeading,
        anchorText: m.anchorText,
        text: m.text,
        removedText: m.removedText,
        addedText: m.addedText,
        beforeText: m.beforeText,
        afterText: m.afterText,
        status: m.status,
        resolution: m.resolution,
        resolvedBy: m.resolvedBy,
        resolvedAt: m.resolvedAt?.toISOString() ?? null,
      })),
  };
}
