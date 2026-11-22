import { z } from "zod";
import { isDay, type Day } from "./dates";
import { addMoney, currencyCode, noMoney, ratesUsed, type Currency, type Money, type Rate, type Rates } from "./money";

const day = z.string().refine(isDay, "Enter a real date.");
const optionalDay = z.preprocess((v) => (v === "" || v === undefined ? null : v), day.nullable()).default(null);
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max, "That is too long.").nullable()).default(null);
const amount = z.number("Enter an amount.").int("Enter an amount.").max(9_000_000_000_00, "That amount is too large.");

// ---------- Settings

/** What an admin can tune. The defaults are the ones the PRD names. The currencies and their rates are a list of their own (M-8). */
export const settingsSchema = z.object({
  noticeDays: z.number("Enter a number of days.").int().min(1, "Use at least 1 day.").max(365, "Use at most 365 days."),
  sowEndDays: z.number("Enter a number of days.").int().min(1, "Use at least 1 day.").max(365, "Use at most 365 days."),
  budgetWarningPct: z.number("Enter a percentage.").int().min(1, "Use at least 1%.").max(100, "Use at most 100%."),
});
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = { noticeDays: 90, sowEndDays: 30, budgetWarningPct: 80 };

// ---------- Budget

export type BudgetState = "ok" | "warn" | "over" | "none";
export interface BudgetView {
  budgetMinor: number | null;
  invoicedMinor: number;
  remainingMinor: number | null;
  /** Whole per cent, rounded down so 79.9% never reads as 80%. Null when there is no budget to compare with. */
  usedPct: number | null;
  state: BudgetState;
}

/** Budget against invoiced (M-5). Compared exactly, in cents: no rounding decides a warning. */
export function budgetView(budgetMinor: number | null, invoicedMinor: number, warningPct: number): BudgetView {
  if (budgetMinor == null) return { budgetMinor, invoicedMinor, remainingMinor: null, usedPct: null, state: "none" };
  const over = invoicedMinor > budgetMinor;
  const warn = !over && invoicedMinor > 0 && invoicedMinor * 100 >= budgetMinor * warningPct;
  return {
    budgetMinor,
    invoicedMinor,
    remainingMinor: budgetMinor - invoicedMinor,
    usedPct: budgetMinor > 0 ? Math.floor((invoicedMinor * 100) / budgetMinor) : null,
    state: over ? "over" : warn ? "warn" : "ok",
  };
}

// ---------- Milestones

export const milestoneStatuses = ["open", "delivered", "cancelled"] as const;
export type MilestoneStatus = (typeof milestoneStatuses)[number];

export const milestoneSchema = z.object({
  title: z.string().trim().min(1, "Give the milestone a title.").max(200, "That is too long."),
  dueDate: day,
  status: z.enum(milestoneStatuses).default("open"),
  deliveredOn: optionalDay,
  amountMinor: amount.min(0, "An amount cannot be negative.").nullable().default(null),
});
export type MilestoneInput = z.infer<typeof milestoneSchema>;
export interface Milestone extends MilestoneInput {
  id: string;
  late: boolean;
  /** Days late: delivered after the due date, or still open past it. Zero when on time. */
  daysLate: number;
  invoicedMinor: number;
}

const DAY_MS = 86_400_000;
const days = (from: Day, to: Day) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Late means delivered after the due date, or still open once the due date has passed. A cancelled milestone is never late. */
export function daysLate(m: Pick<MilestoneInput, "status" | "dueDate" | "deliveredOn">, today: Day): number {
  if (m.status === "cancelled") return 0;
  const end = m.status === "delivered" ? (m.deliveredOn ?? m.dueDate) : today;
  return Math.max(0, days(m.dueDate, end));
}

/**
 * The rules for one milestone on its SOW. `others` are the SOW's other milestones.
 * Returns a message per field that is wrong; also tidies fields that depend on the status.
 */
