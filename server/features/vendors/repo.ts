import { and, asc, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import { agreements, contacts, users, vendors } from "../../../db/schema";
import type { ContactInput, VendorInput, VendorStatus, VendorType } from "../../../shared/vendors";
import { like } from "../../platform/http";
import type { Queryable } from "../../platform/ports/types";

const ownerName = sql<string>`coalesce(${users.displayName}, ${users.email})`;
const sorts = { name: sql`lower(${vendors.name})`, type: vendors.type, status: vendors.status, owner: sql`lower(${ownerName})` };
export type VendorSort = keyof typeof sorts;
export const vendorSorts = Object.keys(sorts) as VendorSort[];

export interface VendorFilter {
  q?: string;
  type?: VendorType;
  /** A status, or "all" to include offboarded vendors. Without it offboarded vendors are left out. */
  status?: VendorStatus | "all";
  owner?: string;
  sort: VendorSort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

const columns = { vendor: vendors, ownerName };

export async function listVendors(db: Queryable, f: VendorFilter) {
  const where: SQL[] = [];
  if (f.q) where.push(or(ilike(vendors.name, like(f.q)), ilike(vendors.legalName, like(f.q)))!);
  if (f.type) where.push(eq(vendors.type, f.type));
  if (!f.status) where.push(ne(vendors.status, "offboarded"));
  else if (f.status !== "all") where.push(eq(vendors.status, f.status));
  if (f.owner) where.push(eq(vendors.ownerUserId, f.owner));
  const cond = where.length ? and(...where) : undefined;
  const col = sorts[f.sort];
  const [items, total] = await Promise.all([
    db
      .select(columns)
      .from(vendors)
      .innerJoin(users, eq(users.id, vendors.ownerUserId))
      .where(cond)
      .orderBy(f.dir === "asc" ? asc(col) : desc(col), asc(vendors.name))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(vendors)
      .where(cond),
  ]);
  return { items, total: total[0]?.n ?? 0 };
}

export const getVendor = async (db: Queryable, id: string) =>
  (await db.select(columns).from(vendors).innerJoin(users, eq(users.id, vendors.ownerUserId)).where(eq(vendors.id, id)))[0];
export const findByName = async (db: Queryable, name: string) =>
  (
    await db
      .select({ id: vendors.id })
      .from(vendors)
      .where(sql`lower(${vendors.name}) = lower(${name})`)
  )[0];
export const activeUser = async (db: Queryable, id: string) =>
  (
    await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), eq(users.active, true)))
  )[0];

export const insertVendor = async (db: Queryable, v: VendorInput, by: string) =>
  (
    await db
      .insert(vendors)
      .values({ ...v, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateVendor = async (db: Queryable, id: string, v: Partial<VendorInput>, by: string) =>
  (
    await db
      .update(vendors)
      .set({ ...v, updatedAt: new Date(), updatedBy: by })
      .where(eq(vendors.id, id))
      .returning()
  )[0]!;

export const activeAgreementsOf = (db: Queryable, vendorId: string) =>
  db
    .select({ id: agreements.id, title: agreements.title })
    .from(agreements)
    .where(and(eq(agreements.vendorId, vendorId), eq(agreements.status, "active")))
    .orderBy(asc(agreements.title));

export const listContacts = (db: Queryable, vendorId: string) =>
  db.select().from(contacts).where(eq(contacts.vendorId, vendorId)).orderBy(desc(contacts.isPrimary), asc(contacts.name));
export const getContact = async (db: Queryable, id: string) => (await db.select().from(contacts).where(eq(contacts.id, id)))[0];
export const clearPrimary = (db: Queryable, vendorId: string) =>
  db
    .update(contacts)
    .set({ isPrimary: false })
    .where(and(eq(contacts.vendorId, vendorId), eq(contacts.isPrimary, true)));
export const insertContact = async (db: Queryable, vendorId: string, c: ContactInput, by: string) =>
  (
    await db
      .insert(contacts)
      .values({ ...c, vendorId, createdBy: by, updatedBy: by })
      .returning()
  )[0]!;
export const updateContact = async (db: Queryable, id: string, c: ContactInput, by: string) =>
  (
    await db
      .update(contacts)
      .set({ ...c, updatedAt: new Date(), updatedBy: by })
      .where(eq(contacts.id, id))
      .returning()
  )[0]!;
export const deleteContact = (db: Queryable, id: string) => db.delete(contacts).where(eq(contacts.id, id));

export const listActiveUsers = (db: Queryable) =>
  db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(sql`lower(coalesce(${users.displayName}, ${users.email}))`);
