import { sql } from "drizzle-orm";
import type { Day } from "../../../shared/dates";
import { formatMoney } from "../../../shared/money";
import {
  budgetView,
  changeRequestSchema,
  checkApproval,
  checkMilestone,
  consultantSchema,
  daysLate,
  hasRole,
  milestoneSchema,
  rateFor,
  rateLineSchema,
  type ChangeRequest,
  type Consultant,
  type Milestone,
  type RateLine,
  type SowDelivery,
} from "../../../shared/sow";
import type { User } from "../../../shared/types";
import { diff } from "../../../shared/users";
import { audit } from "../../platform/audit";
import { AppError, notFound } from "../../platform/errors";
import { failFields, isUniqueViolation } from "../../platform/http";
import type { Db, Queryable, Tx } from "../../platform/ports/types";
import { getSettings, requireListed } from "../settings/service";
import * as repo from "./repo";

type Sow = NonNullable<Awaited<ReturnType<typeof repo.lockSow>>>;
type Changes = Record<string, { from: unknown; to: unknown }>;

/** Loads and locks the SOW, refusing anything that is not one. */
async function sowFor(tx: Tx, id: string): Promise<Sow> {
  const sow = await repo.lockSow(tx, id);
  if (!sow) throw notFound("That agreement");
  if (sow.kind !== "sow") throw new AppError(409, "not_a_sow", "Only a SOW has milestones, change requests and consultants.");
  return sow;
}
/** Everything on a SOW is recorded in the SOW's own history. */
const record = (tx: Tx, sow: Sow, by: User, changes: Changes) =>
  Object.keys(changes).length
    ? audit(tx, { userEmail: by.email, action: "update", entityType: "agreement", entityId: sow.id, summary: `${sow.vendorName} · ${sow.title}`, changes })
    : Promise.resolve();
const prefixed = (label: string, changes: Changes): Changes => Object.fromEntries(Object.entries(changes).map(([k, v]) => [`${label} ${k}`, v]));

export async function getDelivery(db: Queryable, sowId: string, today: Day): Promise<SowDelivery> {
  const sow = await repo.getSow(db, sowId);
  if (!sow) throw notFound("That agreement");
  if (sow.kind !== "sow") throw new AppError(409, "not_a_sow", "Only a SOW has milestones, change requests and consultants.");
  const [settings, ms, changes, people, lines, invoiced, perMilestone] = await Promise.all([
    getSettings(db),
    repo.milestonesOf(db, sowId),
    repo.changesOf(db, sowId),
    repo.consultantsOf(db, sowId),
    repo.rateLinesOf(db, sow.vendorId),
    repo.invoicedByAgreement(db, [sowId]),
    repo.invoicedByMilestone(db, sowId),
  ]);
  const approved = changes
    .filter((c) => c.status === "approved")
    .sort((a, b) => (a.decidedOn! < b.decidedOn! ? -1 : a.decidedOn! > b.decidedOn! ? 1 : a.updatedAt.getTime() - b.updatedAt.getTime()));
  const first = approved[0];
  return {
    budget: {
      ...budgetView(sow.budgetMinor, invoiced.get(sowId) ?? 0, settings.budgetWarningPct),
      originalMinor: first ? first.budgetBeforeMinor : sow.budgetMinor,
      currency: sow.currency,
    },
    endDateOriginal: first ? first.endDateBefore : sow.endDate,
    milestones: ms.map((m): Milestone => {
      const late = daysLate(m, today);
      return {
        id: m.id,
        title: m.title,
        dueDate: m.dueDate,
        status: m.status,
        deliveredOn: m.deliveredOn,
        amountMinor: m.amountMinor,
        late: late > 0,
        daysLate: late,
        invoicedMinor: perMilestone.get(m.id) ?? 0,
      };
    }),
    changeRequests: changes.map((c): ChangeRequest => ({
      id: c.id,
      title: c.title,
      description: c.description,
      requestedOn: c.requestedOn,
      budgetChangeMinor: c.budgetChangeMinor,
      newEndDate: c.newEndDate,
      status: c.status,
      decidedOn: c.decidedOn,
      decidedBy: c.decidedBy,
      budgetBeforeMinor: c.budgetBeforeMinor,
      endDateBefore: c.endDateBefore,
    })),
    consultants: people.map((p): Consultant => {
      const rate = rateFor(lines, p.role, today);
      return { id: p.id, name: p.name, role: p.role, fromDate: p.fromDate, toDate: p.toDate, dayRateMinor: rate?.dayRateMinor ?? null, currency: rate?.currency ?? null };
    }),
    roles: [...new Map(lines.map((l) => [l.role.toLowerCase(), l.role])).values()].sort((a, b) => a.localeCompare(b)),
  };
}

