import { aliasedTable, and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { agreements, documents, renewalDecisions, users, vendors } from "../../../db/schema";
import type { AgreementInput, AgreementStatus, Kind } from "../../../shared/agreements";
import type { Day } from "../../../shared/dates";
import { like } from "../../platform/http";
import type { Queryable } from "../../platform/ports/types";
import { inEuros } from "../settings/service";

const ownerName = sql<string>`coalesce(${users.displayName}, ${users.email})`;
/** Value or budget in euros, so sorting compares amounts in different currencies fairly. */
const valueInEur = () => inEuros(sql`coalesce(${agreements.budgetMinor}, ${agreements.annualValueMinor})`, agreements.currency);
const sorts = {
  title: sql`lower(${agreements.title})`,
  vendor: sql`lower(${vendors.name})`,
  kind: agreements.kind,
  status: agreements.status,
  endDate: agreements.endDate,
  owner: sql`lower(${ownerName})`,
  value: agreements.budgetMinor,
};
export type AgreementSort = keyof typeof sorts;
export const agreementSorts = Object.keys(sorts) as AgreementSort[];

export interface AgreementFilter {
  q?: string;
  kind?: Kind;
  vendorId?: string;
  status?: AgreementStatus;
  owner?: string;
  /** The end or renewal date falls on or after this day, and on or before the next. An agreement without an end date matches neither. */
  endsFrom?: Day;
  endsTo?: Day;
  sort: AgreementSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/** An agreement with its vendor, owner, and whether a renewal decision exists for the current term. */
const columns = { agreement: agreements, vendorName: vendors.name, ownerName, decisionId: renewalDecisions.id };
const base = (db: Queryable) =>
  db
    .select(columns)
    .from(agreements)
    .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
    .innerJoin(users, eq(users.id, agreements.ownerUserId))
    .leftJoin(renewalDecisions, and(eq(renewalDecisions.agreementId, agreements.id), eq(renewalDecisions.termEndDate, agreements.endDate)));

function conditions(f: Omit<AgreementFilter, "sort" | "dir" | "page" | "pageSize">) {
  const where: SQL[] = [];
  if (f.q) where.push(or(ilike(agreements.title, like(f.q)), ilike(agreements.reference, like(f.q)), ilike(vendors.name, like(f.q)))!);
  if (f.kind) where.push(eq(agreements.kind, f.kind));
  if (f.vendorId) where.push(eq(agreements.vendorId, f.vendorId));
  if (f.status) where.push(eq(agreements.status, f.status));
  if (f.owner) where.push(eq(agreements.ownerUserId, f.owner));
  if (f.endsFrom) where.push(gte(agreements.endDate, f.endsFrom));
  if (f.endsTo) where.push(lte(agreements.endDate, f.endsTo));
  return where.length ? and(...where) : undefined;
}

export async function listAgreements(db: Queryable, f: AgreementFilter) {
  const cond = conditions(f);
  const col = f.sort === "value" ? valueInEur() : sorts[f.sort];
  const order = f.dir === "asc" ? sql`${col} asc nulls last` : sql`${col} desc nulls last`;
  const [items, total] = await Promise.all([
    base(db)
      .where(cond)
      .orderBy(order, asc(agreements.title), asc(agreements.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(agreements)
      .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
      .where(cond),
  ]);
  return { items, total: total[0]?.n ?? 0 };
}

export const getAgreement = async (db: Queryable, id: string) => (await base(db).where(eq(agreements.id, id)))[0];
export const activeSubscriptions = (db: Queryable, owner?: string) =>
  base(db).where(and(eq(agreements.kind, "subscription"), eq(agreements.status, "active"), owner ? eq(agreements.ownerUserId, owner) : undefined));

const parents = aliasedTable(agreements, "parent");
export const getParent = async (db: Queryable, id: string) =>
  (await db.select({ id: parents.id, title: parents.title, kind: parents.kind, vendorId: parents.vendorId }).from(parents).where(eq(parents.id, id)))[0];
export const childrenOf = (db: Queryable, id: string) =>
  db
    .select({
      id: agreements.id,
      title: agreements.title,
      status: agreements.status,
      endDate: agreements.endDate,
      budgetMinor: agreements.budgetMinor,
      currency: agreements.currency,
    })
    .from(agreements)
    .where(eq(agreements.parentMsaId, id))
    .orderBy(asc(agreements.startDate), asc(agreements.title));

type Fields = Omit<AgreementInput, "vendorId">;
export const insertAgreement = async (db: Queryable, a: AgreementInput, by: string) =>
  (
    await db
      .insert(agreements)
      .values({ ...a, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateAgreement = async (db: Queryable, id: string, a: Partial<Fields>, by: string) =>
  (
    await db
      .update(agreements)
      .set({ ...a, updatedAt: new Date(), updatedBy: by })
      .where(eq(agreements.id, id))
      .returning()
  )[0]!;
export const findSame = async (db: Queryable, vendorId: string, kind: Kind, title: string) =>
  (
    await db
      .select({ id: agreements.id })
      .from(agreements)
      .where(and(eq(agreements.vendorId, vendorId), eq(agreements.kind, kind), sql`lower(${agreements.title}) = lower(${title})`))
  )[0];

export const decisionsOf = (db: Queryable, agreementId: string) =>
  db.select().from(renewalDecisions).where(eq(renewalDecisions.agreementId, agreementId)).orderBy(desc(renewalDecisions.termEndDate));
export const insertDecision = async (db: Queryable, d: typeof renewalDecisions.$inferInsert) => (await db.insert(renewalDecisions).values(d).returning())[0]!;

/** A document as lists show it: everything but its text, which can be long, and whether that text could be read (null while it has not been tried). */
const documentColumns = {
  id: documents.id,
  title: documents.title,
  fileName: documents.fileName,
  contentType: documents.contentType,
  sizeBytes: documents.sizeBytes,
  createdAt: documents.createdAt,
  createdBy: documents.createdBy,
  readable: sql<boolean | null>`case when ${documents.extractedText} is null then null else ${documents.extractedText} <> '' end`,
};
export const documentsOf = (db: Queryable, agreementId: string) =>
  db.select(documentColumns).from(documents).where(eq(documents.agreementId, agreementId)).orderBy(desc(documents.createdAt));
/** One document without its text. */
export const getDocument = async (db: Queryable, id: string) =>
  (
    await db
      .select({
        ...documentColumns,
        agreementId: documents.agreementId,
        rfpCandidateId: documents.rfpCandidateId,
        storageKey: documents.storageKey,
        readingSuggestionId: documents.readingSuggestionId,
      })
      .from(documents)
      .where(eq(documents.id, id))
  )[0];
export const insertDocument = async (db: Queryable, d: typeof documents.$inferInsert) => (await db.insert(documents).values(d).returning(documentColumns))[0]!;
export const deleteDocument = (db: Queryable, id: string) => db.delete(documents).where(eq(documents.id, id));

export const getVendorBrief = async (db: Queryable, id: string) =>
  (await db.select({ id: vendors.id, name: vendors.name, status: vendors.status }).from(vendors).where(eq(vendors.id, id)))[0];
/** An owner who has access. Shares a lock on them, so a switch-off running at the same time waits for this save, or this save sees it (F-6). */
export const activeUser = async (db: Queryable, id: string) =>
  (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), eq(users.active, true)))
      .for("share")
  )[0];

/** Active subscriptions of vendors that are not offboarded, for the renewal calendar (A-9). */
export const calendarSubscriptions = (db: Queryable) =>
  db
    .select({
      id: agreements.id,
      vendorId: agreements.vendorId,
      vendorName: vendors.name,
      title: agreements.title,
      endDate: agreements.endDate,
      noticePeriodDays: agreements.noticePeriodDays,
      decisionId: renewalDecisions.id,
    })
    .from(agreements)
    .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
    .leftJoin(renewalDecisions, and(eq(renewalDecisions.agreementId, agreements.id), eq(renewalDecisions.termEndDate, agreements.endDate)))
    .where(and(eq(agreements.kind, "subscription"), eq(agreements.status, "active"), sql`${vendors.status} <> 'offboarded'`));
