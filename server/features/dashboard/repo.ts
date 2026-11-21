import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { agreements, vendors } from "../../../db/schema";
import type { Day } from "../../../shared/dates";
import type { Queryable } from "../../platform/ports/types";

/**
 * SOWs with a budget and what has been invoiced on them. Without `period`: the SOWs that
 * are active now, with everything invoiced so far. With it: the SOWs that ran at some
 * point between `from` and `asAt`, with what was invoiced up to `asAt`.
 */
export const sowBudgets = (db: Queryable, o: { period?: { from: Day; asAt: Day }; vendorId?: string } = {}) =>
  db
    .select({
      agreementId: agreements.id,
      vendorId: agreements.vendorId,
      vendorName: vendors.name,
      title: agreements.title,
      currency: agreements.currency,
      endDate: agreements.endDate,
      budgetMinor: agreements.budgetMinor,
      // Written out with table names: inside a sub-select, bare column names would be read as the invoice's own.
      invoicedMinor: o.period
        ? sql<number>`(select coalesce(sum(i.amount_minor), 0) from invoices i where i.agreement_id = "agreements"."id" and i.invoice_date <= ${o.period.asAt})::bigint`
        : sql<number>`(select coalesce(sum(i.amount_minor), 0) from invoices i where i.agreement_id = "agreements"."id")::bigint`,
    })
    .from(agreements)
    .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
    .where(
      and(
        eq(agreements.kind, "sow"),
        sql`${agreements.budgetMinor} is not null`,
        o.vendorId ? eq(agreements.vendorId, o.vendorId) : undefined,
        o.period
          ? and(
              inArray(agreements.status, ["active", "ended"]),
              or(isNull(agreements.startDate), lte(agreements.startDate, o.period.asAt)),
              // One still marked active counts as running even past its end date; an ended one must have ended inside the period or later.
              or(eq(agreements.status, "active"), isNull(agreements.endDate), gte(agreements.endDate, o.period.from)),
            )
          : eq(agreements.status, "active"),
      ),
    );

/** Active agreements whose end date falls between two days, soonest first. */
export const agreementsEnding = (db: Queryable, from: Day, to: Day) =>
  db
    .select({
      agreementId: agreements.id,
      vendorName: vendors.name,
      kind: agreements.kind,
      title: agreements.title,
      endDate: agreements.endDate,
      noticePeriodDays: agreements.noticePeriodDays,
    })
    .from(agreements)
    .innerJoin(vendors, eq(vendors.id, agreements.vendorId))
    .where(and(eq(agreements.status, "active"), gte(agreements.endDate, from), lte(agreements.endDate, to)))
    .orderBy(agreements.endDate, sql`lower(${vendors.name})`, sql`lower(${agreements.title})`);

/** Vendors in use that are scored: the ones a scorecard is expected for. */
export const scoredVendors = (db: Queryable) =>
  db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(and(eq(vendors.scoringEnabled, true), inArray(vendors.status, ["active", "on_hold"])))
    .orderBy(sql`lower(${vendors.name})`);
