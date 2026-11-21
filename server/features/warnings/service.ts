import { and, eq, inArray } from "drizzle-orm";
import { agreements, renewalDecisions, vendors } from "../../../db/schema";
import type { Day } from "../../../shared/dates";
import { buildWarnings, type Warning, type WarningAgreement, type WarningVendor } from "../../../shared/vendors";
import type { Queryable } from "../../platform/ports/types";

/** The facts the warning rules need, for all vendors or just the given ones. */
export async function warningInputs(db: Queryable, vendorIds?: string[]): Promise<{ vendors: WarningVendor[]; agreements: WarningAgreement[] }> {
  if (vendorIds && vendorIds.length === 0) return { vendors: [], agreements: [] };
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
      decisionId: renewalDecisions.id,
    })
    .from(agreements)
    .leftJoin(renewalDecisions, and(eq(renewalDecisions.agreementId, agreements.id), eq(renewalDecisions.termEndDate, agreements.endDate)))
    .where(vendorIds ? inArray(agreements.vendorId, vendorIds) : undefined);
  return { vendors: vs, agreements: as.map(({ decisionId, ...a }) => ({ ...a, decidedForTerm: decisionId !== null })) };
}

export async function listWarnings(db: Queryable, today: Day): Promise<Warning[]> {
  const input = await warningInputs(db);
  return buildWarnings(input.vendors, input.agreements, today);
}