export function checkMilestone(
  m: MilestoneInput,
  sow: { pricing: "fixed" | "time_and_materials" | null; budgetMinor: number | null },
  others: Pick<MilestoneInput, "status" | "amountMinor">[],
  today: Day,
): { errors: Record<string, string>; value: MilestoneInput } {
  const v = { ...m };
  const errors: Record<string, string> = {};
  if (v.status === "delivered") {
    v.deliveredOn ??= today;
    if (v.deliveredOn > today) errors.deliveredOn = "The delivery date cannot be in the future.";
  } else v.deliveredOn = null;
  if (sow.pricing !== "fixed") {
    if (v.amountMinor != null) errors.amountMinor = "Only a fixed-price SOW has milestone amounts.";
  } else if (v.status !== "cancelled" && v.amountMinor != null && sow.budgetMinor != null) {
    const planned = others.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + (o.amountMinor ?? 0), 0) + v.amountMinor;
    if (planned > sow.budgetMinor) errors.amountMinor = "With this amount the milestones add up to more than the SOW budget.";
  }
  return { errors, value: v };
}

// ---------- Change requests

export const changeStatuses = ["proposed", "approved", "rejected"] as const;
export type ChangeStatus = (typeof changeStatuses)[number];

export const changeRequestSchema = z
  .object({
    title: z.string().trim().min(1, "Give the change a title.").max(200, "That is too long."),
    description: optionalText(2000),
    requestedOn: day,
    /** May be negative, for a reduction. */
    budgetChangeMinor: amount.min(-9_000_000_000_00).nullable().default(null),
    newEndDate: optionalDay,
  })
  .refine((v) => (v.budgetChangeMinor ?? 0) !== 0 || v.newEndDate !== null, { path: ["budgetChangeMinor"], message: "Enter a budget change, a new end date, or both." });
export type ChangeRequestInput = z.infer<typeof changeRequestSchema>;
export interface ChangeRequest extends ChangeRequestInput {
  id: string;
  status: ChangeStatus;
  decidedOn: Day | null;
  decidedBy: string | null;
  /** What the SOW held just before this change was approved. */
  budgetBeforeMinor: number | null;
  endDateBefore: Day | null;
}

/** Whether a change can be approved against the SOW as it stands now. */
export function checkApproval(
  change: Pick<ChangeRequestInput, "budgetChangeMinor" | "newEndDate">,
  sow: { status: string; pricing: string | null; budgetMinor: number | null; startDate: Day | null; endDate: Day | null },
  plannedMilestonesMinor: number,
): { error: string | null; budgetMinor: number | null; endDate: Day | null } {
  const budgetMinor = sow.budgetMinor == null ? null : sow.budgetMinor + (change.budgetChangeMinor ?? 0);
  const endDate = change.newEndDate ?? sow.endDate;
  let error: string | null = null;
  if (sow.status === "ended") error = "This SOW has ended, so it can no longer be changed.";
  else if (budgetMinor != null && budgetMinor < 0) error = "This change would take the budget below zero.";
  else if (sow.pricing === "fixed" && budgetMinor != null && plannedMilestonesMinor > budgetMinor)
    error = "This change would leave the budget below what the milestones add up to. Change the milestones first.";
  else if (sow.startDate && endDate && endDate < sow.startDate) error = "The new end date is before the SOW's start date.";
  return { error, budgetMinor, endDate };
}

// ---------- Rate cards and consultants

export const rateLineSchema = z.object({
  role: z.string().trim().min(1, "Name the role.").max(100, "That is too long."),
  dayRateMinor: amount.min(1, "Enter a day rate above zero."),
  currency: currencyCode.default("EUR"),
  validFrom: day,
});
export type RateLineInput = z.infer<typeof rateLineSchema>;
export interface RateLine extends RateLineInput {
  id: string;
  /** This is the line in force today for its role. */
  current: boolean;
}

const sameRole = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The rate in force for a role on a day: the latest line that has started. Null when the role has no rate yet. */
export function rateFor<T extends Pick<RateLineInput, "role" | "validFrom">>(lines: T[], role: string, on: Day): T | null {
  return lines.filter((l) => sameRole(l.role, role) && l.validFrom <= on).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0] ?? null;
}
export const hasRole = (lines: Pick<RateLineInput, "role">[], role: string) => lines.some((l) => sameRole(l.role, role));

