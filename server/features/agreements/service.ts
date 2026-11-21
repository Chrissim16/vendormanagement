import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  agreementSchema,
  checkAgreement,
  decisionSchema,
  documentTypes,
  kindLabels,
  MAX_DOCUMENT_BYTES,
  nextTermEnd,
  noticeDeadline,
  pricingLabels,
  renewalState,
  statusLabels,
  type Agreement,
  type AgreementDetail,
  type AgreementInput,
  type DocumentInfo,
} from "../../../shared/agreements";
import { daysBetween, type Day } from "../../../shared/dates";
import type { Page, User } from "../../../shared/types";
import { diff } from "../../../shared/users";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import { extractText } from "../../platform/text";
import { failFields, toCsv } from "../../platform/http";
import { explain } from "../../platform/ports/explain";
import type { Db, Queryable, StoragePort, Tx } from "../../platform/ports/types";
import { getSettings } from "../settings/service";
import { checkSowEdit, invoicedByAgreement } from "../sow/service";
import * as repo from "./repo";

type Row = NonNullable<Awaited<ReturnType<typeof repo.getAgreement>>>;

function toAgreement({ agreement: a, vendorName, ownerName, decisionId }: Row, today: Day, noticeDays: number): Agreement {
  const { createdBy: _c, updatedBy: _u, updatedAt: _t, createdAt, ...fields } = a;
  return {
    ...fields,
    vendorName,
    ownerName,
    createdAt: createdAt.toISOString(),
    noticeDeadline: noticeDeadline(a),
    renewalState: renewalState(a, today, decisionId !== null, noticeDays),
    decidedForTerm: decisionId !== null,
  };
}

export async function listAgreements(db: Db, filter: repo.AgreementFilter, today: Day): Promise<Page<Agreement>> {
  const settings = await getSettings(db);
  const { items, total } = await repo.listAgreements(db, filter, settings.gbpToEurE4);
  return { items: items.map((r) => toAgreement(r, today, settings.noticeDays)), total };
}

const toDocument = (d: Awaited<ReturnType<typeof repo.documentsOf>>[number]): DocumentInfo => ({
  id: d.id,
  title: d.title,
  fileName: d.fileName,
  contentType: d.contentType,
  sizeBytes: d.sizeBytes,
  createdAt: d.createdAt.toISOString(),
  createdBy: d.createdBy,
  readable: d.readable,
});

export async function getAgreement(db: Queryable, id: string, today: Day): Promise<AgreementDetail> {
  const row = await repo.getAgreement(db, id);
  if (!row) throw notFound("That agreement");
  const a = row.agreement;
  const [settings, invoiced, parent, children, documents, decisions] = await Promise.all([
    getSettings(db),
    invoicedByAgreement(db, [id]),
    a.parentMsaId ? repo.getParent(db, a.parentMsaId) : undefined,
    a.kind === "msa" ? repo.childrenOf(db, id) : [],
    repo.documentsOf(db, id),
    repo.decisionsOf(db, id),
  ]);
  return {
    ...toAgreement(row, today, settings.noticeDays),
    invoicedMinor: invoiced.get(id) ?? 0,
    parent: parent ? { id: parent.id, title: parent.title } : null,
    children,
    documents: documents.map(toDocument),
    decisions: decisions.map((d) => ({ id: d.id, decision: d.decision, decidedOn: d.decidedOn, decidedBy: d.decidedBy, notes: d.notes, termEndDate: d.termEndDate })),
  };
}

/** Checks that touch other records: the vendor, the owner and the parent MSA. */
async function checkLinks(tx: Tx, a: AgreementInput, changed: { owner: boolean; parent: boolean }) {
  if (changed.owner && !(await repo.activeUser(tx, a.ownerUserId))) failFields({ ownerUserId: "Choose an owner who has access to the app." });
  if (changed.parent && a.parentMsaId) {
    const parent = await repo.getParent(tx, a.parentMsaId);
    if (!parent || parent.kind !== "msa" || parent.vendorId !== a.vendorId) failFields({ parentMsaId: "Choose an MSA of the same vendor." });
  }
}

