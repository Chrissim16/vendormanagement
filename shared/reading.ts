import { z } from "zod";
import { kinds, type Kind } from "./agreements";
import { isDay } from "./dates";
import { currencies, parseAmount } from "./money";
import type { TextSuggestion } from "./overview";

/**
 * Contract reading (E-1). The AI reads an uploaded document and proposes values for the
 * agreement's fields, each with the passage of the document it rests on. Nothing changes
 * on the agreement until a person ticks the values to use and confirms.
 */

/** The fields a reading can propose a value for. `kind` is compared only: an agreement's kind cannot be changed. */
export const readingFields = ["kind", "title", "signedOn", "startDate", "endDate", "noticePeriodDays", "amount", "currency"] as const;
export type ReadingField = (typeof readingFields)[number];

/** How much of a document goes to the model; a longer one is read up to here, and the page says so. */
export const MAX_READING_CHARS = 30_000;
export const MAX_PASSAGE = 400;

const found = <T extends z.ZodType>(value: T) =>
  z.preprocess((v) => (v === undefined ? null : v), z.object({ value, passage: z.string().trim().min(8).max(MAX_PASSAGE) }).nullable());
const day = z.string().refine(isDay);

/** What the model answers: per field the value as the app stores it and the passage it was read from, or null when the document does not say. */
export const contractReadingSchema = z.object({
  kind: found(z.enum(kinds)),
  title: found(z.string().trim().min(1).max(200)),
  signedOn: found(day),
  startDate: found(day),
  endDate: found(day),
  noticePeriodDays: found(z.number().int().min(0).max(730)),
  /** A plain amount such as "48000" or "48000.50", without a currency sign. */
  amount: found(z.string().regex(/^\d{1,13}(\.\d{1,2})?$/)),
  currency: found(z.enum(currencies)),
});
export type ContractReading = z.infer<typeof contractReadingSchema>;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const numbersIn = (text: string) => text.match(/\d+/g) ?? [];

/** Whether a passage can be where this date was read: it holds the year, the day, and the month by name or number. */
export function passageHasDate(passage: string, date: string): boolean {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const nums = numbersIn(passage).map(Number);
  const lower = passage.toLowerCase();
  // The month as a whole word, in full or shortened: "may" inside "dismay" is not a month.
  const named = new RegExp(`\\b(${monthNames[m - 1]}|${monthNames[m - 1]!.slice(0, 3)}${m === 9 ? "|sept" : ""})\\b`).test(lower);
  // Written in figures, the day and the month are both among the numbers (the same number twice when they are equal).
  const inFigures = d === m ? nums.filter((n) => n === d).length >= 2 : nums.includes(m);
  return (nums.includes(y) || nums.includes(y % 100)) && nums.includes(d) && (named || inFigures);
}

/** Whether a passage holds this amount, however its thousands and decimals are written. */
export function passageHasAmount(passage: string, amount: string): boolean {
  const cents = parseAmount(amount);
  return cents != null && (passage.match(/\d[\d.,]*\d|\d/g) ?? []).some((token) => parseAmount(token.replace(/[.,]$/, "")) === cents);
}

/**
 * What is wrong with a reading, or null. Every passage must stand word for word in the
 * document, and must hold the value it is given for: a value that cannot be seen in its
 * own passage is not evidence, it is a guess.
 */
export function readingProblem(text: string, r: ContractReading): string | null {
  const whole = squash(text);
  for (const field of readingFields) {
    const f = r[field];
    if (!f) continue;
    const passage = squash(f.passage);
    if (!whole.includes(passage)) return `the passage given for ${field} is not in the document`;
    if ((field === "signedOn" || field === "startDate" || field === "endDate") && !passageHasDate(passage, f.value as string))
      return `the passage given for ${field} does not hold that date`;
    if (field === "amount" && !passageHasAmount(passage, f.value as string)) return "the passage given for the amount does not hold that amount";
    if (field === "noticePeriodDays") {
      const n = f.value as number;
      const nums = numbersIn(passage).map(Number);
      // "Three months" written in figures as 3 months may be given as 90 days.
      if (!nums.includes(n) && !(/month/i.test(passage) && n % 30 === 0 && nums.includes(n / 30))) return "the passage given for the notice period does not hold that number";
    }
    if (field === "currency" && !(f.value === "EUR" ? /€|\beur\b|euro/i : /£|\bgbp\b|pound|sterling/i).test(passage)) return "the passage given for the currency does not name it";
    if (field === "title" && !whole.toLowerCase().includes(squash(f.value as string).toLowerCase())) return "the title is not in the document";
  }
  return null;
}

// ---------- What the page shows

export type ProposalState =
  /** The document says something else than the agreement holds: can be taken over. */
  | "differs"
  /** The agreement already holds this. */
  | "same"
  /** This kind of agreement has no such field, or the field cannot be changed. */
  | "not_applicable";

export interface Proposal {
  field: ReadingField;
  label: string;
  /** What the agreement holds now and what the document says, written as the pages show them. */
  current: string;
  proposed: string;
  passage: string;
  /** Page or sheet of the document the passage is on, when it has such parts. */
  where: string | null;
  state: ProposalState;
  /** Why it cannot be taken over, for `not_applicable`. */
  why: string | null;
}

export interface DocumentReading {
  documentId: string;
  fileName: string;
  suggestion: Pick<TextSuggestion<unknown>, "id" | "status" | "model" | "createdAt" | "reviewedBy" | "reviewedAt">;
  proposals: Proposal[];
  /** The fields the document says nothing about, by their labels. */
  notFound: string[];
  /** The document was longer than the AI reads in one go; only its first part was read. */
  partly: boolean;
}

export const readingReviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("apply"), suggestionId: z.string().uuid(), fields: z.array(z.enum(readingFields)).min(1, "Tick at least one value to use.") }),
  z.object({ action: z.literal("reject"), suggestionId: z.string().uuid() }),
]);

/** Which stored field of the agreement a read value goes to, by the agreement's kind; null when that kind has no such field. */
export function targetOf(field: ReadingField, kind: Kind): { key: string; label: string } | { why: string } {
  const none = (what: string) => ({ why: `${what} does not apply to this kind of agreement.` });
  switch (field) {
    case "kind":
      return { why: "The kind of an agreement cannot be changed. If the document is another kind of agreement, add a new agreement for it." };
    case "title":
      return { key: "title", label: "Title" };
    case "signedOn":
      return { key: "signedOn", label: "Signed on" };
    case "startDate":
      return kind === "nda" || kind === "dpa" ? none("A start date") : { key: "startDate", label: "Starts" };
    case "endDate":
      return kind === "msa" ? none("An end date") : { key: "endDate", label: kind === "subscription" ? "Renews on" : kind === "sow" ? "Ends" : "Valid until" };
    case "noticePeriodDays":
      return kind === "subscription" ? { key: "noticePeriodDays", label: "Notice period" } : none("A notice period");
    case "amount":
      return kind === "sow" ? { key: "budgetMinor", label: "Budget" } : kind === "subscription" ? { key: "annualValueMinor", label: "Annual value" } : none("A value or budget");
    case "currency":
      return { key: "currency", label: "Currency" };
  }
}
export const readingLabels: Record<ReadingField, string> = {
  kind: "Kind",
  title: "Title",
  signedOn: "Signed on",
  startDate: "Start date",
  endDate: "End or renewal date",
  noticePeriodDays: "Notice period",
  amount: "Value or budget",
  currency: "Currency",
};