// ---------- Milestones (M-1)

export async function saveMilestone(db: Db, target: { sowId: string } | { milestoneId: string }, input: unknown, by: User, today: Day): Promise<SowDelivery> {
  return db.transaction(async (tx) => {
    const found = "milestoneId" in target ? await repo.getMilestone(tx, target.milestoneId) : undefined;
    if ("milestoneId" in target && !found) throw notFound("That milestone");
    const sow = await sowFor(tx, found?.sowId ?? (target as { sowId: string }).sowId);
    // Read again now that the SOW is locked, so a change is merged onto what is stored now.
    const existing = found ? await repo.getMilestone(tx, found.id) : undefined;
    // A change may send only the fields that change.
    const parsed = milestoneSchema.parse(existing ? { ...existing, ...(input as object) } : input);
    const others = (await repo.milestonesOf(tx, sow.id)).filter((m) => m.id !== existing?.id);
    const { errors, value } = checkMilestone(parsed, sow, others, today);
    if (Object.keys(errors).length) failFields(errors);
    const label = `milestone ${value.title}`;
    if (existing) {
      await repo.updateMilestone(tx, existing.id, value, by.email);
      await record(tx, sow, by, prefixed(label, diff(existing as unknown as Record<string, unknown>, value)));
    } else {
      await repo.insertMilestone(tx, sow.id, value, by.email);
      await record(tx, sow, by, { [label]: { from: null, to: "added" } });
    }
    return getDelivery(tx, sow.id, today);
  });
}

// ---------- Change requests (M-2)

export async function saveChange(db: Db, target: { sowId: string } | { changeId: string }, input: unknown, by: User, today: Day): Promise<SowDelivery> {
  return db.transaction(async (tx) => {
    const found = "changeId" in target ? await repo.getChange(tx, target.changeId) : undefined;
    if ("changeId" in target && !found) throw notFound("That change request");
    const sow = await sowFor(tx, found?.sowId ?? (target as { sowId: string }).sowId);
    // Read again now that the SOW is locked: an approval that was in progress has finished, and is seen here.
    const existing = found ? await repo.getChange(tx, found.id) : undefined;
    if (existing && existing.status !== "proposed") throw new AppError(409, "already_decided", "This change has already been decided and can no longer be edited.");
    const value = changeRequestSchema.parse(existing ? { ...existing, ...(input as object) } : input);
    if (value.requestedOn > today) failFields({ requestedOn: "The request date cannot be in the future." });
    const label = `change request ${value.title}`;
    if (existing) {
      await repo.updateChange(tx, existing.id, value, by.email);
      await record(tx, sow, by, prefixed(label, diff(existing as unknown as Record<string, unknown>, value)));
    } else {
      await repo.insertChange(tx, sow.id, value, by.email);
      await record(tx, sow, by, { [label]: { from: null, to: "proposed" } });
    }
    return getDelivery(tx, sow.id, today);
  });
}