export async function createAgreement(db: Db, input: unknown, by: User, today: Day, action: "create" | "import" = "create"): Promise<AgreementDetail> {
  const { errors, value } = checkAgreement(agreementSchema.parse(input));
  if (Object.keys(errors).length) failFields(errors);
  return db.transaction(async (tx) => {
    // Lock the vendor so it cannot be offboarded while this agreement is being added.
    await tx.execute(sql`select 1 from vendors where id = ${value.vendorId} for update`);
    const vendor = await repo.getVendorBrief(tx, value.vendorId);
    if (!vendor) failFields({ vendorId: "Choose a vendor." });
    if (vendor.status === "offboarded") failFields({ vendorId: "This vendor is offboarded and cannot receive new agreements." });
    await checkLinks(tx, value, { owner: true, parent: true });
    const row = await repo.insertAgreement(tx, value, by.email);
    await audit(tx, { userEmail: by.email, action, entityType: "agreement", entityId: row.id, summary: `${vendor.name} · ${row.title}` });
    return getAgreement(tx, row.id, today);
  });
}

export async function updateAgreement(db: Db, id: string, input: unknown, by: User, today: Day): Promise<AgreementDetail> {
  const body = (input ?? {}) as Record<string, unknown>;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from agreements where id = ${id} for update`);
    const row = await repo.getAgreement(tx, id);
    if (!row) throw notFound("That agreement");
    const current = row.agreement;
    for (const fixed of ["vendorId", "kind"] as const) {
      if (fixed in body && body[fixed] !== current[fixed]) failFields({ [fixed]: "This cannot be changed once the agreement exists. Add a new agreement instead." });
    }
    const { errors, value } = checkAgreement(agreementSchema.parse({ ...current, ...body }));
    if (value.status === "active" && current.status !== "active") {
      // Same lock as offboarding takes, so the two cannot both go through.
      await tx.execute(sql`select 1 from vendors where id = ${current.vendorId} for update`);
      const vendor = await repo.getVendorBrief(tx, current.vendorId);
      if (vendor?.status === "offboarded") failFields({ status: "This vendor is offboarded, so its agreements cannot be made active." });
    }
    if (Object.keys(errors).length) failFields(errors);
    if (value.kind === "sow") {
      const sowErrors = await checkSowEdit(tx, id, current, value);
      if (Object.keys(sowErrors).length) failFields(sowErrors);
    }
    // Invoices are in the agreement's currency; changing it would silently relabel what was paid.
    if (value.currency !== current.currency && (await invoicedByAgreement(tx, [id])).has(id))
      failFields({ currency: `This agreement already has invoices in ${current.currency}. Remove them before changing the currency.` });
    await checkLinks(tx, value, { owner: value.ownerUserId !== current.ownerUserId, parent: value.parentMsaId !== current.parentMsaId });
    if (value.parentMsaId === id) failFields({ parentMsaId: "An agreement cannot sit under itself." });
    const { vendorId: _v, ...fields } = value;
    const changes = diff(current as unknown as Record<string, unknown>, fields);
    if (Object.keys(changes).length) {
      await repo.updateAgreement(tx, id, fields, by.email);
      await audit(tx, { userEmail: by.email, action: "update", entityType: "agreement", entityId: id, summary: `${row.vendorName} · ${value.title}`, changes });
    }
    return getAgreement(tx, id, today);
  });
}

/** Records what was decided for the current term of a subscription (A-6). */
export async function recordDecision(db: Db, id: string, input: unknown, by: User, today: Day): Promise<AgreementDetail> {
  const d = decisionSchema.parse(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select 1 from agreements where id = ${id} for update`);
    const row = await repo.getAgreement(tx, id);
    if (!row) throw notFound("That agreement");
    const a = row.agreement;
    if (a.kind !== "subscription" || a.status !== "active" || !a.endDate)
      throw new AppError(409, "not_renewable", "A renewal decision can only be recorded for an active subscription.");
    if (row.decisionId) throw new AppError(409, "already_decided", "A decision has already been recorded for this term.");
    if (d.decidedOn > today) failFields({ decidedOn: "The decision date cannot be in the future." });
    await repo.insertDecision(tx, { agreementId: id, decision: d.decision, decidedOn: d.decidedOn, decidedBy: by.email, notes: d.notes, termEndDate: a.endDate });
    const changes: Record<string, { from: unknown; to: unknown }> = { [`renewal decision for the term ending ${a.endDate}`]: { from: null, to: d.decision } };
    if (d.decision === "renew" && d.rollForward) {
      const endDate = nextTermEnd(a.endDate, a.renewalTermMonths);
      await repo.updateAgreement(tx, id, { endDate }, by.email);
      changes.endDate = { from: a.endDate, to: endDate };
    }
    await audit(tx, { userEmail: by.email, action: "update", entityType: "agreement", entityId: id, summary: `${row.vendorName} · ${a.title}`, changes });
    return getAgreement(tx, id, today);
  });
}

