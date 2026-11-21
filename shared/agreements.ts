import { z } from "zod";
import { addDays, addMonths, daysBetween, isDay, type Day } from "./dates";
import { currencies, type Currency } from "./money";
import { DEFAULT_SETTINGS } from "./sow";

export const kinds = ["msa", "sow", "subscription", "nda", "dpa"] as const;
export type Kind = (typeof kinds)[number];
export const kindLabels: Record<Kind, string> = { msa: "MSA", sow: "SOW", subscription: "Subscription", nda: "NDA", dpa: "Data processing agreement" };

/** For pills in lists, where the full name does not fit. */
export const kindShort: Record<Kind, string> = { ...kindLabels, dpa: "DPA" };

export const agreementStatuses = ["draft", "in_negotiation", "out_for_signature", "active", "ended"] as const;
export type AgreementStatus = (typeof agreementStatuses)[number];
export const statusLabels: Record<AgreementStatus, string> = {
  draft: "Draft",
  in_negotiation: "In negotiation",
  out_for_signature: "Out for signature",
  active: "Active",
  ended: "Ended",
};

export const endReasons = ["completed", "expired", "terminated", "replaced"] as const;
export type EndReason = (typeof endReasons)[number];
export const pricings = ["fixed", "time_and_materials"] as const;
export const pricingLabels = { fixed: "Fixed price", time_and_materials: "Time and materials" } as const;
export const decisions = ["renew", "renegotiate", "terminate"] as const;
export type Decision = (typeof decisions)[number];

export const DEFAULT_NOTICE_DAYS = 90;
/** The warning windows used when no settings are passed in: the same defaults the Settings page starts from. */
export const WINDOWS = { noticeDays: DEFAULT_SETTINGS.noticeDays, sowEndDays: DEFAULT_SETTINGS.sowEndDays, budgetWarningPct: DEFAULT_SETTINGS.budgetWarningPct };
export type Windows = typeof WINDOWS;

const day = z.string().refine(isDay, "Enter a real date.");
const optionalDay = z.preprocess((v) => (v === "" || v === undefined ? null : v), day.nullable());
const optionalText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable()).default(null);
const money = z.number().int("Enter an amount.").min(0, "An amount cannot be negative.").max(9_000_000_000_00, "That amount is too large.");

/** Everything an agreement can hold. Which fields apply depends on the kind; `checkAgreement` enforces that. */
export const agreementSchema = z.object({
  vendorId: z.string().uuid(),
  kind: z.enum(kinds),
  title: z.string().trim().min(1, "Give the agreement a title.").max(200),
  reference: optionalText(100),
  status: z.enum(agreementStatuses).default("draft"),
  ownerUserId: z.string().uuid("Choose an owner."),
  currency: z.enum(currencies).default("EUR"),
  signedOn: optionalDay.default(null),
  startDate: optionalDay.default(null),
  endDate: optionalDay.default(null),
  endReason: z.enum(endReasons).nullable().default(null),
  notes: optionalText(5000),
  parentMsaId: z.string().uuid().nullable().default(null),
  pricing: z.enum(pricings).nullable().default(null),
  budgetMinor: money.nullable().default(null),
  annualValueMinor: money.nullable().default(null),
  noticePeriodDays: z.number().int().min(0, "Notice period cannot be negative.").max(730, "Notice period is at most 730 days.").nullable().default(null),
  autoRenews: z.boolean().nullable().default(null),
  renewalTermMonths: z.number().int().min(1).max(120).nullable().default(null),
});
export type AgreementInput = z.infer<typeof agreementSchema>;
export type AgreementFields = Omit<AgreementInput, "vendorId">;

/**
 * The rules that depend on the kind and status. Returns a message per field that is wrong;
 * an empty object means the agreement is valid. Also clears fields that do not belong to
 * the kind, so an MSA can never carry a budget.
 */