/** Approving applies the change to the SOW's budget and end date and remembers what they were (M-2). */
export async function decideChange(db: Db, changeId: string, decision: "approved" | "rejected", by: User, today: Day): Promise<SowDelivery> {
  return db.transaction(async (tx) => {
    const change = await repo.getChange(tx, changeId);
    if (!change) throw notFound("That change request");
    const sow = await sowFor(tx, change.sowId);
    // Read again now that the SOW is locked: two people cannot both decide the same change.
    const fresh = (await repo.getChange(tx, changeId))!;
    if (fresh.status !== "proposed") throw new AppError(409, "already_decided", "This change has already been decided.");
    const changes: Changes = { [`change request ${fresh.title}`]: { from: "proposed", to: decision } };
    const decided = { status: decision, decidedOn: today, decidedBy: by.email };
    if (decision === "rejected") await repo.updateChange(tx, changeId, decided, by.email);
    else {
      const result = checkApproval(fresh, sow, Number(await repo.plannedMilestones(tx, sow.id)));
      if (result.error) throw new AppError(409, "cannot_approve", result.error);
      await repo.updateChange(tx, changeId, { ...decided, budgetBeforeMinor: sow.budgetMinor, endDateBefore: sow.endDate }, by.email);
      await repo.applyChange(tx, sow.id, { budgetMinor: result.budgetMinor, endDate: result.endDate }, by.email);
      if (result.budgetMinor !== sow.budgetMinor) changes.budgetMinor = { from: sow.budgetMinor, to: result.budgetMinor };
      if (result.endDate !== sow.endDate) changes.endDate = { from: sow.endDate, to: result.endDate };
    }
    await record(tx, sow, by, changes);
    return getDelivery(tx, sow.id, today);
  });
}

// ---------- Consultants and rate cards (M-3)

export async function saveConsultant(db: Db, target: { sowId: string } | { consultantId: string }, input: unknown, by: User, today: Day): Promise<SowDelivery> {
  return db.transaction(async (tx) => {
    const found = "consultantId" in target ? await repo.getConsultant(tx, target.consultantId) : undefined;
    if ("consultantId" in target && !found) throw notFound("That consultant");
    const sow = await sowFor(tx, found?.sowId ?? (target as { sowId: string }).sowId);
    // The vendor's rate card is checked below; lock the vendor so a role cannot be removed in the same moment.
    await tx.execute(sql`select 1 from vendors where id = ${sow.vendorId} for update`);
    const existing = found ? await repo.getConsultant(tx, found.id) : undefined;
    if (found && !existing) throw notFound("That consultant");
    if (input === null) {
      await repo.deleteConsultant(tx, existing!.id);
      await record(tx, sow, by, { [`consultant ${existing!.name}`]: { from: "listed", to: "removed" } });
      return getDelivery(tx, sow.id, today);
    }
    const value = consultantSchema.parse(existing ? { ...existing, ...(input as object) } : input);
    const lines = await repo.rateLinesOf(tx, sow.vendorId);
    if (!hasRole(lines, value.role)) failFields({ role: "Choose a role from this vendor's rate card, or add the role to the rate card first." });
    // Store the role as the rate card spells it.
    value.role = lines.find((l) => l.role.toLowerCase() === value.role.toLowerCase())!.role;
    const label = `consultant ${value.name}`;
    if (existing) {
      await repo.updateConsultant(tx, existing.id, value, by.email);
      await record(tx, sow, by, prefixed(label, diff(existing as unknown as Record<string, unknown>, value)));
    } else {
      await repo.insertConsultant(tx, sow.id, value, by.email);
      await record(tx, sow, by, { [label]: { from: null, to: `added as ${value.role}` } });
    }
    return getDelivery(tx, sow.id, today);
  });
}

export async function getRateCard(db: Queryable, vendorId: string, today: Day): Promise<RateLine[]> {
  if (!(await repo.getVendor(db, vendorId))) throw notFound("That vendor");
  const lines = await repo.rateLinesOf(db, vendorId);
  return lines.map((l) => ({
    id: l.id,
    role: l.role,
    dayRateMinor: l.dayRateMinor,
    currency: l.currency,
    validFrom: l.validFrom,
    current: rateFor(lines, l.role, today)?.id === l.id,
  }));
}

const SAME_DAY = "This role already has a rate starting on that date.";