/** Active subscriptions whose notice deadline has passed or falls within the window, soonest first (A-6). */
export async function listRenewals(db: Db, window: number | undefined, owner: string | undefined, today: Day): Promise<Agreement[]> {
  // Without a window, the admin's own notice window applies, so this page and the warnings agree.
  const windowDays = window ?? (await getSettings(db)).noticeDays;
  const rows = await repo.activeSubscriptions(db, owner);
  return rows
    .filter((r) => r.decisionId === null && r.agreement.endDate)
    .map((r) => ({ ...toAgreement(r, today, windowDays), renewalState: renewalState(r.agreement, today, false, windowDays) }))
    .filter((a) => a.renewalState === "overdue" || a.renewalState === "due_soon")
    .sort((a, b) => daysBetween(b.noticeDeadline!, a.noticeDeadline!) || a.title.localeCompare(b.title));
}

const EXPORT_LIMIT = 5000;

export async function exportCsv(db: Db, filter: Omit<repo.AgreementFilter, "page" | "pageSize">, today: Day): Promise<string> {
  const settings = await getSettings(db);
  const { items, total } = await repo.listAgreements(db, { ...filter, page: 1, pageSize: EXPORT_LIMIT }, settings.gbpToEurE4);
  if (total > EXPORT_LIMIT) throw new AppError(400, "too_many", `There are ${total} agreements to export, more than fits in one file. Narrow the filters first.`);
  const money = (minor: number | null) => (minor == null ? "" : (minor / 100).toFixed(2));
  return toCsv(
    [
      "Vendor",
      "Kind",
      "Title",
      "Reference",
      "Status",
      "Owner",
      "Signed on",
      "Start date",
      "End date",
      "Notice deadline",
      "Currency",
      "Budget",
      "Annual value",
      "Pricing",
      "Auto renews",
    ],
    items.map((r) => {
      const a = toAgreement(r, today, settings.noticeDays);
      return [
        a.vendorName,
        kindLabels[a.kind],
        a.title,
        a.reference,
        statusLabels[a.status],
        a.ownerName,
        a.signedOn,
        a.startDate,
        a.endDate,
        a.noticeDeadline,
        a.currency,
        money(a.budgetMinor),
        money(a.annualValueMinor),
        a.pricing ? pricingLabels[a.pricing] : "",
        a.autoRenews == null ? "" : a.autoRenews ? "yes" : "no",
      ];
    }),
  );
}

const signatures: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  docx: [[0x50, 0x4b, 0x03, 0x04]],
  xlsx: [[0x50, 0x4b, 0x03, 0x04]],
  doc: [[0xd0, 0xcf, 0x11, 0xe0]],
  xls: [[0xd0, 0xcf, 0x11, 0xe0]],
};

/** Office files are ZIP archives; a real one names its parts inside. Old .doc and .xls files are OLE containers. */
const inside: Record<string, string[]> = { docx: ["[Content_Types].xml", "word/"], xlsx: ["[Content_Types].xml", "xl/"] };

/** Accepts PDF, Word and Excel up to 25 MB, judged by the file's content as well as its name (A-5). */
export function checkDocument(fileName: string, data: Buffer): { ext: string; contentType: string } {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  const contentType = documentTypes[ext];
  if (!contentType) throw new AppError(400, "file_type", "Only PDF, Word and Excel files can be attached.");
  if (data.length === 0) throw new AppError(400, "file_empty", "That file is empty.");
  if (data.length > MAX_DOCUMENT_BYTES) throw new AppError(413, "file_too_large", "That file is larger than 25 MB.");
  const genuine = signatures[ext]!.some((sig) => sig.every((b, i) => data[i] === b)) && (inside[ext] ?? []).every((part) => data.includes(part));
  if (!genuine) throw new AppError(400, "file_type", `That file is not a real ${ext.toUpperCase()} file.`);
  return { ext, contentType };
}

