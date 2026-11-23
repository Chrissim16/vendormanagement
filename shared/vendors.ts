import { z } from "zod";
import { inPlace, noticeDeadline, renewalState, statusLabels, WINDOWS, type AgreementStatus, type Kind, type Windows } from "./agreements";
import { formatMoney, type Currency } from "./money";
import { budgetView } from "./sow";
import { daysBetween, formatDay, type Day } from "./dates";

export const vendorTypes = ["software", "consultancy", "advisory"] as const;
export type VendorType = (typeof vendorTypes)[number];
export const vendorTypeLabels: Record<VendorType, string> = { software: "Software", consultancy: "Consultancy", advisory: "Advisory" };
export const vendorStatuses = ["prospect", "active", "on_hold", "offboarded"] as const;
export type VendorStatus = (typeof vendorStatuses)[number];
export const vendorStatusLabels: Record<VendorStatus, string> = { prospect: "Prospect", active: "Active", on_hold: "On hold", offboarded: "Offboarded" };

const optionalText = (max: number) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable()).default(null);

/** Names are compared ignoring case and extra spaces. */
export const cleanName = (name: string) => name.trim().replace(/\s+/g, " ");

/** A VAT or tax number as stored: capitals, without spaces, dots or dashes. */
export const cleanVat = (vat: string) => vat.toUpperCase().replace(/[\s.-]/g, "");

export const vendorSchema = z.object({
  name: z.string().transform(cleanName).pipe(z.string().min(1, "Give the vendor a name.").max(200)),
  legalName: optionalText(200),
  type: z.enum(vendorTypes, "Choose a type."),
  status: z.enum(vendorStatuses).default("active"),
  ownerUserId: z.string().uuid("Choose an owner."),
  website: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z
        .string()
        .trim()
        .max(300)
        .regex(/^https?:\/\/\S+\.\S+$/i, "Enter a web address starting with https://")
        .nullable(),
    )
    .default(null),
  addressLine1: optionalText(200),
  addressLine2: optionalText(200),
  postalCode: optionalText(20),
  city: optionalText(100),
  country: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim().toUpperCase() : v),
      z
        .string()
        .regex(/^[A-Z]{2}$/, "Use a two-letter country code, such as NL.")
        .nullable(),
    )
    .default(null),
  vatNumber: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z
        .string()
        .trim()
        .max(40)
        .regex(/^[A-Za-z0-9 .-]+$/, "Use only letters, digits, spaces, dots and dashes.")
        .transform(cleanVat)
        .pipe(z.string().min(2, "Enter the whole VAT or tax number."))
        .nullable(),
    )
    .default(null),
  description: optionalText(2000),
  notes: optionalText(5000),
  scoringEnabled: z.boolean().default(true),
  ndaRequired: z.boolean().default(true),
  dpaRequired: z.boolean().default(true),
});
export type VendorInput = z.infer<typeof vendorSchema>;

/** A contact role's name (V-7), stored with extra spaces removed and compared ignoring case. Up to 200 characters, as job titles were, so no title carried over from before can block a contact. */
export const roleNameSchema = z.string().transform(cleanName).pipe(z.string().min(1, "Give the role a name.").max(200, "Keep the role to 200 characters."));

/** Role names as a contact holds them: each once (ignoring case), A to Z. */
export function cleanRoles(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of names) if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  return [...seen.values()].sort(byName);
}
/** A to Z, ignoring case. */
export const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Give the contact a name.").max(200),
  roles: z.array(roleNameSchema).max(12, "Choose at most 12 roles.").transform(cleanRoles).default([]),
  email: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.email("Enter a valid email address.").max(200).nullable()).default(null),
  phone: optionalText(50),
  isPrimary: z.boolean().default(false),
});
export type ContactInput = z.infer<typeof contactSchema>;

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
/**
 * A new vendor with its main contact (V-6). The contact is optional: left empty, the vendor is
 * saved without one. Anything filled in without a name is pointed out, not dropped.
 */
export const newVendorSchema = vendorSchema.extend({
  mainContact: z.preprocess((v) => (v && typeof v === "object" && Object.values(v).every(blank) ? undefined : v), contactSchema.omit({ isPrimary: true }).optional()),
});

/** A vendor's address as the lines it is written on; the country is the last line. Empty when none is given. */
export const addressLines = (v: Pick<VendorInput, "addressLine1" | "addressLine2" | "postalCode" | "city" | "country">): string[] =>
  [v.addressLine1, v.addressLine2, [v.postalCode, v.city].filter(Boolean).join(" "), v.country].filter((x): x is string => !!x);

export interface Contact extends ContactInput {
  id: string;
}