export function checkAgreement(a: AgreementInput): { errors: Record<string, string>; value: AgreementInput } {
  const v = { ...a };
  const errors: Record<string, string> = {};
  if (v.kind !== "sow") Object.assign(v, { parentMsaId: null, pricing: null, budgetMinor: null });
  if (v.kind !== "subscription") Object.assign(v, { annualValueMinor: null, noticePeriodDays: null, autoRenews: null, renewalTermMonths: null });
  // Signed-on and valid-until are the only dates an NDA or data processing agreement has.
  if (v.kind === "nda" || v.kind === "dpa") v.startDate = null;

  if (v.kind === "msa") {
    // An MSA runs until someone ends it; the end date is only filled when it has ended.
    if (v.status !== "ended") v.endDate = null;
  }
  if (v.kind === "sow") {
    if (!v.pricing) errors.pricing = "Choose fixed price or time and materials.";
    if (v.budgetMinor == null) errors.budgetMinor = "Enter the budget.";
    if (!v.startDate) errors.startDate = "A SOW needs a start date.";
    if (!v.endDate) errors.endDate = "A SOW needs an end date.";
  }
  if (v.kind === "subscription") {
    if (v.annualValueMinor == null) errors.annualValueMinor = "Enter the annual value.";
    if (!v.endDate) errors.endDate = "A subscription needs its renewal date.";
    v.noticePeriodDays ??= DEFAULT_NOTICE_DAYS;
    v.autoRenews ??= false;
    v.renewalTermMonths ??= 12;
  }

  if (v.startDate && v.endDate && v.endDate < v.startDate) errors.endDate = "The end date is before the start date.";
  if (v.status === "active") {
    if (!v.signedOn) errors.signedOn ??= "An active agreement needs the date it was signed.";
    if (v.kind === "subscription" && !v.startDate) errors.startDate ??= "An active subscription needs a start date.";
  }
  if (v.status === "ended") {
    if (!v.endReason) errors.endReason = "Say why it ended.";
  } else v.endReason = null;
  return { errors, value: v };
}

interface Dated {
  kind: Kind;
  status: AgreementStatus;
  endDate: Day | null;
  noticePeriodDays?: number | null;
}

/** The last day to cancel or renegotiate a subscription. */
export const noticeDeadline = (a: Dated): Day | null => (a.kind === "subscription" && a.endDate ? addDays(a.endDate, -(a.noticePeriodDays ?? DEFAULT_NOTICE_DAYS)) : null);

export type RenewalState = "overdue" | "due_soon" | "ok" | "none";

/**
 * Where a subscription stands. `decidedForTerm` is true when a renewal decision has been
 * recorded for the term that ends on the current end date.
 */
export function renewalState(a: Dated, today: Day, decidedForTerm: boolean, windowDays: number = WINDOWS.noticeDays): RenewalState {
  const deadline = noticeDeadline(a);
  if (!deadline || a.status !== "active") return "none";
  if (decidedForTerm) return "ok";
  const left = daysBetween(today, deadline);
  return left < 0 ? "overdue" : left <= windowDays ? "due_soon" : "ok";
}

/** An NDA or data processing agreement counts as in place when it is active and not past its valid-until date. */
export const inPlace = (a: Dated, today: Day) => a.status === "active" && (!a.endDate || a.endDate >= today);

/** The next term after a renewal: the end date moves forward by the renewal term. */
export const nextTermEnd = (endDate: Day, renewalTermMonths: number | null | undefined): Day => addMonths(endDate, renewalTermMonths ?? 12);

export const decisionSchema = z.object({
  decision: z.enum(decisions),
  decidedOn: day,
  notes: optionalText(2000),
  /** With `renew`: also move the dates forward by the renewal term. */
  rollForward: z.boolean().default(false),
});
export type DecisionInput = z.infer<typeof decisionSchema>;

export const documentTypes: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export interface Agreement extends AgreementFields {
  id: string;
  vendorId: string;
  vendorName: string;
  ownerName: string;
  createdAt: string;
  noticeDeadline: Day | null;
  renewalState: RenewalState;
  /** A renewal decision has been recorded for the term that ends on the current end date. */
  decidedForTerm: boolean;
}
export interface DocumentInfo {
  id: string;
  title: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  createdBy: string | null;
}
export interface DecisionInfo {
  id: string;
  decision: Decision;
  decidedOn: Day;
  decidedBy: string;
  notes: string | null;
  termEndDate: Day;
}
export interface AgreementDetail extends Agreement {
  /** Everything invoiced against this agreement so far, in its own currency. */
  invoicedMinor: number;
  parent: { id: string; title: string } | null;
  children: { id: string; title: string; status: AgreementStatus; endDate: Day | null; budgetMinor: number | null; currency: Currency }[];
  documents: DocumentInfo[];
  decisions: DecisionInfo[];
}
