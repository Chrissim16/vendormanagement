import { z } from "zod";
import { kinds, type Kind } from "./agreements";
import { isDay } from "./dates";
import { currencies, parseAmount, type Currency } from "./money";
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
const two = (n: number | string) => String(n).padStart(2, "0");
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH = "(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)";
const monthNumber = (word: string) => MONTH_NAMES.findIndex((m) => m.startsWith(word.toLowerCase().slice(0, 3))) + 1;
const DAY_FIRST = new RegExp(String.raw`(?<![\p{L}\p{N}])(\d{1,2})(?:st|nd|rd|th)?(?: day)?(?: of)? ${MONTH}\.?,? (\d{4})(?![\p{L}\p{N}])`, "giu");
const MONTH_FIRST = new RegExp(String.raw`(?<![\p{L}\p{N}])${MONTH}\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})(?![\p{L}\p{N}])`, "giu");
const ISO = /(?<![\p{L}\p{N}])(\d{4})-(\d{2})-(\d{2})(?![\p{L}\p{N}])/gu;
const FIGURES = /(?<![\p{L}\p{N}./-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\p{L}\p{N}])/gu;

/**
 * Every date a piece of text states, as YYYY-MM-DD: "4 January 2027", "the 9th of March
 * 2027", "March 9, 2027", "2027-03-09" and "09/03/2027", which is read day first. A date
 * is a whole expression: a loose day, month or year is not one.
 */
export function datesIn(text: string): string[] {
  const out: string[] = [];
  const add = (y: string | number, m: number, d: string | number) => {
    const day = `${String(y).length === 2 ? `20${y}` : y}-${two(m)}-${two(d)}`;
    if (isDay(day)) out.push(day);
  };
  for (const m of text.matchAll(DAY_FIRST)) add(m[3]!, monthNumber(m[2]!), m[1]!);
  for (const m of text.matchAll(MONTH_FIRST)) add(m[3]!, monthNumber(m[1]!), m[2]!);
  for (const m of text.matchAll(ISO)) add(m[1]!, Number(m[2]), m[3]!);
  for (const m of text.matchAll(FIGURES)) add(m[3]!, Number(m[2]), m[1]!);
  return [...new Set(out)];
}

const CURRENCY_WORD = String.raw`€|£|\bEUR\b|\bGBP\b|\beuros?\b|\bpounds?(?: sterling)?\b`;
const NUMBER = String.raw`\d[\d.,]*\d|\d`;
const MONEY = new RegExp(String.raw`(?:(${CURRENCY_WORD})\s?(${NUMBER})|(?<![\p{L}\p{N}.,])(${NUMBER})\s?(${CURRENCY_WORD}))`, "giu");
const currencyOf = (word: string): Currency => (/€|eur/i.test(word) ? "EUR" : "GBP");
/** No agreement is worth more than this; the same ceiling the edit form has. */
const MAX_MINOR = 9_000_000_000_00;

/** Every amount of money a piece of text states: a number with its currency right next to it. A bare number is not an amount. */
export function moneyIn(text: string): { minor: number; currency: Currency }[] {
  const out: { minor: number; currency: Currency }[] = [];
  for (const m of text.matchAll(MONEY)) {
    const minor = parseAmount((m[2] ?? m[3])!.replace(/[.,]$/, ""));
    if (minor != null && minor <= MAX_MINOR) out.push({ minor, currency: currencyOf((m[1] ?? m[4])!) });
  }
  return out;
}

/** The notice periods a piece of text states in days. Months are not turned into days: three months is not always ninety days. */
export function noticeDaysIn(text: string): number[] {
  if (!/notice|cancel|terminat/i.test(text)) return [];
  return [...text.matchAll(/(?<![\p{L}\p{N}.,])(\d{1,3}) (?:calendar )?days?\b/giu)].map((m) => Number(m[1]));
}

