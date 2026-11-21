import { sql } from "drizzle-orm";
import type { Day } from "../../../shared/dates";
import type { Page, User } from "../../../shared/types";
import { diff } from "../../../shared/users";
import { buildWarnings, contactSchema, paperwork, vendorSchema, type Contact, type ContactInput, type Vendor, type VendorDetail, type VendorInput } from "../../../shared/vendors";
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

async function checkOwner(tx: Tx, ownerUserId: string) {
  if (!(await repo.activeUser(tx, ownerUserId))) failFields({ ownerUserId: "Choose an owner who has access to the app." });
}

export async function createVendor(db: Db, input: unknown, by: User, today: Day, action: "create" | "import" = "create"): Promise<VendorDetail> {
  const v = vendorSchema.parse(input);
  try {
    return await db.transaction(async (tx) => {
      if (await repo.findByName(tx, v.name)) failFields({ name: DUPLICATE });
      await checkOwner(tx, v.ownerUserId);
      const row = await repo.insertVendor(tx, v, by.email);
      await audit(tx, { userEmail: by.email, action, entityType: "vendor", entityId: row.id, summary: row.name });
      return getVendor(tx, row.id, today);
    });
  } catch (e) {
    // Two people adding the same name at the same moment: the database's own rule catches the second.
    if (isUniqueViolation(e)) failFields({ name: DUPLICATE });
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
    if (isUniqueViolation(e)) failFields({ name: DUPLICATE });
    throw e;
  }
}

const contactLabel = (c: { name: string }) => `contact ${c.name}`;

/**
 * Adds, changes or removes a contact. A change may send only the fields that change.
 * Contact changes appear in the vendor's history.
 */
export async function saveContact(db: Db, target: { vendorId: string } | { contactId: string }, input: unknown, by: User): Promise<Contact[]> {
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
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (c.isPrimary) {
      const previous = (await repo.listContacts(tx, vendorId)).find((x) => x.isPrimary && x.id !== existing?.id);
      if (previous) changes[`${contactLabel(previous)} isPrimary`] = { from: true, to: false };
      await repo.clearPrimary(tx, vendorId);
    }
    if (existing) {
      await repo.updateContact(tx, existing.id, c, by.email);
      for (const [k, v] of Object.entries(diff(existing as unknown as Record<string, unknown>, c))) changes[`${contactLabel(c)} ${k}`] = v;
    } else {
      await repo.insertContact(tx, vendorId, c, by.email);
      changes[contactLabel(c)] = { from: null, to: "added" };
    }
    if (Object.keys(changes).length) await audit(tx, { ...entry, changes });
    return repo.listContacts(tx, vendorId);
  });
}

export const listPeople = (db: Db) => repo.listActiveUsers(db);

/** For other features: the vendor with this name (ignoring case), with its status. */
export const findVendorByName = repo.findByName;
