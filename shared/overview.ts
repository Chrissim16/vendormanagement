import { z } from "zod";
import type { AgreementStatus, Kind } from "./agreements";
import type { Day } from "./dates";
import type { Currency } from "./money";
import { metricInfo, type MetricCell, type MetricKey, type Month } from "./performance";
import type { Quarter, SuggestionStatus } from "./scorecards";
import type { BudgetView, Money, Spend } from "./sow";
import type { Paperwork, VendorStatus, VendorType, Warning } from "./vendors";

/**
 * What the dashboard (D-1), the monthly management report (D-2) and a vendor briefing
 * (B-1) show. Every figure in them is worked out by the app; the AI only writes text
 * around them, and that text counts for nothing until a person takes it over.
 */

// ---------- Shared rows

export interface SowBudgetRow {
  agreementId: string;
  vendorId: string;
  vendorName: string;
  title: string;
  currency: Currency;
  endDate: Day | null;
  budget: BudgetView;
}

export type Trend = "up" | "down" | "same" | "first";
/** A vendor's latest final scorecard against the one before it. "First" when there is nothing to compare with. */
export const scoreTrend = (nowTenths: number, beforeTenths: number | null): Trend =>
  beforeTenths == null ? "first" : nowTenths > beforeTenths ? "up" : nowTenths < beforeTenths ? "down" : "same";
export const trendWords: Record<Trend, string> = { up: "up", down: "down", same: "unchanged", first: "first scorecard" };

export interface VendorScoreRow {
  vendorId: string;
  vendorName: string;
  scorecardId: string;
  quarter: Quarter;
  overallTenths: number;
  previousQuarter: Quarter | null;
  previousTenths: number | null;
  trend: Trend;
}

/** Picks each vendor's latest final scorecard and the final one before it. `cards` may be in any order. */
export function latestScores(cards: { id: string; vendorId: string; vendorName: string; quarter: Quarter; overallTenths: number | null }[]): VendorScoreRow[] {
  const byVendor = new Map<string, typeof cards>();
  for (const c of cards) if (c.overallTenths != null) byVendor.set(c.vendorId, [...(byVendor.get(c.vendorId) ?? []), c]);
  return [...byVendor.values()]
    .map((list) => {
      const [latest, before] = list.sort((a, b) => b.quarter.localeCompare(a.quarter));
      return {
        vendorId: latest!.vendorId,
        vendorName: latest!.vendorName,
        scorecardId: latest!.id,
        quarter: latest!.quarter,
        overallTenths: latest!.overallTenths!,
        previousQuarter: before?.quarter ?? null,
        previousTenths: before?.overallTenths ?? null,
        trend: scoreTrend(latest!.overallTenths!, before?.overallTenths ?? null),
      };
    })
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName, "en", { sensitivity: "base" }));
}

export interface ScorecardDueRow {
  vendorId: string;
  vendorName: string;
  /** The draft, when someone has started it. */
  scorecardId: string | null;
  scored: number;
  criteria: number;
}

/** An RFP that is still running. RFPs arrive with a later milestone; until then there are none. */
export interface OpenRfp {
  id: string;
  title: string;
  stage: string;
}

// ---------- Dashboard (D-1)

export interface Dashboard {
  /** Active SOWs with a budget, the most used first. */
  sows: SowBudgetRow[];
  /** The last twelve months. */
  spend: Spend;
  scores: VendorScoreRow[];
  /** The quarter whose scorecards are to be finalised now: the last one that is over. */
  dueQuarter: Quarter;
  /** Scored vendors without a final scorecard for that quarter. */
  due: ScorecardDueRow[];
  rfps: OpenRfp[];
}

// ---------- AI text on a record

/** What the AI wrote for a record and what a person did with it (AI-1). */
export interface TextSuggestion<T> {
  id: string;
  status: SuggestionStatus;
  model: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  /** The AI's own text, never changed. */
  output: T;
}
export const suggestionReviewSchema = z.object({ action: z.enum(["accept", "reject"]) });

const longText = (max: number, what: string) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max, `Keep ${what} under ${max} characters.`).nullable()).default(null);

// ---------- Monthly management report (D-2)

export interface EndingAgreement {
  agreementId: string;
  vendorName: string;
  kind: Kind;
  title: string;
  endDate: Day;
  daysLeft: number;
  /** For a subscription: the last day to give notice. */
  noticeDeadline: Day | null;
}
export interface MissedTarget {
  vendorId: string;
  vendorName: string;
  month: Month;
  metric: MetricKey;
  valueTenths: number;
  targetTenths: number;
}
/** How far ahead the report looks for agreements that end. */
export const REPORT_ENDING_DAYS = 90;

