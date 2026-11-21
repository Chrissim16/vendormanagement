import { and, asc, eq, inArray } from "drizzle-orm";
import { agreements, milestones, renewalDecisions, vendors } from "../../../db/schema";
import type { Day } from "../../../shared/dates";
import { addMonth, monthsUpTo } from "../../../shared/performance";
import { metricRiskFlags, sowRiskFlags, WORSENING_MONTHS, type RiskSow } from "../../../shared/risks";
import { buildWarnings, sortWarnings, type Warning, type WarningAgreement, type WarningVendor } from "../../../shared/vendors";
import type { Settings } from "../../../shared/sow";
import type { Queryable } from "../../platform/ports/types";
import { getSettings } from "../settings/service";
import { currentMonth, figuresOfAll, type PerformanceContext } from "../performance/service";
import { invoicedByAgreement } from "../sow/service";

/** The facts the warning rules need, for all vendors or just the given ones. */
export async function warningInputs(db: Queryable, vendorIds?: string[]): Promise<{ vendors: WarningVendor[]; agreements: WarningAgreement[]; windows: Settings }> {
  const windows = await getSettings(db);
  if (vendorIds && vendorIds.length === 0) return { vendors: [], agreements: [], windows };
  const vs = await db
    .select({ id: vendors.id, name: vendors.name, status: vendors.status, ownerUserId: vendors.ownerUserId, ndaRequired: vendors.ndaRequired, dpaRequired: vendors.dpaRequired })
    .from(vendors)
    .where(vendorIds ? inArray(vendors.id, vendorIds) : undefined);
  const as = await db
    .select({
      id: agreements.id,
      vendorId: agreements.vendorId,
      title: agreements.title,
      ownerUserId: agreements.ownerUserId,
      kind: agreements.kind,
      status: agreements.status,
      endDate: agreements.endDate,
      noticePeriodDays: agreements.noticePeriodDays,
      budgetMinor: agreements.budgetMinor,
      currency: agreements.currency,
      decisionId: renewalDecisions.id,
    })
    .from(agreements)
    .leftJoin(renewalDecisions, and(eq(renewalDecisions.agreementId, agreements.id), eq(renewalDecisions.termEndDate, agreements.endDate)))
    .where(vendorIds ? inArray(agreements.vendorId, vendorIds) : undefined);
  const invoiced = await invoicedByAgreement(
    db,
    as.filter((a) => a.kind === "sow" && a.status === "active").map((a) => a.id),
  );
  return { vendors: vs, agreements: as.map(({ decisionId, ...a }) => ({ ...a, decidedForTerm: decisionId !== null, invoicedMinor: invoiced.get(a.id) ?? 0 })), windows };
}

export async function listWarnings(db: Queryable, today: Day): Promise<Warning[]> {
  const input = await warningInputs(db);
  return buildWarnings(input.vendors, input.agreements, today, input.windows);
}

/** Active SOWs with what the risk rules need: pace of invoicing and the milestones still open. */
export async function riskSows(db: Queryable, vendorIds?: string[]): Promise<RiskSow[]> {
  if (vendorIds && vendorIds.length === 0) return [];
  const sows = await db
    .select({
      id: agreements.id,
      vendorId: agreements.vendorId,
      vendorName: vendors.name,
      title: agreements.title,
      ownerUserId: agreements.ownerUserId,
      pricing: agreements.pricing,
      startDate: agreements.startDate,
      endDate: agreements.endDate,
      budgetMinor: agreements.budgetMinor,
      currency: agreements.currency,
    })
    .from(agreements)
    .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
    .where(and(eq(agreements.kind, "sow"), eq(agreements.status, "active"), vendorIds ? inArray(agreements.vendorId, vendorIds) : undefined));
  if (!sows.length) return [];
  const ids = sows.map((s) => s.id);
  const [invoiced, open] = await Promise.all([
    invoicedByAgreement(db, ids),
    db
      .select({ sowId: milestones.sowId, title: milestones.title, dueDate: milestones.dueDate })
      .from(milestones)
      .where(and(inArray(milestones.sowId, ids), eq(milestones.status, "open")))
      .orderBy(asc(milestones.dueDate)),
  ]);
  return sows.map((s) => ({
    ...s,
    invoicedMinor: invoiced.get(s.id) ?? 0,
    openMilestones: open.filter((m) => m.sowId === s.id).map(({ title, dueDate }) => ({ title, dueDate })),
  }));
}

/** The risk flags (R-1), for all vendors or just the given ones. Metrics are judged on whole months only. */
export async function listRiskFlags(ctx: PerformanceContext, vendorIds?: string[]): Promise<Warning[]> {
  const today = ctx.today();
  const months = monthsUpTo(addMonth(currentMonth(ctx), -1), WORSENING_MONTHS + 1);
  const [settings, sows, figures, owners] = await Promise.all([
    getSettings(ctx.db),
    riskSows(ctx.db, vendorIds),
    figuresOfAll(ctx, months, vendorIds),
    ctx.db.select({ id: vendors.id, ownerUserId: vendors.ownerUserId }).from(vendors),
  ]);
  const ownerOf = new Map(owners.map((o) => [o.id, o.ownerUserId]));
  return [...sowRiskFlags(sows, today, settings.sowEndDays), ...metricRiskFlags(figures.map((f) => ({ ...f, ownerUserId: ownerOf.get(f.vendorId)! })))];
}

/** Everything that needs attention: the warnings (A-7) and the risk flags (R-1), what is already wrong first. */
export async function listAttention(ctx: PerformanceContext, vendorIds?: string[]): Promise<Warning[]> {
  const [input, flags] = await Promise.all([warningInputs(ctx.db, vendorIds), listRiskFlags(ctx, vendorIds)]);
  return sortWarnings([...buildWarnings(input.vendors, input.agreements, ctx.today(), input.windows), ...flags]);
}
