import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { agreements, documents, rfpCandidates, rfps, vendors } from "../../../db/schema";
import type { Queryable, StoragePort } from "../../platform/ports/types";
import { extractText } from "../../platform/text";

/**
 * Every document whose text has been read, with where it is attached: to an agreement, or
 * to what a candidate sent for an RFP. For answering questions about what a document says (C-1).
 */
export async function documentsWithText(db: Queryable, vendorId?: string) {
  const candidateVendor = sql<string | null>`(select v.name from vendors v where v.id = ${rfpCandidates.vendorId})`;
  return db
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
}

/**
 * Reads the text of documents attached before the app could read them. Safe to run twice:
 * a document that has been read, also when it held no words, is not read again. The text
 * is worked out from the file and changes nothing a person entered, so no history entry is written.
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