export interface ContactRole {
  id: string;
  name: string;
  /** How many contacts hold it. */
  contacts: number;
}

export type Paperwork = "in_place" | "missing" | "expired" | "not_required";

export interface Vendor extends VendorInput {
  id: string;
  ownerName: string;
  activeAgreements: number;
  nda: Paperwork;
  dpa: Paperwork;
  warnings: number;
  createdAt: string;
}
export interface VendorDetail extends Vendor {
  contacts: Contact[];
}

interface Paper {
  kind: Kind;
  status: AgreementStatus;
  endDate: Day | null;
}

/** Whether the vendor's NDA or data processing agreement is in place. */
export function paperwork(kind: "nda" | "dpa", required: boolean, agreements: Paper[], today: Day): Paperwork {
  if (!required) return "not_required";
  const mine = agreements.filter((a) => a.kind === kind);
  if (mine.some((a) => inPlace(a, today))) return "in_place";
  return mine.some((a) => a.status === "active") ? "expired" : "missing";
}

export const warningTypes = [
  "renewal_overdue",
  "renewal_due",
  "sow_past_end",
  "sow_ending",
  "budget_overrun",
  "budget_warning",
  "nda_expired",
  "nda_missing",
  "dpa_expired",
  "dpa_missing",
  // Risk flags (R-1): not wrong yet, but heading that way. The rules are in `risks.ts`.
  "risk_budget_trend",
  "risk_open_milestones",
  "risk_metric_worsening",
] as const;
export type WarningType = (typeof warningTypes)[number];
/** What each kind of warning is called where they are counted by kind. */
export const warningTypeLabels: Record<WarningType, string> = {
  renewal_overdue: "Notice deadline passed",
  renewal_due: "Notice deadline coming up",
  sow_past_end: "SOW past its end date",
  sow_ending: "SOW ending soon",
  budget_overrun: "Over budget",
  budget_warning: "Close to budget",
  nda_expired: "NDA expired",
  nda_missing: "NDA missing",
  dpa_expired: "Data processing agreement expired",
  dpa_missing: "Data processing agreement missing",
  risk_budget_trend: "Heading over budget",
  risk_open_milestones: "Ending with open milestones",
  risk_metric_worsening: "Helpdesk figure getting worse",
};
export const isRiskFlag = (w: Pick<Warning, "type">) => w.type.startsWith("risk_");

export interface Warning {
  type: WarningType;
  tone: "bad" | "warn";
  /** The short label on the pill. */
  label: string;
  /** What it is about. */
  title: string;
  /** The fact that triggered it. */
  detail: string;
  vendorId: string;
  vendorName: string;
  agreementId: string | null;
  ownerUserId: string;
  /** The date it turns on, for sorting soonest first. */
  date: Day | null;
}

/**
 * A-7: where a warning leads, the same on the warnings page and in Ask. An agreement's
 * warning opens the agreement; a worsening metric the vendor's performance; a missing NDA
 * or DPA with none under way opens the form to add one; anything else the vendor.
 */
export const warningLink = (w: Pick<Warning, "agreementId" | "type" | "vendorId">) =>
  w.agreementId
    ? `/agreements/${w.agreementId}`
    : w.type === "risk_metric_worsening"
      ? `/performance/${w.vendorId}`
      : w.type === "nda_missing" || w.type === "dpa_missing"
        ? `/vendors?open=${w.vendorId}&add=${w.type.slice(0, 3)}`
        : `/vendors?open=${w.vendorId}`;

export interface WarningVendor {
  id: string;
  name: string;
  status: VendorStatus;
  ownerUserId: string;
  ndaRequired: boolean;
  dpaRequired: boolean;
}
export interface WarningAgreement extends Paper {
  id: string;
  vendorId: string;
  title: string;
  ownerUserId: string;
  noticePeriodDays: number | null;
  /** A renewal decision exists for the term ending on `endDate`. */
  decidedForTerm: boolean;
  /** For a SOW: its budget, what has been invoiced against it, and the currency of both. */
  budgetMinor?: number | null;
  invoicedMinor?: number;
  currency?: Currency;
}