/**
 * A file name safe to show and store: no control characters, no path characters, and none
 * of the invisible characters that can make a name display as something it is not.
 */
export function cleanFileName(name: string): string {
  const bad = (c: number) => c < 32 || (c >= 127 && c <= 159) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff;
  const cleaned = [...name.normalize("NFC")]
    .filter((ch) => !bad(ch.codePointAt(0)!) && ch !== "/" && ch !== "\\")
    .join("")
    .trim()
    .slice(0, 200);
  return cleaned || "document";
}

/** A storage failure, said in plain words. Not-found and other deliberate errors pass through. */
function storageFailed(what: string) {
  return (e: unknown): never => {
    if (e instanceof AppError) throw e;
    console.error(`Document storage failed (${what}):`, (e as Error).message);
    throw new AppError(502, "storage_failed", `The document could not be ${what}. ${explain(e).cause}`);
  };
}

export async function addDocument(db: Db, storage: StoragePort, agreementId: string, file: { name: string; data: Buffer }, by: User): Promise<DocumentInfo> {
  const fileName = cleanFileName(file.name);
  const { ext, contentType } = checkDocument(fileName, file.data);
  const row = await repo.getAgreement(db, agreementId);
  if (!row) throw notFound("That agreement");
  // The stored name is generated, so nothing a person typed ever becomes part of a file path.
  const storageKey = `agreements/${agreementId}/${randomUUID()}.${ext}`;
  // The words in the file are read now, so that questions about it can be answered later (C-1). A file without readable text is attached all the same.
  const extractedText = await extractText(ext, file.data);
  await storage.put(storageKey, file.data, contentType).catch(storageFailed("stored"));
  try {
    return await db.transaction(async (tx) => {
      const doc = await repo.insertDocument(tx, {
        agreementId,
        title: fileName,
        fileName,
        contentType,
        sizeBytes: file.data.length,
        storageKey,
        extractedText,
        createdBy: by.email,
      });
      await audit(tx, {
        userEmail: by.email,
        action: "update",
        entityType: "agreement",
        entityId: agreementId,
        summary: `${row.vendorName} · ${row.agreement.title}`,
        changes: { [`document ${fileName}`]: { from: null, to: "attached" } },
      });
      return toDocument(doc);
    });
  } catch (e) {
    await storage.remove(storageKey).catch(() => undefined);
    throw e;
  }
}

export async function readDocument(db: Db, storage: StoragePort, id: string) {
  const doc = await repo.getDocument(db, id);
  if (!doc) throw notFound("That document");
  return { doc, data: await storage.get(doc.storageKey).catch(storageFailed("fetched")) };
}

export async function removeDocument(db: Db, storage: StoragePort, id: string, by: User): Promise<void> {
  const key = await db.transaction(async (tx) => {
    const doc = await repo.getDocument(tx, id);
    // A document of an RFP response is removed from the RFP, where its own history is kept.
    if (!doc?.agreementId) throw notFound("That document");
    const row = await repo.getAgreement(tx, doc.agreementId);
    await repo.deleteDocument(tx, id);
    await audit(tx, {
      userEmail: by.email,
      action: "update",
      entityType: "agreement",
      entityId: doc.agreementId,
      summary: row ? `${row.vendorName} · ${row.agreement.title}` : undefined,
      changes: { [`document ${doc.fileName}`]: { from: "attached", to: "removed" } },
    });
    return doc.storageKey;
  });
  // The record is gone; a file that cannot be removed right now is only wasted space.
  await storage.remove(key).catch((e) => console.error("Could not remove a stored file:", (e as Error).message));
}

/** For other features: an agreement of this vendor with the same kind and title, if there is one. */
export const findSameAgreement = repo.findSame;

export { documentsWithText, readMissingText } from "./documents";
