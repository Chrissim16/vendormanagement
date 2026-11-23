import { z } from "zod";
import { agreementStatuses, kinds } from "./agreements";
import { addDays, addMonths, isDay, type Day } from "./dates";
import { isMonth } from "./performance";
import { rfpStages } from "./rfp";
import { scorecardStatuses } from "./scorecards";
import { vendorStatuses, vendorTypes, warningTypes } from "./vendors";

/**
 * Ask a question (C-1). A question is answered in two steps. First the model chooses
 * which of the app's read-only look-ups to run; the app runs them with the same queries
 * the list pages use and works out every count and amount itself. Then the model writes
 * the answer from those results, and may quote no figure that is not in them.
 */

export const MAX_QUESTION = 500;
/** How many earlier questions of the conversation go along, so that "and for the other one?" can be understood. */
export const MAX_EARLIER = 3;
/** How many look-ups one question may use. */
export const MAX_LOOKUPS = 4;
/** How many rows of a look-up the model reads and the page shows; the count is always of the whole list. */
export const MAX_ROWS = 40;
export const MAX_PASSAGES = 5;

export const askSchema = z.object({
  question: z.string().trim().min(1, "Type a question first.").max(MAX_QUESTION, `A question is at most ${MAX_QUESTION} characters.`),
  earlier: z.array(z.string().trim().max(MAX_QUESTION)).max(MAX_EARLIER).default([]),
});

// ---------- The look-ups the model may choose from. There are no others, and none of them changes anything.

const name = z.string().trim().min(1).max(200);
const words = z.string().trim().min(1).max(MAX_QUESTION);
const day = z.string().refine(isDay);
const month = z.string().refine(isMonth);
/** A model writes null, "" or leaves a key out when it has nothing to say; all three mean "not given". */
const opt = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === null || v === "" ? undefined : v), schema.optional());

export const lookupArgs = {
  vendors: z.object({ search: opt(name), type: opt(z.enum(vendorTypes)), status: opt(z.enum([...vendorStatuses, "all"])), owner: opt(name) }),
  vendor: z.object({ vendor: name }),
  agreements: z.object({
    vendor: opt(name),
    kind: opt(z.enum(kinds)),
    status: opt(z.enum(agreementStatuses)),
    search: opt(name),
    owner: opt(name),
    endsFrom: opt(day),
    endsTo: opt(day),
  }),
  renewals: z.object({ withinDays: opt(z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)])) }),
  sow: z.object({ title: name, vendor: opt(name) }),
  sow_budgets: z.object({ vendor: opt(name) }),
  invoices: z.object({ vendor: opt(name), from: opt(day), to: opt(day), search: opt(name) }),
  spend: z.object({ from: opt(day), to: opt(day) }),
  helpdesk: z.object({ month: opt(month) }),
  vendor_helpdesk: z.object({ vendor: name, month: opt(month) }),
  scorecards: z.object({ vendor: opt(name), status: opt(z.enum(scorecardStatuses)) }),
  warnings: z.object({ vendor: opt(name), type: opt(z.enum(warningTypes)), only: opt(z.enum(["warnings", "risk_flags"])) }),
  rfps: z.object({ stage: opt(z.enum([...rfpStages, "open"])), search: opt(name) }),
  rfp: z.object({ title: name }),
  documents: z.object({ text: words, vendor: opt(name) }),
} as const;
export type LookupName = keyof typeof lookupArgs;
export const lookupNames = Object.keys(lookupArgs) as LookupName[];
export type LookupArgs<N extends LookupName> = z.infer<(typeof lookupArgs)[N]>;
export type LookupCall = { [N in LookupName]: { name: N; args: LookupArgs<N> } }[LookupName];

/** What each look-up is for, as the model is told. */
export const lookupGuide: Record<LookupName, string> = {
  vendors:
    "The vendor list. args: search (part of a name), type (software | consultancy | advisory), status (prospect | active | on_hold | offboarded | all; offboarded vendors are left out unless asked for), owner (a colleague's name).",
  vendor: "One vendor: its owner, status, contacts, NDA and data processing agreement, agreements, and the RFPs it is a candidate in. args: vendor (its name).",
  agreements:
    "The agreement list: MSAs, SOWs, subscriptions, NDAs and data processing agreements, with status, dates and value. args: vendor, kind (msa | sow | subscription | nda | dpa), status (draft | in_negotiation | out_for_signature | active | ended), search (part of a title or reference), owner, endsFrom and endsTo (YYYY-MM-DD, the end or renewal date falls on or between them).",
  renewals:
    "Subscriptions whose notice deadline has passed or is coming up and that have no renewal decision yet. args: withinDays (how far ahead to look: 30, 60, 90 or 180; left out, the team's usual window).",
  sow: "One SOW in full: budget and what was invoiced, milestones, change requests and consultants. args: title (the SOW's title or part of it), vendor.",
  sow_budgets: "Every active SOW's budget against what has been invoiced, the most used first. args: vendor.",
  invoices: "The invoice list with its totals per currency. args: vendor, from and to (YYYY-MM-DD, by invoice date), search (invoice number or description).",
  spend: "What was invoiced per vendor and per month over a period: together in euros, converted where needed, and in each currency it was invoiced in. args: from and to (YYYY-MM-DD; left out, the last twelve months).",
  helpdesk: "The helpdesk figures of every vendor with a Jira board for one month, against their targets. args: month (YYYY-MM; left out, the running month).",
  vendor_helpdesk:
    "One vendor's helpdesk figures for the last months, with targets met or missed. args: vendor, month (YYYY-MM, the last month shown; left out, the running month).",
  scorecards: "Quarterly scorecards with their overall score. args: vendor, status (draft | final).",
  warnings: `Everything that needs attention today: warnings and risk flags, each with the fact that raised it. args: vendor, type (one of ${warningTypes.join(" | ")}), only (warnings | risk_flags). A vendor without an NDA is type nda_missing.`,
  rfps: "The RFP list with stage, owner, target date and winner. args: stage (drafting | in_review | approved | issued | evaluating | decided | cancelled | open, where open is everything still running), search (part of a title).",
  rfp: "One RFP in full: the need, stage, candidates with their list and reason, the scores so far and the decision. args: title (the RFP's title or part of it).",
  documents:
    "Passages from the text of uploaded documents (contracts and what RFP candidates sent). Use it for any question about what a document or contract says. args: text (the words to look for, taken from the question), vendor.",
};

