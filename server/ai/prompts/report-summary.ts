import { z } from "zod";
import { agreementName } from "../../../shared/agreements";
import { formatDay } from "../../../shared/dates";
import { currenciesIn, formatMoney, rateText } from "../../../shared/money";
import { REPORT_ENDING_DAYS, trendWords, type ReportData } from "../../../shared/overview";
import { formatMetric, formatTarget, metricInfo, monthName } from "../../../shared/performance";
import { formatScore, quarterName } from "../../../shared/scorecards";
import { ungrounded } from "../grounding";
import type { Prompt } from "../index";

/** The names people typed that the report's figures are listed under. */
export const reportNames = (d: ReportData): string[] => [
  ...d.spend.byVendor.map((v) => v.vendorName),
  ...d.sows.flatMap((s) => [s.vendorName, s.title]),
  ...d.ending.flatMap((e) => [e.vendorName, e.title]),
  ...d.scores.map((s) => s.vendorName),
  ...d.missed.map((m) => m.vendorName),
  ...d.rfps.map((r) => r.title),
];

const output = z.object({ summary: z.string().trim().min(1).max(1200) });
export type ReportSummaryOutput = z.infer<typeof output>;

/**
 * D-2: the summary paragraph of the monthly management report. The model is given the
 * report's figures, already worked out and written the way the report prints them, and
 * may quote them but not add to them.
 */
export const reportSummary: Prompt<ReportData, ReportSummaryOutput> = {
  kind: "report_summary",
  version: "report-summary/2",
  tier: "strong",
  maxTokens: 700,
  system: [
    "You write the opening paragraph of a monthly vendor report for an IT management team. You are given the report's figures as JSON: what was invoiced in the month, SOW budgets and how much of each is used, agreements that end soon, vendor scores with their trend, missed helpdesk targets and open RFPs.",
    "Write one paragraph of three to five plain sentences, in British English, that tells a manager what matters most this month: what needs a decision or attention first, then what is going well. Name vendors and agreements as they are given.",
    "Each amount is written with its own currency. A total across currencies is given in euros as togetherInEuros, converted by the app at the rates in convertedAt; when you speak of a total, use that one.",
    "Quote figures exactly as they are written in the input. Do not calculate, round, add up or estimate anything, and do not mention a number, date or amount that is not in the input. If a section is empty, either leave it out or say plainly that there is nothing to report.",
    "No headings, no bullet points, no greeting, and no advice beyond what the figures support.",
    'Answer with one JSON object and nothing else, shaped as {"summary":"..."}.',
  ].join("\n"),
  input: (d) => ({
    task: "report_summary",
    month: monthName(d.month),
    figuresAsAt: formatDay(d.asAt),
    // The windows the report uses, so that "ending in the next 90 days" is a figure the model was given.
    windows: { agreementsEndingWithin: `${REPORT_ENDING_DAYS} days` },
    invoicedInTheMonth: {
      inEachCurrency: currenciesIn(d.spend.total.amounts).map((c) => formatMoney(d.spend.total.amounts[c]!, c)),
      togetherInEuros: formatMoney(d.spend.total.eurMinor, "EUR"),
      convertedAt: d.spend.rates.map(rateText),
      byVendor: d.spend.byVendor.map((v) => ({ vendor: v.vendorName, togetherInEuros: formatMoney(v.eurMinor, "EUR") })),
    },
    sowBudgets: d.sows.map((s) => ({
      vendor: s.vendorName,
      sow: s.title,
      budget: formatMoney(s.budget.budgetMinor ?? 0, s.currency),
      invoiced: formatMoney(s.budget.invoicedMinor, s.currency),
      used: s.budget.usedPct == null ? "no budget" : `${s.budget.usedPct}%`,
      state: s.budget.state === "over" ? "over budget" : s.budget.state === "warn" ? "close to budget" : "within budget",
    })),
    agreementsEndingSoon: d.ending.map((e) => ({
      vendor: e.vendorName,
      agreement: agreementName(e.kind, e.title),
      ends: formatDay(e.endDate),
      noticeDeadline: e.noticeDeadline ? formatDay(e.noticeDeadline) : null,
    })),
    vendorScores: d.scores.map((s) => ({
      vendor: s.vendorName,
      score: `${formatScore(s.overallTenths)} out of 5`,
      quarter: quarterName(s.quarter),
      trend: trendWords[s.trend],
      before: s.previousTenths == null ? null : formatScore(s.previousTenths),
    })),
    missedHelpdeskTargets: d.missed.map((m) => ({
      vendor: m.vendorName,
      measure: metricInfo[m.metric].label,
      figure: formatMetric(m.metric, m.valueTenths),
      target: formatTarget(m.metric, m.targetTenths),
    })),
    helpdeskVendorsMeasured: d.measuredVendors,
    openRfps: d.rfps.map((r) => ({ title: r.title, stage: r.stage })),
  }),
  output,
  check: (d, o) => {
    const extra = ungrounded(o.summary, reportSummary.input(d), reportNames(d));
    return extra.length ? `the summary quotes ${extra.join(", ")}, which is not among the figures provided` : null;
  },
};
