import { and, eq, inArray } from "drizzle-orm";
import { agreements, renewalDecisions, vendors } from "../../../db/schema";
import type { Day } from "../../../shared/dates";
import { buildWarnings, type Warning, type WarningAgreement, type WarningVendor } from "../../../shared/vendors";
import type { Settings } from "../../../shared/sow";
import type { Queryable } from "../../platform/ports/types";
import { getSettings } from "../settings/service";
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
