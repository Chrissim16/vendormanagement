import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Day } from "../../../shared/dates";
import type { Page, User } from "../../../shared/types";
import { diff } from "../../../shared/users";
import {
  buildWarnings,
  byName,
  contactSchema,
  paperwork,
  newVendorSchema,
  roleNameSchema,
  vendorSchema,
  type Contact,
  type ContactInput,
  type ContactRole,
  type Vendor,
  type VendorDetail,
  type VendorInput,
} from "../../../shared/vendors";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import { failFields, isUniqueViolation } from "../../platform/http";
import type { Db, Queryable, Tx } from "../../platform/ports/types";
import { warningInputs } from "../warnings/service";
import * as repo from "./repo";

type Row = NonNullable<Awaited<ReturnType<typeof repo.getVendor>>>;

/** Adds what is worked out from a vendor's agreements: counts, paperwork and warnings. */
async function decorate(db: Queryable, rows: Row[], today: Day): Promise<Vendor[]> {
  const input = await warningInputs(
    db,
    rows.map((r) => r.vendor.id),
  );
  const warnings = buildWarnings(input.vendors, input.agreements, today, input.windows);
  return rows.map(({ vendor: v, ownerName }) => {
    const mine = input.agreements.filter((a) => a.vendorId === v.id);
    return {
      ...v,
      ownerName,
      createdAt: v.createdAt.toISOString(),
      activeAgreements: mine.filter((a) => a.status === "active").length,
      nda: paperwork("nda", v.ndaRequired, mine, today),
      dpa: paperwork("dpa", v.dpaRequired, mine, today),
      warnings: warnings.filter((w) => w.vendorId === v.id).length,
    };
  });
}

export async function listVendors(db: Db, filter: repo.VendorFilter, today: Day): Promise<Page<Vendor>> {
  const { items, total } = await repo.listVendors(db, filter);
  return { items: await decorate(db, items, today), total };
}

export async function getVendor(db: Queryable, id: string, today: Day): Promise<VendorDetail> {
  const row = await repo.getVendor(db, id);
  if (!row) throw notFound("That vendor");
  const [vendor] = await decorate(db, [row], today);
  return { ...vendor!, contacts: await repo.listContacts(db, id) };
}

const DUPLICATE = "A vendor with this name already exists.";
const vatTaken = (name: string) => `${name} already has this VAT or tax number.`;

/** Refuses a VAT or tax number another vendor holds (V-5). */
async function checkVat(tx: Tx, vatNumber: string | null, exceptId?: string) {
  if (!vatNumber) return;
  const other = await repo.findByVat(tx, vatNumber, exceptId);
  if (other) failFields({ vatNumber: vatTaken(other.name) });
}

/** Two people saving at the same moment: the database's own rules catch the second. Anything else is passed on as it is. */
async function uniqueProblem(db: Queryable, e: unknown, v: { vatNumber?: string | null }, exceptId?: string): Promise<void> {
  if (isForeignKeyViolation(e)) throw ROLE_GONE;
  if (!isUniqueViolation(e)) return;
  const err = e as { constraint?: string; cause?: { constraint?: string } };
  const constraint = err?.constraint ?? err?.cause?.constraint;
  if (constraint === "vendors_vat_unique" && v.vatNumber) {
    const other = await repo.findByVat(db, v.vatNumber, exceptId);
    failFields({ vatNumber: vatTaken(other?.name ?? "Another vendor") });
  }
  // The only other rule a vendor save can break is the one on names.
  if (!constraint || constraint === "vendors_name_unique") failFields({ name: DUPLICATE });
}

async function checkOwner(tx: Tx, ownerUserId: string) {
  if (!(await repo.activeUser(tx, ownerUserId))) failFields({ ownerUserId: "Choose an owner who has access to the app." });
}

/** Adds a vendor, with its main contact as primary when one is given (V-6): both are saved, or neither. */
export async function createVendor(db: Db, input: unknown, by: User, today: Day, action: "create" | "import" = "create"): Promise<VendorDetail> {
  const { mainContact, ...v } = newVendorSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      if (await repo.findByName(tx, v.name)) failFields({ name: DUPLICATE });
      await checkVat(tx, v.vatNumber);
      await checkOwner(tx, v.ownerUserId);
      const row = await repo.insertVendor(tx, v, by.email);
      // One history entry: the vendor was added, with its main contact if there is one.
      const changes = mainContact ? await writeContact(tx, row.id, undefined, { ...mainContact, isPrimary: true }, by) : undefined;
      await audit(tx, { userEmail: by.email, action, entityType: "vendor", entityId: row.id, summary: row.name, changes });
      return getVendor(tx, row.id, today);
    });
  } catch (e) {
    await uniqueProblem(db, e, v);
    throw e;
  }
}