/** Whether a passage stands in the document as whole words: it does not begin or end inside a word or a number. */
export function standsIn(text: string, passage: string): boolean {
  const [whole, part] = [squash(text), squash(passage)];
  const inside = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  for (let at = whole.indexOf(part); at >= 0; at = whole.indexOf(part, at + 1)) {
    const [before, first, last, after] = [whole[at - 1], part[0], part.at(-1), whole[at + part.length]];
    // Cut after "31" in "31 January" or before the 6 of "26,500": the passage would say something the document does not.
    const cutAtStart = inside(before) && inside(first);
    const cutAtEnd = (inside(last) && inside(after)) || (/\d/.test(last ?? "") && /[.,]/.test(after ?? "") && /\d/.test(whole[at + part.length + 1] ?? ""));
    const cutInNumber = /\d/.test(first ?? "") && /[.,]/.test(before ?? "") && /\d/.test(whole[at - 2] ?? "");
    if (!cutAtStart && !cutAtEnd && !cutInNumber) return true;
  }
  return false;
}

/** The words by which a document calls itself a kind of agreement. */
const KIND_WORDS: Record<Kind, RegExp> = {
  msa: /master (services? )?agreement|framework agreement|\bmsa\b/i,
  sow: /statement of work|\bsow\b/i,
  subscription: /subscription|licen[cs]e/i,
  nda: /non-?disclosure|confidentiality agreement|\bnda\b/i,
  dpa: /data processing|\bdpa\b/i,
};

/** A reading with only the values whose passage bears them out, and the fields that were given without that. */
export interface Verified {
  reading: ContractReading;
  /** Fields the model gave a value for that its passage does not show; they are not offered. */
  unverified: ReadingField[];
}

/**
 * Keeps of a reading only what can be seen in the document. A value stays when its
 * passage stands in the document word for word, as whole words, and itself states that
 * value: the date as a whole date, the amount with its currency next to it, the notice
 * period as a number of days in a sentence about notice, the title in the passage, the
 * kind by the words the document uses for it. An
 * amount takes its currency from its own passage. Everything else is left out and named,
 * so a person never sees a value next to a passage that does not say it.
 */
export function verifyReading(text: string, r: ContractReading): Verified {
  const reading: ContractReading = { kind: null, title: null, signedOn: null, startDate: null, endDate: null, noticePeriodDays: null, amount: null, currency: null };
  const unverified: ReadingField[] = [];
  const keep = <F extends ReadingField>(field: F, holds: (passage: string, value: NonNullable<ContractReading[F]>["value"]) => boolean) => {
    const f = r[field];
    if (!f) return;
    const passage = squash(f.passage);
    if (standsIn(text, passage) && holds(passage, f.value as NonNullable<ContractReading[F]>["value"])) reading[field] = { ...f, passage } as never;
    else unverified.push(field);
  };
  keep("kind", (p, v) => KIND_WORDS[v].test(p));
  keep("title", (p, v) => squash(v).length >= 3 && p.toLowerCase().includes(squash(v).toLowerCase()));
  for (const field of ["signedOn", "startDate", "endDate"] as const) keep(field, (p, v) => datesIn(p).includes(v));
  keep("noticePeriodDays", (p, v) => noticeDaysIn(p).includes(v));
  keep("amount", (p, v) => moneyIn(p).some((m) => m.minor === parseAmount(v)));
  if (reading.amount) {
    // The amount's own passage says which currency it is in; that is the currency, whatever else was answered.
    const cents = parseAmount(reading.amount.value);
    const stated = [
      ...new Set(
        moneyIn(reading.amount.passage)
          .filter((m) => m.minor === cents)
          .map((m) => m.currency),
      ),
    ];
    if (stated.length === 1) {
      if (r.currency && r.currency.value !== stated[0]) unverified.push("currency");
      reading.currency = { value: stated[0]!, passage: reading.amount.passage };
    } else {
      // The same number in two currencies in one passage: nothing to go on.
      reading.amount = null;
      unverified.push("amount");
      if (r.currency) unverified.push("currency");
    }
  } else keep("currency", (p, v) => new RegExp(v === "EUR" ? String.raw`€|\bEUR\b|\beuros?\b` : String.raw`£|\bGBP\b|\bpounds?\b|\bsterling\b`, "i").test(p));
  return { reading, unverified: [...new Set(unverified)] };
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
  /** Fields the AI gave a value for that its passage did not bear out; they are not shown as proposals. */
  unverified: string[];
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