export const consultantSchema = z
  .object({
    name: z.string().trim().min(1, "Enter the consultant's name.").max(200, "That is too long."),
    role: z.string().trim().min(1, "Choose a role from the rate card.").max(100),
    fromDate: optionalDay,
    toDate: optionalDay,
  })
  .refine((v) => !v.fromDate || !v.toDate || v.toDate >= v.fromDate, { path: ["toDate"], message: "The end date is before the start date." });
export type ConsultantInput = z.infer<typeof consultantSchema>;
export interface Consultant extends ConsultantInput {
  id: string;
  dayRateMinor: number | null;
  currency: Currency | null;
}

// ---------- Invoices and spend

export const invoiceSchema = z.object({
  agreementId: z.string().uuid("Choose the SOW or subscription this invoice is for."),
  milestoneId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()).default(null),
  invoiceNumber: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, " "))
    .pipe(z.string().min(1, "Enter the invoice number.").max(100, "That is too long.")),
  invoiceDate: day,
  amountMinor: amount.min(1, "Enter an amount above zero."),
  description: optionalText(500),
});
export type InvoiceInput = z.infer<typeof invoiceSchema>;
export interface Invoice extends InvoiceInput {
  id: string;
  vendorId: string;
  vendorName: string;
  agreementTitle: string;
  agreementKind: string;
  milestoneTitle: string | null;
  currency: Currency;
  createdBy: string | null;
}

export interface SpendRow {
  vendorId: string;
  vendorName: string;
  /** YYYY-MM */
  month: string;
  currency: Currency;
  amountMinor: number;
}
export type { Money } from "./money";
export interface Spend {
  from: Day;
  to: Day;
  /** The rates the euro totals were converted with: those of the currencies that occur, other than euros. */
  rates: Rate[];
  total: Money;
  /** Highest spend first, by the euro total. */
  byVendor: ({ vendorId: string; vendorName: string } & Money)[];
  /** Every month in the period, oldest first, including months with nothing. */
  byMonth: ({ month: string } & Money)[];
}

/** The months from one day to another, as YYYY-MM, both ends included. */
export function monthsBetween(from: Day, to: Day): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const end = to.slice(0, 7);
  for (let i = 0; i < 600; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Spend per vendor and per month (M-6). Each currency is kept apart; the euro total
 * converts each currency once, on its sum, so rounding cannot pile up row by row.
 */
export function summariseSpend(rows: SpendRow[], from: Day, to: Day, rates: Rates): Spend {
  const total = noMoney();
  const vendors = new Map<string, { vendorId: string; vendorName: string } & Money>();
  const months = new Map(monthsBetween(from, to).map((month) => [month, { month, ...noMoney() }]));
  for (const r of rows) {
    addMoney(total, r.currency, r.amountMinor, rates);
    if (!vendors.has(r.vendorId)) vendors.set(r.vendorId, { vendorId: r.vendorId, vendorName: r.vendorName, ...noMoney() });
    addMoney(vendors.get(r.vendorId)!, r.currency, r.amountMinor, rates);
    const month = months.get(r.month);
    if (month) addMoney(month, r.currency, r.amountMinor, rates);
  }
  return {
    from,
    to,
    rates: ratesUsed(total.amounts, rates),
    total,
    byVendor: [...vendors.values()].sort((a, b) => b.eurMinor - a.eurMinor || a.vendorName.localeCompare(b.vendorName)),
    byMonth: [...months.values()],
  };
}

/** What a SOW page needs beyond the agreement itself (M-1 to M-5). */
export interface SowDelivery {
  budget: BudgetView & { originalMinor: number | null; currency: Currency };
  endDateOriginal: Day | null;
  milestones: Milestone[];
  changeRequests: ChangeRequest[];
  consultants: Consultant[];
  /** Roles on the vendor's rate card, for choosing a consultant's role. */
  roles: string[];
}