/** The statuses of an agreement that is being worked on but not yet signed, from furthest away to closest. */
const underWay: AgreementStatus[] = ["draft", "in_negotiation", "out_for_signature"];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Everything that needs attention today (A-7). Pure, so it can be tested without a database. */
export function buildWarnings(vendors: WarningVendor[], agreements: WarningAgreement[], today: Day, windows: Windows = WINDOWS): Warning[] {
  const byVendor = new Map(vendors.map((v) => [v.id, v]));
  const out: Warning[] = [];
  for (const a of agreements) {
    const v = byVendor.get(a.vendorId);
    if (!v || a.status !== "active") continue;
    const base = { vendorId: v.id, vendorName: v.name, agreementId: a.id, ownerUserId: a.ownerUserId, title: `${v.name} · ${a.title}` };
    if (a.kind === "subscription") {
      const state = renewalState(a, today, a.decidedForTerm, windows.noticeDays);
      const deadline = noticeDeadline(a)!;
      if (state === "overdue")
        out.push({
          ...base,
          type: "renewal_overdue",
          tone: "bad",
          label: "Overdue",
          detail: `The notice deadline passed on ${formatDay(deadline)}. It renews on ${formatDay(a.endDate!)}.`,
          date: deadline,
        });
      if (state === "due_soon") {
        const left = daysBetween(today, deadline);
        out.push({
          ...base,
          type: "renewal_due",
          tone: "warn",
          label: left === 0 ? "Today" : plural(left, "day"),
          detail: `The notice deadline is ${formatDay(deadline)}. It renews on ${formatDay(a.endDate!)}.`,
          date: deadline,
        });
      }
    }
    if (a.kind === "sow" && a.budgetMinor != null && a.currency) {
      const b = budgetView(a.budgetMinor, a.invoicedMinor ?? 0, windows.budgetWarningPct);
      const invoiced = formatMoney(b.invoicedMinor, a.currency);
      const budget = formatMoney(a.budgetMinor, a.currency);
      if (b.state === "over")
        out.push({ ...base, type: "budget_overrun", tone: "bad", label: "Over budget", detail: `${invoiced} has been invoiced against a budget of ${budget}.`, date: null });
      if (b.state === "warn")
        out.push({
          ...base,
          type: "budget_warning",
          tone: "warn",
          label: `${b.usedPct}% of budget used`,
          detail: `${invoiced} of the ${budget} budget has been invoiced.`,
          date: a.endDate,
        });
    }
    if (a.kind === "sow" && a.endDate) {
      const left = daysBetween(today, a.endDate);
      if (left < 0)
        out.push({
          ...base,
          type: "sow_past_end",
          tone: "bad",
          label: "Past end date",
          detail: `It ended on ${formatDay(a.endDate)} but is still marked active.`,
          date: a.endDate,
        });
      else if (left <= windows.sowEndDays)
        out.push({
          ...base,
          type: "sow_ending",
          tone: "warn",
          label: left === 0 ? "Ends today" : `Ends in ${plural(left, "day")}`,
          detail: `It ends on ${formatDay(a.endDate)}.`,
          date: a.endDate,
        });
    }
  }
  for (const v of vendors) {
    if (v.status !== "active") continue;
    const mine = agreements.filter((a) => a.vendorId === v.id);
    for (const kind of ["nda", "dpa"] as const) {
      const state = paperwork(kind, kind === "nda" ? v.ndaRequired : v.dpaRequired, mine, today);
      if (state !== "missing" && state !== "expired") continue;
      const name = kind === "nda" ? "NDA" : "Data processing agreement";
      const short = kind === "nda" ? "NDA" : "DPA";
      const expired = mine.filter((a) => a.kind === kind && a.status === "active" && a.endDate).sort((x, y) => (x.endDate! < y.endDate! ? 1 : -1))[0];
      // One already being worked on is what needs doing, so the warning leads there; the one closest to signed wins.
      const coming = mine
        .filter((a) => a.kind === kind && underWay.includes(a.status))
        .sort((x, y) => underWay.indexOf(y.status) - underWay.indexOf(x.status) || x.title.localeCompare(y.title))[0];
      const fact =
        state === "expired"
          ? `${name} expired on ${expired?.endDate ? formatDay(expired.endDate) : "an unknown date"}.`
          : `No ${kind === "nda" ? "NDA" : "data processing agreement"} is in place.`;
      out.push({
        type: `${kind}_${state}`,
        tone: state === "expired" ? "bad" : "warn",
        label: `${short} ${state}`,
        title: v.name,
        detail: coming ? `${fact} “${coming.title}” is ${coming.status === "draft" ? "still a draft" : statusLabels[coming.status].toLowerCase()}.` : fact,
        vendorId: v.id,
        vendorName: v.name,
        agreementId: coming?.id ?? expired?.id ?? null,
        ownerUserId: v.ownerUserId,
        date: expired?.endDate ?? null,
      });
    }
  }
  return sortWarnings(out);
}

/** What is already wrong first, then the soonest date. */
export function sortWarnings(out: Warning[]): Warning[] {
  const rank = (w: Warning) => (w.tone === "bad" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.title.localeCompare(b.title));
}
