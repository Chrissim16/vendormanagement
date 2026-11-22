import { and, asc, desc, eq, gte, ilike, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { agreements, invoices, milestones, vendors } from "../../../db/schema";
import type { Day } from "../../../shared/dates";
import type { InvoiceInput } from "../../../shared/sow";
import { like } from "../../platform/http";
import type { Queryable } from "../../platform/ports/types";
import { inEuros } from "../settings/service";

const sorts = {
  invoiceDate: invoices.invoiceDate,
  invoiceNumber: sql`lower(${invoices.invoiceNumber})`,
  vendor: sql`lower(${vendors.name})`,
  agreement: sql`lower(${agreements.title})`,
  amount: invoices.amountMinor,
};
export type InvoiceSort = keyof typeof sorts;
export const invoiceSorts = Object.keys(sorts) as InvoiceSort[];

export interface InvoiceFilter {
  q?: string;
  vendorId?: string;
  agreementId?: string;
  from?: Day;
  to?: Day;
  sort: InvoiceSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

const columns = { invoice: invoices, vendorName: vendors.name, agreementTitle: agreements.title, agreementKind: agreements.kind, milestoneTitle: milestones.title };
const base = (db: Queryable) =>
  db
    .select(columns)
    .from(invoices)
    .innerJoin(vendors, eq(vendors.id, invoices.vendorId))
    .innerJoin(agreements, eq(agreements.id, invoices.agreementId))
    .leftJoin(milestones, eq(milestones.id, invoices.milestoneId));

function conditions(f: Pick<InvoiceFilter, "q" | "vendorId" | "agreementId" | "from" | "to">) {
  const where: SQL[] = [];
  if (f.q) where.push(or(ilike(invoices.invoiceNumber, like(f.q)), ilike(invoices.description, like(f.q)), ilike(vendors.name, like(f.q)), ilike(agreements.title, like(f.q)))!);
  if (f.vendorId) where.push(eq(invoices.vendorId, f.vendorId));
  if (f.agreementId) where.push(eq(invoices.agreementId, f.agreementId));
  if (f.from) where.push(gte(invoices.invoiceDate, f.from));
  if (f.to) where.push(lte(invoices.invoiceDate, f.to));
  return where.length ? and(...where) : undefined;
}

export async function listInvoices(db: Queryable, f: InvoiceFilter) {
  const cond = conditions(f);
  const col = f.sort === "amount" ? inEuros(invoices.amountMinor, invoices.currency) : sorts[f.sort];
  const [items, total, sums] = await Promise.all([
    base(db)
      .where(cond)
      .orderBy(f.dir === "asc" ? asc(col) : desc(col), desc(invoices.invoiceDate), asc(invoices.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(vendors, eq(vendors.id, invoices.vendorId))
      .innerJoin(agreements, eq(agreements.id, invoices.agreementId))
      .where(cond),
    db
      .select({ currency: invoices.currency, n: sql<number>`sum(${invoices.amountMinor})::bigint` })
      .from(invoices)
      .innerJoin(vendors, eq(vendors.id, invoices.vendorId))
      .innerJoin(agreements, eq(agreements.id, invoices.agreementId))
      .where(cond)
      .groupBy(invoices.currency),
  ]);
  return { items, total: total[0]?.n ?? 0, sums };
}

export const getInvoice = async (db: Queryable, id: string) => (await base(db).where(eq(invoices.id, id)))[0];
export const findNumber = async (db: Queryable, vendorId: string, number: string, exceptId?: string) =>
  (
    await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.vendorId, vendorId), sql`lower(${invoices.invoiceNumber}) = lower(${number})`, exceptId ? ne(invoices.id, exceptId) : undefined))
  )[0];

type Row = InvoiceInput & { vendorId: string; currency: string };
export const insertInvoice = async (db: Queryable, v: Row, by: string) =>
  (
    await db
      .insert(invoices)
      .values({ ...v, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateInvoice = async (db: Queryable, id: string, v: Row, by: string) =>
  (
    await db
      .update(invoices)
      .set({ ...v, updatedAt: new Date(), updatedBy: by })
      .where(eq(invoices.id, id))
      .returning()
  )[0]!;
export const deleteInvoice = (db: Queryable, id: string) => db.delete(invoices).where(eq(invoices.id, id));

/** The agreement an invoice is booked against, locked so its currency cannot change underneath. */
export async function lockAgreement(tx: Queryable, id: string) {
  await tx.execute(sql`select 1 from agreements where id = ${id} for update`);
  return (
    await tx
      .select({ id: agreements.id, kind: agreements.kind, vendorId: agreements.vendorId, vendorName: vendors.name, title: agreements.title, currency: agreements.currency })
      .from(agreements)
      .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
      .where(eq(agreements.id, id))
  )[0];
}
export const getMilestone = async (db: Queryable, id: string) =>
  (await db.select({ id: milestones.id, sowId: milestones.sowId, status: milestones.status }).from(milestones).where(eq(milestones.id, id)))[0];

/** Invoiced amounts in a period, added up per vendor, month and currency. */
export const spendRows = (db: Queryable, from: Day, to: Day) =>
  db
    .select({
      vendorId: invoices.vendorId,
      vendorName: vendors.name,
      month: sql<string>`to_char(${invoices.invoiceDate}, 'YYYY-MM')`,
      currency: invoices.currency,
      amountMinor: sql<number>`sum(${invoices.amountMinor})::bigint`,
    })
    .from(invoices)
    .innerJoin(vendors, eq(vendors.id, invoices.vendorId))
    .where(and(gte(invoices.invoiceDate, from), lte(invoices.invoiceDate, to)))
    .groupBy(invoices.vendorId, vendors.name, sql`to_char(${invoices.invoiceDate}, 'YYYY-MM')`, invoices.currency);