/** Adds a rate that applies from a date, or removes a line. A rate is changed by adding a newer line, which keeps the old one on record. */
export async function saveRateLine(
  db: Db,
  target: { vendorId: string } | { lineId: string },
  input: unknown,
  by: User,
  today: Day,
  action: "update" | "import" = "update",
): Promise<RateLine[]> {
  try {
    return await db.transaction(async (tx) => {
      const existing = "lineId" in target ? await repo.getRateLine(tx, target.lineId) : undefined;
      if ("lineId" in target && !existing) throw notFound("That rate");
      const vendorId = existing?.vendorId ?? (target as { vendorId: string }).vendorId;
      await tx.execute(sql`select 1 from vendors where id = ${vendorId} for update`);
      const vendor = await repo.getVendor(tx, vendorId);
      if (!vendor) throw notFound("That vendor");
      const entry = { userEmail: by.email, action, entityType: "vendor", entityId: vendorId, summary: vendor.name };
      const lines = await repo.rateLinesOf(tx, vendorId);
      if (existing) {
        const left = lines.filter((l) => l.id !== existing.id);
        if (!hasRole(left, existing.role)) {
          const users = await repo.consultantsWithRole(tx, vendorId, existing.role);
          if (users.length)
            throw new AppError(
              409,
              "role_in_use",
              `This is the only rate for ${existing.role}, and ${users[0]!.name}${users.length > 1 ? ` and ${users.length - 1} more` : ""} still ${users.length > 1 ? "have" : "has"} that role on a SOW.`,
            );
        }
        await repo.deleteRateLine(tx, existing.id);
        await audit(tx, {
          ...entry,
          changes: { [`rate for ${existing.role} from ${existing.validFrom}`]: { from: `${formatMoney(existing.dayRateMinor, existing.currency)} a day`, to: "removed" } },
        });
      } else {
        const value = rateLineSchema.parse(input);
        await requireListed(tx, value.currency);
        if (lines.some((l) => l.role.toLowerCase() === value.role.toLowerCase() && l.validFrom === value.validFrom)) failFields({ validFrom: SAME_DAY });
        // Keep one spelling of a role per vendor.
        value.role = lines.find((l) => l.role.toLowerCase() === value.role.toLowerCase())?.role ?? value.role;
        await repo.insertRateLine(tx, vendorId, value, by.email);
        await audit(tx, {
          ...entry,
          changes: { [`rate for ${value.role} from ${value.validFrom}`]: { from: null, to: `${formatMoney(value.dayRateMinor, value.currency)} a day` } },
        });
      }
      return getRateCard(tx, vendorId, today);
    });
  } catch (e) {
    if (isUniqueViolation(e)) failFields({ validFrom: SAME_DAY });
    throw e;
  }
}

/**
 * For the agreements feature: what may not be edited directly on a SOW.
 * - Once a change request has been approved, the budget and end date only move through
 *   further change requests, so the path from the original to today stays complete.
 * - The budget may not drop below its milestones, and amounts only exist on fixed-price SOWs.
 */
export async function checkSowEdit(
  tx: Queryable,
  sowId: string,
  current: { budgetMinor: number | null; endDate: string | null },
  next: { pricing: string | null; budgetMinor: number | null; endDate: string | null },
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  if ((await repo.changesOf(tx, sowId)).some((c) => c.status === "approved")) {
    const via = "has been set by an approved change request. Add another change request to change it again.";
    if (next.budgetMinor !== current.budgetMinor) errors.budgetMinor = `This SOW's budget ${via}`;
    if (next.endDate !== current.endDate) errors.endDate = `This SOW's end date ${via}`;
  }
  const ms = (await repo.milestonesOf(tx, sowId)).filter((m) => m.status !== "cancelled" && m.amountMinor != null);
  if (!ms.length) return errors;
  if (next.pricing !== "fixed") return { ...errors, pricing: "This SOW has milestones with amounts. Remove the amounts before changing it to time and materials." };
  const planned = ms.reduce((sum, m) => sum + (m.amountMinor ?? 0), 0);
  if (next.budgetMinor != null && planned > next.budgetMinor) errors.budgetMinor ??= "The milestones add up to more than this budget.";
  return errors;
}

export { invoicedByAgreement } from "./repo";
