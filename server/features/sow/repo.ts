import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { agreements, changeRequests, consultants, invoices, milestones, rateCardLines, vendors } from "../../../db/schema";
import type { ChangeRequestInput, ConsultantInput, MilestoneInput, RateLineInput } from "../../../shared/sow";
import type { Queryable } from "../../platform/ports/types";

/** The SOW a milestone, change or consultant belongs to, locked so its budget and dates cannot move underneath. */
export async function lockSow(tx: Queryable, id: string) {
  await tx.execute(sql`select 1 from agreements where id = ${id} for update`);
  return (
    await tx
      .select({
        id: agreements.id,
        kind: agreements.kind,
        vendorId: agreements.vendorId,
        vendorName: vendors.name,
        title: agreements.title,
        status: agreements.status,
        pricing: agreements.pricing,
        budgetMinor: agreements.budgetMinor,
        currency: agreements.currency,
        startDate: agreements.startDate,
        endDate: agreements.endDate,
      })
      .from(agreements)
      .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
      .where(eq(agreements.id, id))
  )[0];
}
export const applyChange = (tx: Queryable, id: string, patch: { budgetMinor: number | null; endDate: string | null }, by: string) =>
  tx
    .update(agreements)
    .set({ ...patch, updatedAt: new Date(), updatedBy: by })
    .where(eq(agreements.id, id));

export const milestonesOf = (db: Queryable, sowId: string) =>
  db.select().from(milestones).where(eq(milestones.sowId, sowId)).orderBy(asc(milestones.dueDate), asc(milestones.createdAt));
export const getMilestone = async (db: Queryable, id: string) => (await db.select().from(milestones).where(eq(milestones.id, id)))[0];
export const insertMilestone = async (db: Queryable, sowId: string, m: MilestoneInput, by: string) =>
  (
    await db
      .insert(milestones)
      .values({ ...m, sowId, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateMilestone = async (db: Queryable, id: string, m: MilestoneInput, by: string) =>
  (
    await db
      .update(milestones)
      .set({ ...m, updatedAt: new Date(), updatedBy: by })
      .where(eq(milestones.id, id))
      .returning()
  )[0]!;

/** What the non-cancelled milestones of a SOW add up to. */
export const plannedMilestones = async (db: Queryable, sowId: string) =>
  (
    await db
      .select({ n: sql<number>`coalesce(sum(${milestones.amountMinor}), 0)::bigint` })
      .from(milestones)
      .where(and(eq(milestones.sowId, sowId), ne(milestones.status, "cancelled")))
  )[0]!.n;

export const changesOf = (db: Queryable, sowId: string) =>
  db.select().from(changeRequests).where(eq(changeRequests.sowId, sowId)).orderBy(asc(changeRequests.requestedOn), asc(changeRequests.createdAt));
export const getChange = async (db: Queryable, id: string) => (await db.select().from(changeRequests).where(eq(changeRequests.id, id)))[0];
export const insertChange = async (db: Queryable, sowId: string, c: ChangeRequestInput, by: string) =>
  (
    await db
      .insert(changeRequests)
      .values({ ...c, sowId, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateChange = async (db: Queryable, id: string, c: Partial<typeof changeRequests.$inferInsert>, by: string) =>
  (
    await db
      .update(changeRequests)
      .set({ ...c, updatedAt: new Date(), updatedBy: by })
      .where(eq(changeRequests.id, id))
      .returning()
  )[0]!;

export const consultantsOf = (db: Queryable, sowId: string) => db.select().from(consultants).where(eq(consultants.sowId, sowId)).orderBy(asc(consultants.name));
export const getConsultant = async (db: Queryable, id: string) => (await db.select().from(consultants).where(eq(consultants.id, id)))[0];
export const insertConsultant = async (db: Queryable, sowId: string, c: ConsultantInput, by: string) =>
  (
    await db
      .insert(consultants)
      .values({ ...c, sowId, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateConsultant = async (db: Queryable, id: string, c: ConsultantInput, by: string) =>
  (
    await db
      .update(consultants)
      .set({ ...c, updatedAt: new Date(), updatedBy: by })
      .where(eq(consultants.id, id))
      .returning()
  )[0]!;
export const deleteConsultant = (db: Queryable, id: string) => db.delete(consultants).where(eq(consultants.id, id));

export const getVendor = async (db: Queryable, id: string) => (await db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(eq(vendors.id, id)))[0];
export const rateLinesOf = (db: Queryable, vendorId: string) =>
  db
    .select()
    .from(rateCardLines)
    .where(eq(rateCardLines.vendorId, vendorId))
    .orderBy(sql`lower(${rateCardLines.role})`, desc(rateCardLines.validFrom));
export const getRateLine = async (db: Queryable, id: string) => (await db.select().from(rateCardLines).where(eq(rateCardLines.id, id)))[0];
export const insertRateLine = async (db: Queryable, vendorId: string, l: RateLineInput, by: string) =>
  (
    await db
      .insert(rateCardLines)
      .values({ ...l, vendorId, createdBy: by })
      .returning()
  )[0]!;
export const deleteRateLine = (db: Queryable, id: string) => db.delete(rateCardLines).where(eq(rateCardLines.id, id));
/** Consultants of this vendor's SOWs who hold the role. */
export const consultantsWithRole = (db: Queryable, vendorId: string, role: string) =>
  db
    .select({ name: consultants.name })
    .from(consultants)
    .innerJoin(agreements, eq(agreements.id, consultants.sowId))
    .where(and(eq(agreements.vendorId, vendorId), sql`lower(${consultants.role}) = lower(${role})`));

/** Invoiced so far per agreement, and per milestone. Agreements with no invoices are absent. */
export async function invoicedByAgreement(db: Queryable, agreementIds: string[]): Promise<Map<string, number>> {
  if (!agreementIds.length) return new Map();
  const rows = await db
    .select({ id: invoices.agreementId, n: sql<number>`sum(${invoices.amountMinor})::bigint` })
    .from(invoices)
    .where(inArray(invoices.agreementId, agreementIds))
    .groupBy(invoices.agreementId);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}
export async function invoicedByMilestone(db: Queryable, sowId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ id: invoices.milestoneId, n: sql<number>`sum(${invoices.amountMinor})::bigint` })
    .from(invoices)
    .where(eq(invoices.agreementId, sowId))
    .groupBy(invoices.milestoneId);
  return new Map(rows.filter((r) => r.id).map((r) => [r.id!, Number(r.n)]));
}
