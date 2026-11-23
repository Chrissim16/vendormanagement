import { and, eq, inArray, sql } from "drizzle-orm";
import { agreements, rfps, users, vendors } from "../../../db/schema";
import { kindShort, statusLabels } from "../../../shared/agreements";
import { ownedSummary, switchOffSchema, type Owned, type OwnedKind, type OwnedRecord } from "../../../shared/handover";
import { rfpStageLabels } from "../../../shared/rfp";
import type { User } from "../../../shared/types";
import { refuseUserChange } from "../../../shared/users";
import { vendorStatusLabels } from "../../../shared/vendors";
import { audit } from "../../platform/audit";
import { toUser } from "../../platform/auth";
import { AppError, notFound } from "../../platform/errors";
import type { Db, Queryable } from "../../platform/ports/types";
import * as repo from "./repo";

const name = (u: { displayName: string | null; email: string }) => u.displayName ?? u.email;

/** Everything in the person's name. With `lock`, those rows stay locked until the transaction ends. */
async function owned(db: Queryable, userId: string, lock = false): Promise<OwnedRecord[]> {
  const vq = db.select({ id: vendors.id, name: vendors.name, status: vendors.status }).from(vendors).where(eq(vendors.ownerUserId, userId)).orderBy(sql`lower(${vendors.name})`, vendors.id);
  const aq = db
    .select({ id: agreements.id, title: agreements.title, kind: agreements.kind, status: agreements.status, vendorName: vendors.name })
    .from(agreements)
    .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
    .where(eq(agreements.ownerUserId, userId))
    .orderBy(sql`lower(${vendors.name})`, sql`lower(${agreements.title})`, agreements.id);
  const rq = db.select({ id: rfps.id, title: rfps.title, stage: rfps.stage }).from(rfps).where(eq(rfps.ownerUserId, userId)).orderBy(sql`lower(${rfps.title})`, rfps.id);
  const [vs, as, rs] = lock
    ? [await vq.for("update"), await aq.for("update", { of: agreements }), await rq.for("update")]
    : await Promise.all([vq, aq, rq]);
  return [
    ...vs.map((v) => ({ type: "vendor" as const, id: v.id, label: v.name, detail: vendorStatusLabels[v.status] })),
    ...as.map((a) => ({ type: "agreement" as const, id: a.id, label: `${a.vendorName} · ${a.title}`, detail: `${kindShort[a.kind]}, ${statusLabels[a.status].toLowerCase()}` })),
    ...rs.map((r) => ({ type: "rfp" as const, id: r.id, label: r.title, detail: rfpStageLabels[r.stage] })),
  ];
}

/** What a person owns, to hand over before they are switched off (F-6). */
export async function listOwned(db: Db, userId: string): Promise<Owned> {
  const current = await repo.getUser(db, userId);
  if (!current) throw notFound("That person");
  const [records, otherAdmins] = await Promise.all([owned(db, userId), repo.countOtherActiveAdmins(db, userId)]);
  return { records, refusal: refuseUserChange(current, { active: false }, otherAdmins) };
}

/** The records in a person's name; switching them off waits until this is empty. */
export const ownedBy = (db: Queryable, userId: string) => owned(db, userId);

/** Locks a person's row until the transaction ends; owner checks share-lock it, so they wait. */
export const lockPerson = (db: Queryable, id: string) => db.select({ id: users.id }).from(users).where(eq(users.id, id)).for("update");

export const stillOwns = (who: string, records: OwnedRecord[]) =>
  new AppError(409, "owns_records", `${who} still owns ${ownedSummary(records)}. Choose who takes them over before switching ${who} off.`);

const tables = { vendor: vendors, agreement: agreements, rfp: rfps } as const;

/**
 * Hands every record in the person's name to the chosen new owners and switches the person
 * off, all in one transaction: if any part is refused, nothing changes (F-6).
 */
export async function switchOff(db: Db, id: string, input: unknown, by: User) {
  const { records: chosen } = switchOffSchema.parse(input);
  return db.transaction(async (tx) => {
    // The same lock as role changes, so two admins cannot switch off the last admin together.
    await tx.execute(sql`select pg_advisory_xact_lock(4201)`);
    // Lock the person first: a save naming them as owner waits until this is done, so nothing new lands in their name meanwhile.
    await lockPerson(tx, id);
    const current = await repo.getUser(tx, id);
    if (!current) throw notFound("That person");
    const refusal = refuseUserChange(current, { active: false }, await repo.countOtherActiveAdmins(tx, id));
    if (refusal) throw new AppError(409, "last_admin", refusal);

    const mine = await owned(tx, id, true);
    const given = new Map(chosen.map((c) => [`${c.type}:${c.id}`, c.ownerUserId]));
    if (given.size !== chosen.length) throw new AppError(400, "twice", "A record was given twice. Look again and try once more.");
    const left = mine.filter((r) => !given.has(`${r.type}:${r.id}`));
    if (left.length) throw stillOwns(name(current), left);
    if (given.size > mine.length)
      throw new AppError(409, "changed", `Something changed while you were choosing: not every record listed is ${name(current)}'s any more. Open the hand-over again to see what is.`);

    const ownerIds = [...new Set(given.values())];
    const owners = await tx.select().from(users).where(inArray(users.id, ownerIds));
    const byId = new Map(owners.map((u) => [u.id, u]));
    for (const o of ownerIds) {
      const u = byId.get(o);
      if (!u || !u.active || u.id === id) throw new AppError(400, "bad_owner", "Choose someone who has access to the app, other than the person being switched off.", { ownerUserId: "Choose someone with access." });
    }

    const from = name(current);
    for (const r of mine) {
      const to = byId.get(given.get(`${r.type}:${r.id}`)!)!;
      const table = tables[r.type as OwnedKind];
      await tx.update(table).set({ ownerUserId: to.id, updatedAt: new Date(), updatedBy: by.email }).where(and(eq(table.id, r.id), eq(table.ownerUserId, id)));
      await audit(tx, { userEmail: by.email, action: "update", entityType: r.type, entityId: r.id, summary: r.label, changes: { owner: { from, to: name(to) } } });
    }
    if (!current.active) return toUser(current);
    const updated = await repo.updateUser(tx, id, { active: false }, by.email);
    const changes: Record<string, { from: unknown; to: unknown }> = { active: { from: true, to: false } };
    if (mine.length) changes["records handed over"] = { from: null, to: ownedSummary(mine) };
    await audit(tx, { userEmail: by.email, action: "update", entityType: "user", entityId: id, summary: current.email, changes });
    return toUser(updated);
  });
}