export async function updateVendor(db: Db, id: string, input: unknown, by: User, today: Day): Promise<VendorDetail> {
  const patch = vendorSchema.partial().parse(input);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from vendors where id = ${id} for update`);
      const current = (await repo.getVendor(tx, id))?.vendor;
      if (!current) throw notFound("That vendor");
      // Defaults in the schema must not overwrite fields the request did not send.
      const sent = Object.fromEntries(Object.entries(patch).filter(([k]) => k in (input as object))) as Partial<VendorInput>;
      const next = vendorSchema.parse({ ...current, ...sent });
      if (next.name.toLowerCase() !== current.name.toLowerCase() && (await repo.findByName(tx, next.name))) failFields({ name: DUPLICATE });
      if (next.vatNumber !== current.vatNumber) await checkVat(tx, next.vatNumber, id);
      if (next.ownerUserId !== current.ownerUserId) await checkOwner(tx, next.ownerUserId);
      if (next.status === "offboarded" && current.status !== "offboarded") {
        const active = await repo.activeAgreementsOf(tx, id);
        if (active.length) {
          const more = active.length > 1 ? ` and ${active.length - 1} more` : "";
          throw new AppError(409, "has_active_agreements", `This vendor still has an active agreement: ${active[0]!.title}${more}. End it before offboarding the vendor.`, {
            status: "End the vendor's active agreements first.",
          });
        }
      }
      const changes = diff(current as unknown as Record<string, unknown>, next);
      if (Object.keys(changes).length) {
        await repo.updateVendor(tx, id, next, by.email);
        await audit(tx, { userEmail: by.email, action: "update", entityType: "vendor", entityId: id, summary: next.name, changes });
      }
      return getVendor(tx, id, today);
    });
  } catch (e) {
    await uniqueProblem(db, e, patch, id);
    throw e;
  }
}

const contactLabel = (c: { name: string }) => `contact ${c.name}`;
const ROLES = { entityType: "contact_roles", entityId: "list" } as const;

/**
 * The ids of the roles with these names. A name not on the list yet is added to it, for
 * everyone (V-7); one that differs from an existing role only in capitals or spaces is that role.
 */
async function resolveRoles(tx: Tx, names: string[], by: User): Promise<{ id: string; name: string }[]> {
  const out = new Map<string, { id: string; name: string }>();
  for (const name of names) {
    let role = await repo.roleNamed(tx, name);
    if (!role) {
      const added = await repo.insertRole(tx, name, by.email);
      if (added) await audit(tx, { userEmail: by.email, action: "create", ...ROLES, summary: added.name, changes: { [`role ${added.name}`]: { from: null, to: "added" } } });
      // Not added: a colleague added the same role a moment ago, and that one is used.
      role = added ?? (await repo.roleNamed(tx, name));
    }
    if (!role) throw ROLE_GONE;
    out.set(role.id, role);
  }
  return [...out.values()].sort((a, b) => byName(a.name, b.name));
}
const ROLE_GONE = new AppError(409, "role_gone", "One of the roles was just removed from the list. Choose the roles again and save.", { roles: "Choose the roles again." });
const isForeignKeyViolation = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23503" || err?.cause?.code === "23503";
};
const roleList = (roles: string[]) => (roles.length ? roles.join(", ") : null);

/** Writes one contact and its roles; returns what changed for the vendor's history. */
async function writeContact(tx: Tx, vendorId: string, existing: Contact | undefined, c: ContactInput, by: User) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (c.isPrimary) {
    const previous = (await repo.listContacts(tx, vendorId)).find((x) => x.isPrimary && x.id !== existing?.id);
    if (previous) changes[`${contactLabel(previous)} isPrimary`] = { from: true, to: false };
    await repo.clearPrimary(tx, vendorId);
  }
  const resolved = await resolveRoles(tx, c.roles, by);
  const roleIds = resolved.map((r) => r.id);
  // The stored spelling of each role, which may differ in capitals from what was typed.
  const roles = resolved.map((r) => r.name);
  if (existing) {
    await repo.updateContact(tx, existing.id, c, by.email);
    const { roles: _before, ...rest } = existing;
    const { roles: _after, ...next } = c;
    for (const [k, v] of Object.entries(diff(rest as unknown as Record<string, unknown>, next))) changes[`${contactLabel(c)} ${k}`] = v;
    if (roleList(existing.roles) !== roleList(roles)) changes[`${contactLabel(c)} roles`] = { from: roleList(existing.roles), to: roleList(roles) };
    await repo.setContactRoles(tx, existing.id, roleIds);
  } else {
    const row = await repo.insertContact(tx, vendorId, c, by.email);
    await repo.setContactRoles(tx, row.id, roleIds);
    changes[contactLabel(c)] = { from: null, to: roles.length ? `added as ${roles.join(", ")}` : "added" };
  }
  return changes;
}

/**
 * Adds, changes or removes a contact. A change may send only the fields that change.
 * Contact changes appear in the vendor's history.
 */
export async function saveContact(db: Db, target: { vendorId: string } | { contactId: string }, input: unknown, by: User): Promise<Contact[]> {
  try {
    return await saveContactIn(db, target, input, by);
  } catch (e) {
    // An admin removed a chosen role while this was being saved.
    if (isForeignKeyViolation(e)) throw ROLE_GONE;
    throw e;
  }
}

function saveContactIn(db: Db, target: { vendorId: string } | { contactId: string }, input: unknown, by: User): Promise<Contact[]> {
  return db.transaction(async (tx) => {
    const existing = "contactId" in target ? await repo.getContact(tx, target.contactId) : undefined;
    if ("contactId" in target && !existing) throw notFound("That contact");
    const vendorId = existing?.vendorId ?? (target as { vendorId: string }).vendorId;
    await tx.execute(sql`select 1 from vendors where id = ${vendorId} for update`);
    const vendor = (await repo.getVendor(tx, vendorId))?.vendor;
    if (!vendor) throw notFound("That vendor");
    const entry = { userEmail: by.email, action: "update" as const, entityType: "vendor", entityId: vendorId, summary: vendor.name };
    if (input === null) {
      await repo.deleteContact(tx, existing!.id);
      await audit(tx, { ...entry, changes: { [contactLabel(existing!)]: { from: "listed", to: "removed" } } });
      return repo.listContacts(tx, vendorId);
    }
    // Fields that were not sent keep their stored value.
    const c: ContactInput = contactSchema.parse(existing ? { ...existing, ...(input as object) } : input);
    const changes = await writeContact(tx, vendorId, existing, c, by);
    if (Object.keys(changes).length) await audit(tx, { ...entry, changes });
    return repo.listContacts(tx, vendorId);
  });
}

export const listPeople = (db: Db) => repo.listActiveUsers(db);

// ---- Contact roles (V-7)

export const listContactRoles = (db: Queryable): Promise<ContactRole[]> => repo.listRoles(db);

async function lockRole(tx: Tx, id: string) {
  await tx.execute(sql`select 1 from contact_roles where id = ${id} for update`);
  const role = await repo.getRole(tx, id);
  if (!role) throw notFound("That role");
  return role;
}

/** Admin: renames a role; every contact that holds it shows the new name. */
export async function renameContactRole(db: Db, id: string, input: unknown, by: User): Promise<ContactRole[]> {
  const { name } = z.object({ name: roleNameSchema }).parse(input ?? {});
  try {
    return await db.transaction(async (tx) => {
      const role = await lockRole(tx, id);
      if (role.name === name) return repo.listRoles(tx);
      const same = await repo.roleNamed(tx, name);
      if (same && same.id !== id) failFields({ name: `There is already a role called ${same.name}.` });
      await repo.renameRole(tx, id, name, by.email);
      await audit(tx, { userEmail: by.email, action: "update", ...ROLES, summary: name, changes: { [`role ${role.name}`]: { from: role.name, to: name } } });
      return repo.listRoles(tx);
    });
  } catch (e) {
    if (isUniqueViolation(e)) failFields({ name: "There is already a role with that name." });
    throw e;
  }
}

/** Admin: removes a role nobody holds. */
export async function removeContactRole(db: Db, id: string, by: User): Promise<ContactRole[]> {
  return db.transaction(async (tx) => {
    const role = await lockRole(tx, id);
    const holders = await repo.holdersOf(tx, id);
    if (holders.length) {
      const named = holders
        .slice(0, 3)
        .map((h) => `${h.name} (${h.vendorName})`)
        .join(", ");
      const more = holders.length > 3 ? ` and ${holders.length - 3} more` : "";
      throw new AppError(409, "role_in_use", `${role.name} is still held by ${named}${more}. Take it off those contacts first.`);
    }
    await repo.deleteRole(tx, id);
    await audit(tx, { userEmail: by.email, action: "delete", ...ROLES, summary: role.name, changes: { [`role ${role.name}`]: { from: "listed", to: "removed" } } });
    return repo.listRoles(tx);
  });
}

/** For other features: the vendor with this name (ignoring case), with its status. */
export const findVendorByName = repo.findByName;
/** For other features: the vendor that holds this VAT or tax number (already cleaned). */
export const findVendorByVat = (db: Queryable, vatNumber: string) => repo.findByVat(db, vatNumber);
