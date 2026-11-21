import { aliasedTable, and, asc, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { agreements, documents, renewalDecisions, users, vendors } from "../../../db/schema";
import type { AgreementInput, AgreementStatus, Kind } from "../../../shared/agreements";
import { like } from "../../platform/http";
import type { Queryable } from "../../platform/ports/types";

const ownerName = sql<string>`coalesce(${users.displayName}, ${users.email})`;
const value = sql<number>`coalesce(${agreements.budgetMinor}, ${agreements.annualValueMinor})`;
const sorts = {
  title: sql`lower(${agreements.title})`,
  vendor: sql`lower(${vendors.name})`,
  kind: agreements.kind,
  status: agreements.status,
  endDate: agreements.endDate,
  owner: sql`lower(${ownerName})`,
  value,
};
export type AgreementSort = keyof typeof sorts;
export const agreementSorts = Object.keys(sorts) as AgreementSort[];

export interface AgreementFilter {
  q?: string;
  kind?: Kind;
  vendorId?: string;
  status?: AgreementStatus;
  owner?: string;
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
  return where.length ? and(...where) : undefined;
}

export async function listAgreements(db: Queryable, f: AgreementFilter) {
  const cond = conditions(f);
  const col = sorts[f.sort];
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

export const documentsOf = (db: Queryable, agreementId: string) => db.select().from(documents).where(eq(documents.agreementId, agreementId)).orderBy(desc(documents.createdAt));
export const getDocument = async (db: Queryable, id: string) => (await db.select().from(documents).where(eq(documents.id, id)))[0];
export const insertDocument = async (db: Queryable, d: typeof documents.$inferInsert) => (await db.insert(documents).values(d).returning())[0]!;
export const deleteDocument = (db: Queryable, id: string) => db.delete(documents).where(eq(documents.id, id));

export const getVendorBrief = async (db: Queryable, id: string) =>
  (await db.select({ id: vendors.id, name: vendors.name, status: vendors.status }).from(vendors).where(eq(vendors.id, id)))[0];
export const activeUser = async (db: Queryable, id: string) =>
  (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), eq(users.active, true)))
  )[0];
