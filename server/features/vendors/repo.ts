import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { agreements, contactRoleLinks, contactRoles, contacts, users, vendors } from "../../../db/schema";
import { byName, type Contact, type ContactInput, type ContactRole, type VendorInput, type VendorStatus, type VendorType } from "../../../shared/vendors";
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
      .select({ id: vendors.id, status: vendors.status })
      .from(vendors)
      .where(sql`lower(${vendors.name}) = lower(${name})`)
  )[0];
/** The vendor other than `exceptId` that holds this VAT or tax number (stored cleaned). */
export const findByVat = async (db: Queryable, vatNumber: string, exceptId?: string) =>
  (
    await db
      .select({ id: vendors.id, name: vendors.name })
      .from(vendors)
      .where(and(eq(vendors.vatNumber, vatNumber), exceptId ? ne(vendors.id, exceptId) : undefined))
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

const contactColumns = { id: contacts.id, vendorId: contacts.vendorId, name: contacts.name, email: contacts.email, phone: contacts.phone, isPrimary: contacts.isPrimary };

/** The role names of these contacts, A to Z, by contact id. */
async function rolesOf(db: Queryable, contactIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(contactIds.map((id) => [id, []]));
  if (!contactIds.length) return out;
  const rows = await db
    .select({ contactId: contactRoleLinks.contactId, name: contactRoles.name })
    .from(contactRoleLinks)
    .innerJoin(contactRoles, eq(contactRoles.id, contactRoleLinks.roleId))
    .where(inArray(contactRoleLinks.contactId, contactIds));
  for (const r of rows) out.get(r.contactId)!.push(r.name);
  for (const names of out.values()) names.sort(byName);
  return out;
}

export async function listContacts(db: Queryable, vendorId: string): Promise<(Contact & { vendorId: string })[]> {
  const rows = await db.select(contactColumns).from(contacts).where(eq(contacts.vendorId, vendorId)).orderBy(desc(contacts.isPrimary), asc(contacts.name));
  const roles = await rolesOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, roles: roles.get(r.id)! }));
}
export async function getContact(db: Queryable, id: string) {
  const row = (await db.select(contactColumns).from(contacts).where(eq(contacts.id, id)))[0];
  return row && { ...row, roles: (await rolesOf(db, [id])).get(id)! };
}
export const clearPrimary = (db: Queryable, vendorId: string) =>
  db
    .update(contacts)
    .set({ isPrimary: false })
    .where(and(eq(contacts.vendorId, vendorId), eq(contacts.isPrimary, true)));
const contactFields = ({ name, email, phone, isPrimary }: ContactInput) => ({ name, email, phone, isPrimary });
export const insertContact = async (db: Queryable, vendorId: string, c: ContactInput, by: string) =>
  (
    await db
      .insert(contacts)
      .values({ ...contactFields(c), vendorId, createdBy: by, updatedBy: by })
      .returning({ id: contacts.id })
  )[0]!;
export const updateContact = (db: Queryable, id: string, c: ContactInput, by: string) =>
  db
    .update(contacts)
    .set({ ...contactFields(c), updatedAt: new Date(), updatedBy: by })
    .where(eq(contacts.id, id));
export async function setContactRoles(db: Queryable, contactId: string, roleIds: string[]) {
  await db.delete(contactRoleLinks).where(eq(contactRoleLinks.contactId, contactId));
  if (roleIds.length) await db.insert(contactRoleLinks).values(roleIds.map((roleId) => ({ contactId, roleId })));
}

// ---- Contact roles (V-7)

export const listRoles = (db: Queryable): Promise<ContactRole[]> =>
  db
    .select({ id: contactRoles.id, name: contactRoles.name, contacts: sql<number>`(select count(*)::int from ${contactRoleLinks} where ${contactRoleLinks.roleId} = ${contactRoles.id})` })
    .from(contactRoles)
    .orderBy(sql`lower(${contactRoles.name})`);
export const getRole = async (db: Queryable, id: string) => (await db.select().from(contactRoles).where(eq(contactRoles.id, id)))[0];
/** The roles with these names, ignoring case. */
export const rolesNamed = (db: Queryable, names: string[]) =>
  names.length
    ? db
        .select({ id: contactRoles.id, name: contactRoles.name })
        .from(contactRoles)
        .where(
          inArray(
            sql`lower(${contactRoles.name})`,
            names.map((n) => n.toLowerCase()),
          ),
        )
    : Promise.resolve([]);
export const insertRole = async (db: Queryable, name: string, by: string) =>
  (
    await db
      .insert(contactRoles)
      .values({ name, createdBy: by, updatedBy: by })
      .returning({ id: contactRoles.id, name: contactRoles.name })
  )[0]!;
export const renameRole = (db: Queryable, id: string, name: string, by: string) =>
  db.update(contactRoles).set({ name, updatedAt: new Date(), updatedBy: by }).where(eq(contactRoles.id, id));
export const deleteRole = (db: Queryable, id: string) => db.delete(contactRoles).where(eq(contactRoles.id, id));
/** Who holds a role, with their vendor, for saying why it cannot be removed. */
export const holdersOf = (db: Queryable, roleId: string) =>
  db
    .select({ name: contacts.name, vendorName: vendors.name })
    .from(contactRoleLinks)
    .innerJoin(contacts, eq(contacts.id, contactRoleLinks.contactId))
    .innerJoin(vendors, eq(vendors.id, contacts.vendorId))
    .where(eq(contactRoleLinks.roleId, roleId))
    .orderBy(asc(vendors.name), asc(contacts.name));
export const deleteContact = (db: Queryable, id: string) => db.delete(contacts).where(eq(contacts.id, id));

export const listActiveUsers = (db: Queryable) =>
  db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(sql`lower(coalesce(${users.displayName}, ${users.email}))`);