export interface ReportData {
  month: Month;
  /** The figures are as they stood on this day: the last day of the month, or today while the month is still running. */
  asAt: Day;
  running: boolean;
  /** Invoiced in the month, per vendor and in total. */
  spend: Pick<Spend, "total" | "byVendor" | "gbpToEurE4">;
  /** SOWs that ran in the month, with what was invoiced on them up to `asAt`. */
  sows: SowBudgetRow[];
  ending: EndingAgreement[];
  scores: VendorScoreRow[];
  missed: MissedTarget[];
  /** How many helpdesk vendors had figures for the month. */
  measuredVendors: number;
  rfps: OpenRfp[];
}
export interface ManagementReport {
  data: ReportData;
  /** The summary as a person left it; this is what the PDF prints. */
  summary: string | null;
  suggestion: TextSuggestion<{ summary: string }> | null;
  updatedAt: string | null;
  updatedBy: string | null;
}
export const reportSaveSchema = z.object({ summary: longText(1500, "the summary") });

// ---------- Vendor briefing (B-1)

/** How far ahead a briefing looks for dates. */
export const BRIEFING_DATES_DAYS = 180;
/** How many whole months of helpdesk figures a briefing shows. */
export const BRIEFING_MONTHS = 3;

export type MetricTrend = "better" | "worse" | "same" | "none";
/** The latest month against the one before, given which way is better for the metric. */
export function metricTrend(key: MetricKey, before: number | null, latest: number | null): MetricTrend {
  if (before == null || latest == null) return "none";
  if (before === latest) return "same";
  return (metricInfo[key].direction === "at_least" ? latest > before : latest < before) ? "better" : "worse";
}
export const metricTrendWords: Record<MetricTrend, string> = { better: "better than the month before", worse: "worse than the month before", same: "same as the month before", none: "" };

export interface BriefingDate {
  date: Day;
  /** Days from the briefing's day; negative when the date has passed. */
  daysLeft: number;
  what: string;
  agreementId: string | null;
}

export interface BriefingFacts {
  asAt: Day;
  vendor: { name: string; type: VendorType; status: VendorStatus; ownerName: string; nda: Paperwork; dpa: Paperwork; scoringEnabled: boolean };
  /** Agreements that have not ended. */
  agreements: { id: string; kind: Kind; title: string; status: AgreementStatus; startDate: Day | null; endDate: Day | null; valueMinor: number | null; currency: Currency }[];
  /** Notice deadlines that have passed without a decision, and everything dated in the next `BRIEFING_DATES_DAYS` days, soonest first. */
  dates: BriefingDate[];
  budgets: Omit<SowBudgetRow, "vendorId" | "vendorName">[];
  /** Invoiced in the twelve months up to the briefing's day. */
  spend: { from: Day; to: Day; total: Money };
  /** The last whole months of helpdesk figures, oldest first; null for a vendor without a board or not scored. */
  performance: { months: { month: Month; cells: Record<MetricKey, MetricCell> }[]; trends: Record<MetricKey, MetricTrend> } | null;
  missed: Omit<MissedTarget, "vendorId" | "vendorName">[];
  score: Omit<VendorScoreRow, "vendorId" | "vendorName" | "scorecardId"> | null;
  milestones: { sowId: string; sowTitle: string; title: string; dueDate: Day; daysLate: number }[];
  changeRequests: { sowId: string; sowTitle: string; title: string; requestedOn: Day; budgetChangeMinor: number | null; newEndDate: Day | null; currency: Currency }[];
  flags: Pick<Warning, "type" | "tone" | "label" | "title" | "detail">[];
}

export interface BriefingText {
  summary: string;
  talkingPoints: string[];
}
export interface BriefingHeader {
  id: string;
  vendorId: string;
  vendorName: string;
  asAt: Day;
  createdAt: string;
  createdBy: string | null;
  /** Whether a person has written or taken over a summary or talking points. */
  hasText: boolean;
  suggestionStatus: SuggestionStatus | null;
}
export interface Briefing extends BriefingHeader {
  facts: BriefingFacts;
  summary: string | null;
  /** One talking point per line. */
  talkingPoints: string | null;
  suggestion: TextSuggestion<BriefingText> | null;
  updatedAt: string;
  updatedBy: string | null;
}
export const briefingSaveSchema = z.object({ summary: longText(2000, "the summary"), talkingPoints: longText(4000, "the talking points") });

/** Talking points are kept as text, one per line; a leading dash or bullet a person typed is dropped. */
export const pointsOf = (text: string | null): string[] =>
  (text ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
export const pointsText = (points: string[]) => points.map((p) => p.trim()).join("\n");
