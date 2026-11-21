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

/** One document attached to an agreement, with its text, for reading its contents (E-1). Undefined for a document of an RFP response. */
export const documentText = async (db: Queryable, id: string) =>
  (
    await db
      .select({
        id: documents.id,
        fileName: documents.fileName,
        agreementId: documents.agreementId,
        text: documents.extractedText,
        readingSuggestionId: documents.readingSuggestionId,
      })
      .from(documents)
      .where(and(eq(documents.id, id), isNotNull(documents.agreementId)))
  )[0];

/** Makes a suggestion the document's current reading (E-1). Recorded in the agreement's history by the caller. */
export const setReading = (tx: Queryable, documentId: string, suggestionId: string) =>
  tx.update(documents).set({ readingSuggestionId: suggestionId }).where(eq(documents.id, documentId));

/** Holds a document for the rest of the transaction, so that two things about it (two readings, a reading and its review) happen one after the other. */
export const lockDocument = (tx: Queryable, id: string) => tx.execute(sql`select 1 from documents where id = ${id} for update`);
