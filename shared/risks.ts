import { addDays, daysBetween, formatDay, type Day } from "./dates";
import { formatMoney, type Currency } from "./money";
import { formatMetric, formatTarget, metricInfo, metricKeys, monthName, monthShort, type MetricKey, type MonthMetrics } from "./performance";
import type { Warning } from "./vendors";

/**
 * Risk flags (R-1): things that are not wrong yet but are heading that way. Each is a
 * plain rule worked out from the app's own figures, and each says which facts set it off.
 * They are shown with the warnings, in the same shape.
 */

/** A SOW's invoicing is only judged once it has run this long, so one early invoice does not raise a flag. */
export const TREND_MIN_DAYS = 30;
/** A metric is flagged when it got worse this many months running. */
export const WORSENING_MONTHS = 3;

export interface RiskSow {
  id: string;
  vendorId: string;
  vendorName: string;
  title: string;
  ownerUserId: string;
  pricing: "fixed" | "time_and_materials" | null;
  startDate: Day | null;
  endDate: Day | null;
  budgetMinor: number | null;
  invoicedMinor: number;
  currency: Currency;
  /** Milestones that are neither delivered nor cancelled. */
  openMilestones: { title: string; dueDate: Day }[];
}

export interface BudgetTrend {
  elapsedDays: number;
  totalDays: number;
  /** What would be invoiced by the end date if invoicing went on at the same pace. */
  projectedMinor: number;
  /** The day the budget would be used up at that pace. */
  runsOutOn: Day;
}

/**
 * Where a SOW's invoicing is heading. The pace is what has been invoiced so far, spread
 * over the days since the start date. Null when there is nothing to judge: no budget or
 * dates, not yet running for `TREND_MIN_DAYS`, already ended, or already over budget
 * (which is a warning of its own).
 */
export function budgetTrend(s: Pick<RiskSow, "startDate" | "endDate" | "budgetMinor" | "invoicedMinor">, today: Day): BudgetTrend | null {
  if (s.budgetMinor == null || s.budgetMinor <= 0 || !s.startDate || !s.endDate) return null;
  if (s.invoicedMinor <= 0 || s.invoicedMinor > s.budgetMinor) return null;
  const elapsedDays = daysBetween(s.startDate, today);
  const totalDays = daysBetween(s.startDate, s.endDate);
  if (elapsedDays < TREND_MIN_DAYS || today > s.endDate || totalDays <= elapsedDays) return null;
  return {
    elapsedDays,
    totalDays,
    projectedMinor: Math.round((s.invoicedMinor * totalDays) / elapsedDays),
    runsOutOn: addDays(s.startDate, Math.ceil((s.budgetMinor * elapsedDays) / s.invoicedMinor)),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const inDays = (n: number) => (n === 0 ? "today" : `in ${plural(n, "day")}`);

/**
 * Flags for SOWs: invoicing that points to an overrun before the end date (time and
 * materials only: a fixed price is invoiced by milestone, not at a pace), and a SOW about
 * to end while milestones are still open.
 */
export function sowRiskFlags(sows: RiskSow[], today: Day, sowEndDays: number): Warning[] {
  const out: Warning[] = [];
  for (const s of sows) {
    const base = { vendorId: s.vendorId, vendorName: s.vendorName, agreementId: s.id, ownerUserId: s.ownerUserId, title: `${s.vendorName} · ${s.title}`, tone: "warn" as const };
    const trend = s.pricing === "time_and_materials" ? budgetTrend(s, today) : null;
    if (trend && trend.projectedMinor > s.budgetMinor! && trend.runsOutOn < s.endDate!) {
      const money = (minor: number) => formatMoney(minor, s.currency);
      out.push({
        ...base,
        type: "risk_budget_trend",
        label: "Heading over budget",
        detail:
          `${money(s.invoicedMinor)} of the ${money(s.budgetMinor!)} budget has been invoiced in ${trend.elapsedDays} of ${trend.totalDays} days. ` +
          `At this pace the budget runs out around ${formatDay(trend.runsOutOn)}, before the end date of ${formatDay(s.endDate!)}, ` +
          `and about ${money(trend.projectedMinor)} would be invoiced by then.`,
        date: trend.runsOutOn,
      });
    }
    if (s.endDate && s.openMilestones.length) {
      const left = daysBetween(today, s.endDate);
      if (left >= 0 && left <= sowEndDays) {
        const open = [...s.openMilestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));
        const named = open.slice(0, 3).map((m) => `${m.title} (due ${formatDay(m.dueDate)})`);
        const more = open.length - named.length;
        out.push({
          ...base,
          type: "risk_open_milestones",
          label: plural(open.length, "open milestone"),
          detail: `It ends on ${formatDay(s.endDate)}, ${inDays(left)}, and ${open.length === 1 ? "one milestone is" : `${open.length} milestones are`} still open: ${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`,
          date: s.endDate,
        });
      }
    }
  }
  return out;
}

export interface RiskVendorMonths {
  vendorId: string;
  vendorName: string;
  ownerUserId: string;
  /** Whole months, oldest first, ending with the last month that is over. */
  months: MonthMetrics[];
}

/** Whether a figure is worse than the one before it, given which way is better for the metric. */
export const worse = (key: MetricKey, before: number, after: number) => (metricInfo[key].direction === "at_least" ? after < before : after > before);

/**
 * The metrics that got worse three months in a row: over the last four whole months each
 * figure is worse than the one before. A month with nothing measured breaks the run.
 */
export function worseningMetrics(months: MonthMetrics[]): { key: MetricKey; months: MonthMetrics[] }[] {
  const last = months.slice(-(WORSENING_MONTHS + 1));
  if (last.length < WORSENING_MONTHS + 1) return [];
  return metricKeys
    .filter((key) =>
      last.every((m, i) => {
        const value = m.cells[key].valueTenths;
        const before = i === 0 ? null : last[i - 1]!.cells[key].valueTenths;
        return value != null && (i === 0 || (before != null && worse(key, before, value)));
      }),
    )
    .map((key) => ({ key, months: last }));
}

/** Flags for helpdesk vendors whose figures keep getting worse. */
export function metricRiskFlags(vendors: RiskVendorMonths[]): Warning[] {
  const out: Warning[] = [];
  for (const v of vendors) {
    for (const { key, months } of worseningMetrics(v.months)) {
      const info = metricInfo[key];
      const latest = months.at(-1)!;
      const target = latest.cells[key].targetTenths;
      const run = months.map((m, i) => `${formatMetric(key, m.cells[key].valueTenths)} in ${i === months.length - 1 ? monthName(m.month) : monthShort(m.month)}`);
      out.push({
        type: "risk_metric_worsening",
        tone: "warn",
        label: "Getting worse",
        title: `${v.vendorName} · ${info.label}`,
        detail: `${info.label} (${info.measures}) got worse three months in a row: ${run.join(", ")}.${target == null ? "" : ` The target is ${formatTarget(key, target)}.`}`,
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        agreementId: null,
        ownerUserId: v.ownerUserId,
        date: null,
      });
    }
  }
  return out;
}
