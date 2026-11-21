import { z } from "zod";
import type { Day } from "./dates";
import { metricKeys, type MetricCell, type MetricKey, type Month } from "./performance";
import type { Paperwork } from "./vendors";

/**
 * Scorecards and AI scoring (P-1 to P-7, AI-1, AI-2): criteria, quarters, the overall
 * score, the AI's monthly proposal and what a scorecard shows.
 */

// ---------- Quarters

/** A calendar quarter, written 2026-Q3. */
export type Quarter = string;
export const isQuarter = (v: unknown): v is Quarter => typeof v === "string" && /^2[01]\d{2}-Q[1-4]$/.test(v);
export const quarterOf = (day: Day): Quarter => `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
const two = (n: number) => String(n).padStart(2, "0");
/** The first and last day of a quarter, and its three months. */
export function quarterBounds(q: Quarter): { start: Day; end: Day; months: [Month, Month, Month] } {
  const year = Number(q.slice(0, 4));
  const first = (Number(q.slice(6)) - 1) * 3 + 1;
  const lastDay = new Date(Date.UTC(year, first + 2, 0)).getUTCDate();
  return {
    start: `${year}-${two(first)}-01`,
    end: `${year}-${two(first + 2)}-${two(lastDay)}`,
    months: [`${year}-${two(first)}`, `${year}-${two(first + 1)}`, `${year}-${two(first + 2)}`],
  };
}
/** "Q3 2026". */
export const quarterName = (q: Quarter) => `${q.slice(5)} ${q.slice(0, 4)}`;
export function addQuarter(q: Quarter, n: number): Quarter {
  const index = Number(q.slice(0, 4)) * 4 + Number(q.slice(6)) - 1 + n;
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}

// ---------- Criteria (P-7)

export const criterionSources = ["measured", "manual"] as const;
export type CriterionSource = (typeof criterionSources)[number];
export const sourceLabels: Record<CriterionSource, string> = { measured: "Measured from Jira", manual: "Scored by the reviewer" };

export const criterionSchema = z.object({
  name: z
    .string("Give the criterion a name.")
    .trim()
    .min(1, "Give the criterion a name.")
    .max(80, "A name is at most 80 characters.")
    .transform((s) => s.replace(/\s+/g, " ")),
  description: z.string().trim().max(400, "A description is at most 400 characters.").nullish(),
  weight: z.number("Enter a weight from 1 to 100.").int("A weight is a whole number.").min(1, "A weight is at least 1.").max(100, "A weight is at most 100."),
  source: z.enum(criterionSources, "Choose how this criterion is scored."),
  metrics: z.array(z.enum(metricKeys)).max(metricKeys.length).default([]),
  active: z.boolean().default(true),
});
export type CriterionInput = z.infer<typeof criterionSchema>;
export interface Criterion extends CriterionInput {
  id: string;
  description: string | null;
  metrics: MetricKey[];
}

/** Problems the field checks cannot see, keyed by field. */
export function checkCriterion(c: Pick<CriterionInput, "source" | "metrics">): Record<string, string> {
  if (c.source === "measured" && c.metrics.length === 0) return { metrics: "Choose at least one helpdesk figure this criterion is judged from." };
  return {};
}

// ---------- Scores

export const scoreValues = [1, 2, 3, 4, 5] as const;
export const score = z.number("Choose a score from 1 to 5.").int().min(1, "A score is from 1 to 5.").max(5, "A score is from 1 to 5.");

/** The weighted average of the scored lines, in tenths (3.8 is 38). Null while nothing is scored. */
export function overallTenths(lines: { score: number | null; weight: number }[]): number | null {
  const scored = lines.filter((l) => l.score != null);
  const weight = scored.reduce((n, l) => n + l.weight, 0);
  return weight > 0 ? Math.round((scored.reduce((n, l) => n + l.score! * l.weight, 0) * 10) / weight) : null;
}
export const formatScore = (tenths: number | null) => (tenths == null ? "–" : (tenths / 10).toFixed(1));

/**
 * What the quarter's monthly proposals suggest for a criterion: their average, rounded to
 * a whole score (a half rounds up). Rejected proposals are left out. Null when there are none.
 */
export function suggestedScore(monthScores: number[]): number | null {
  if (!monthScores.length) return null;
  return Math.min(5, Math.max(1, Math.round(monthScores.reduce((a, b) => a + b, 0) / monthScores.length)));
}

// ---------- AI suggestions (AI-1)

export const suggestionStatuses = ["proposed", "accepted", "edited", "rejected"] as const;
export type SuggestionStatus = (typeof suggestionStatuses)[number];
export const suggestionStatusLabels: Record<SuggestionStatus, string> = {
  proposed: "Not reviewed yet",
  accepted: "Accepted",
  edited: "Accepted with changes",
  rejected: "Rejected",
};

/** One figure the model was given, exactly as the app worked it out. */
export interface UsedMetric {
  key: MetricKey;
  valueTenths: number | null;
  targetTenths: number | null;
  verdict: MetricCell["verdict"];
}
export interface ProposalScore {
  criterionId: string;
  criterionName: string;
  /** The score as it stands: the AI's, or the reviewer's after an edit. */
  score: number;
  /** What the AI proposed, kept when a person changes the score. */
  aiScore: number;
  reason: string;
  metrics: UsedMetric[];
}
export interface ProposalTheme {
  title: string;
  summary: string;
  /** How many of the tickets read belong to this theme. Counted by the app from the tickets the model named. */
  tickets: number;
  examples: { key: string; summary: string; url: string | null }[];
}
export interface Proposal {
  id: string;
  vendorId: string;
  month: Month;
  status: SuggestionStatus;
  model: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  scores: ProposalScore[];
  themes: ProposalTheme[];
  ticketsRead: number;
}

export const proposalReviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("edit"), scores: z.array(z.object({ criterionId: z.string().uuid(), score })).min(1, "Change at least one score.") }),
]);

/** What the page shows about a month's proposal. */
export interface ProposalState {
  month: Month;
  proposal: Proposal | null;
  /** Why no proposal can be asked for, in plain words; null when one can. */
  blocked: string | null;
}

// ---------- Scorecards (P-2 to P-6)

export const scorecardStatuses = ["draft", "final"] as const;
export type ScorecardStatus = (typeof scorecardStatuses)[number];

export const startScorecardSchema = z.object({
  vendorId: z.string("Choose a vendor.").uuid("Choose a vendor."),
  quarter: z.string("Choose a quarter.").refine(isQuarter, "Choose a quarter."),
});

const note = (what: string) => z.string().trim().max(2000, `${what} is at most 2,000 characters.`).nullish();
export const scorecardSaveSchema = z.object({
  summary: z.string().trim().max(4000, "The summary is at most 4,000 characters.").nullish(),
  lines: z
    .array(
      z.object({
        criterionId: z.string().uuid(),
        // Anything left out of a line stays as it is, so two boxes saved at the same moment cannot undo each other.
        score: score.nullable().optional(),
        vendorComment: note("A comment"),
        internalNote: note("A note"),
        /** True when the reviewer pressed Accept on the AI's suggestion and has not changed the score since. */
        acceptedSuggestion: z.boolean().default(false),
      }),
    )
    .max(50)
    .refine((lines) => new Set(lines.map((l) => l.criterionId)).size === lines.length, "A criterion can be sent only once.")
    .default([]),
});
export type ScorecardSave = z.infer<typeof scorecardSaveSchema>;

/** Facts the app already holds that help a reviewer score by hand (P-2, P-4). All worked out in code. */
export interface Facts {
  budgets: {
    /** SOWs with a budget that were running during the quarter. */
    sows: number;
    within: number;
    over: number;
    items: { agreementId: string; title: string; usedPct: number | null; over: boolean }[];
  };
  milestones: {
    /** Milestones due in the quarter, cancelled ones left out. */
    due: number;
    onTime: number;
    late: number;
    /** Not delivered and past their due date. */
    overdue: number;
    /** Not delivered, and not due yet. */
    open: number;
  };
  nda: Paperwork;
  dpa: Paperwork;
}

/** The helpdesk figures of the quarter's months, for a vendor with a board. */
export interface QuarterMonth {
  month: Month;
  /** False for a month that has not ended, or not begun. */
  complete: boolean;
  cells: Record<MetricKey, MetricCell>;
}

export interface LineSuggestion {
  /** The score suggested for the quarter. */
  score: number;
  months: { month: Month; score: number; reason: string; status: SuggestionStatus }[];
}
export interface ScorecardLine {
  criterionId: string;
  name: string;
  description: string | null;
  weight: number;
  source: CriterionSource;
  metrics: MetricKey[];
  score: number | null;
  vendorComment: string | null;
  internalNote: string | null;
  /** What the AI suggests for this criterion from the monthly proposals; null for manual criteria and vendors without proposals. */
  suggestion: LineSuggestion | null;
  /** True when the score was taken from the AI's suggestion as it was. */
  acceptedSuggestion: boolean;
  /** What the AI suggested at the moment the reviewer scored; it may differ from today's suggestion. Null when unscored or nothing was suggested. */
  suggestedWhenScored: number | null;
}
/** Whether a quarter has ended, so that its scorecard can be finalised on the whole quarter. */
export const quarterOver = (q: Quarter, today: Day) => quarterBounds(q).end < today;

export interface Scorecard {
  id: string;
  vendorId: string;
  vendorName: string;
  quarter: Quarter;
  periodStart: Day;
  periodEnd: Day;
  status: ScorecardStatus;
  reviewerName: string;
  overallTenths: number | null;
  scored: number;
  criteria: number;
  finalisedAt: string | null;
  updatedAt: string;
}
export interface ScorecardDetail extends Scorecard {
  summary: string | null;
  finalisedBy: string | null;
  hasBoard: boolean;
  lines: ScorecardLine[];
  facts: Facts;
  helpdesk: QuarterMonth[] | null;
}

/** What still stands between a draft and "final": the criteria without a score. */
export const unscored = (lines: Pick<ScorecardLine, "name" | "score">[]) => lines.filter((l) => l.score == null).map((l) => l.name);

export const paperworkWords: Record<Paperwork, string> = { in_place: "in place", missing: "missing", expired: "expired", not_required: "not required" };