// ---------- What comes back

/** One record a look-up found, with the page where it lives. */
export interface AskRow {
  /** How the model names this row when it lists its sources. */
  ref: string;
  label: string;
  href: string;
  /** What the app knows about it, written the way the pages show it. */
  facts: Record<string, string>;
}

/** A passage of an uploaded document, word for word. */
export interface AskPassage {
  ref: string;
  documentId: string;
  document: string;
  /** Where the document is attached, in words: "MSA Framework agreement · Vendor". */
  where: string;
  /** The page that document is attached to. */
  href: string;
  /** Page of a PDF or sheet of a workbook, when the file has such parts. */
  part: string | null;
  text: string;
}

export interface AskLookup {
  name: LookupName;
  /** What was looked up, in words, with every filter that applied. */
  title: string;
  /** The list page that shows the same thing with the same filter, when there is one. */
  href: string | null;
  /** How many records match, worked out by the app; null when the look-up is not a list. */
  count: number | null;
  /** Totals and other figures worked out by the app. */
  totals: { label: string; value: string }[];
  rows: AskRow[];
  /** How many matching records are not among `rows`. */
  more: number;
  passages: AskPassage[];
  /** Something the reader must know: no such vendor, nothing readable in the documents. */
  note: string | null;
}

export interface AskSource {
  label: string;
  href: string;
}

export interface AskAnswer {
  id: string;
  question: string;
  /** False when the app does not hold what was asked. */
  answered: boolean;
  answer: string;
  /** The records and passages the answer rests on. */
  sources: AskSource[];
  passages: AskPassage[];
  lookups: AskLookup[];
  model: string;
  createdAt: string;
}

/** What is said when a question is about something the app does not hold. */
export const NOT_HELD =
  "The app does not hold the answer to that, so I will not guess. I can answer questions about vendors, agreements and renewals, invoices and spend, SOW budgets and milestones, helpdesk performance, scorecards, warnings, RFPs, and what an uploaded document says.";

/** Questions offered on an empty Ask page and in the search field. */
export const exampleQuestions = [
  "Which SOWs end this quarter?",
  "Which vendors have no NDA?",
  "How much was invoiced last month?",
  "Which SOWs are over budget?",
  "Which RFPs are still running?",
];

/** What is said when a question asks for something to be changed. */
export const READ_ONLY =
  "Ask can only look things up. It cannot add, change or remove anything, so nothing was changed. Make the change on the record's own page; I can help you find it.";

/**
 * The periods a question usually means, worked out by the app so that the model never
 * does date arithmetic. Each is a first and a last day.
 */
export function periodsFor(today: Day): Record<string, { from: Day; to: Day }> {
  const monthStart = (d: Day) => `${d.slice(0, 7)}-01`;
  const monthEnd = (d: Day) => addDays(addMonths(monthStart(d), 1), -1);
  const quarterStart = (d: Day) => `${d.slice(0, 4)}-${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
  const quarter = (start: Day) => ({ from: start, to: addDays(addMonths(start, 3), -1) });
  const year = (y: number) => ({ from: `${y}-01-01`, to: `${y}-12-31` });
  const m = monthStart(today);
  const q = quarterStart(today);
  const y = Number(today.slice(0, 4));
  return {
    thisMonth: { from: m, to: monthEnd(m) },
    lastMonth: { from: addMonths(m, -1), to: addDays(m, -1) },
    nextMonth: { from: addMonths(m, 1), to: monthEnd(addMonths(m, 1)) },
    thisQuarter: quarter(q),
    lastQuarter: quarter(addMonths(q, -3)),
    nextQuarter: quarter(addMonths(q, 3)),
    thisYear: year(y),
    lastYear: year(y - 1),
    nextYear: year(y + 1),
    next30Days: { from: today, to: addDays(today, 30) },
    next90Days: { from: today, to: addDays(today, 90) },
    last12Months: { from: addMonths(m, -11), to: today },
  };
}
