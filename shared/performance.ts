import { z } from "zod";
import type { Day } from "./dates";

/**
 * Helpdesk performance from Jira (J-1 to J-5): the five metrics, how a figure is judged
 * against its target, how a ticket's support level is read, and the shapes the screens use.
 */

export const metricKeys = ["first_response", "first_line", "sla_breaches", "backlog_age", "csat"] as const;
export type MetricKey = (typeof metricKeys)[number];

interface MetricInfo {
  label: string;
  /** What the headline figure is, in a few words. */
  measures: string;
  unit: "percent" | "days" | "rating";
  /** Whether the figure should be at least the target, or at most. Follows from the metric; it is not a choice. */
  direction: "at_least" | "at_most";
  /** The largest target that makes sense, in the metric's own unit. */
  max: number;
}
export const metricInfo: Record<MetricKey, MetricInfo> = {
  first_response: { label: "First response", measures: "answered within the agreed time", unit: "percent", direction: "at_least", max: 100 },
  first_line: { label: "First-line closure", measures: "solved without escalation", unit: "percent", direction: "at_least", max: 100 },
  sla_breaches: { label: "SLA breaches", measures: "resolved later than agreed", unit: "percent", direction: "at_most", max: 100 },
  backlog_age: { label: "Backlog age", measures: "age of the oldest open ticket", unit: "days", direction: "at_most", max: 3650 },
  csat: { label: "Satisfaction", measures: "average rating out of 5", unit: "rating", direction: "at_least", max: 5 },
};

/** Every figure is held in tenths, as a whole number: 88.5% is 885, 41 days is 410, a 4.3 rating is 43. */
export const shareTenths = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part * 1000) / whole) : null);

export type Verdict = "met" | "missed" | "none";
/**
 * The figure as shown (rounded to one decimal) is what is compared with the target, so the
 * screen can never show 95% next to "missed against 95%". No figure or no target: no verdict.
 */
export function judge(key: MetricKey, valueTenths: number | null, targetTenths: number | null): Verdict {
  if (valueTenths == null || targetTenths == null) return "none";
  return (metricInfo[key].direction === "at_least" ? valueTenths >= targetTenths : valueTenths <= targetTenths) ? "met" : "missed";
}

const oneDecimal = (tenths: number) => (tenths % 10 === 0 ? String(tenths / 10) : (tenths / 10).toFixed(1));
/** 88.5%, 41 days, 4.3: how a figure or a target reads on screen. */
export function formatMetric(key: MetricKey, tenths: number | null): string {
  if (tenths == null) return "–";
  const unit = metricInfo[key].unit;
  if (unit === "percent") return `${oneDecimal(tenths)}%`;
  if (unit === "days") return `${oneDecimal(tenths)} ${tenths === 10 ? "day" : "days"}`;
  return (tenths / 10).toFixed(1);
}
/** "95% or more", "30 days or less". */
export const formatTarget = (key: MetricKey, tenths: number) => `${formatMetric(key, tenths)} or ${metricInfo[key].direction === "at_least" ? "more" : "less"}`;

/** A target typed by a person, in the metric's own unit: "95", "4,2", "4.2". Null when it cannot be read; undefined when left empty. */
export function parseTarget(key: MetricKey, text: string): number | null | undefined {
  const t = text.trim().replace(",", ".").replace(/\s*%$/, "");
  if (!t) return undefined;
  if (!/^\d{1,4}(\.\d)?$/.test(t)) return null;
  const tenths = Math.round(Number(t) * 10);
  return tenths <= metricInfo[key].max * 10 ? tenths : null;
}

const target = (key: MetricKey) =>
  z
    .number("Enter a number.")
    .int("Use at most one decimal.")
    .min(0)
    .max(metricInfo[key].max * 10, `That is more than a ${metricInfo[key].label.toLowerCase()} target can be.`)
    .nullable()
    .optional();
/** Targets in tenths per metric. Null removes a target; a metric left out is not touched. */
export const targetsSchema = z.object({
  first_response: target("first_response"),
  first_line: target("first_line"),
  sla_breaches: target("sla_breaches"),
  backlog_age: target("backlog_age"),
  csat: target("csat").refine((v) => v == null || v >= 10, "A rating target is between 1 and 5."),
});
export type Targets = Record<MetricKey, number | null>;

// ---------- Months

export type Month = string;
export const isMonth = (v: unknown): v is Month => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const monthOf = (day: Day): Month => day.slice(0, 7);
export function addMonth(month: Month, n: number): Month {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
/** The `count` months ending with `last`, oldest first. */
export const monthsUpTo = (last: Month, count: number): Month[] => Array.from({ length: count }, (_, i) => addMonth(last, i - count + 1));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (month: Month) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
export const monthShort = (month: Month) => MONTHS[Number(month.slice(5)) - 1]!.slice(0, 3);

// ---------- Board link (J-1)

export const escalationMethods = ["status", "label"] as const;
export type EscalationMethod = (typeof escalationMethods)[number];

/** "Escalated, With vendor" typed in a box becomes a tidy list: trimmed, no blanks, no repeats ignoring case. */
export function splitValues(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/[,\n;]/)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}
const values = z
  .array(z.string().trim().min(1).max(100, "A status or label is at most 100 characters."))
  .max(20, "At most 20 values per level.")
  .default([])
  .transform((v) => splitValues(v.join("\n")));

export const boardLinkSchema = z.object({
  projectKey: z
    .string("Choose a board.")
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,19}$/, "A board key is 2 to 20 letters and digits, such as HELP."),
  escalationMethod: z.enum(escalationMethods, "Choose how escalation is recognised."),
  l1Values: values,
  l2Values: values,
  l3Values: values,
  active: z.boolean().default(true),
});
export type BoardLinkInput = z.infer<typeof boardLinkSchema>;

/** Problems with the level values that the field checks cannot see, keyed by field. */
export function checkLevels(link: Pick<BoardLinkInput, "escalationMethod" | "l1Values" | "l2Values" | "l3Values">): Record<string, string> {
  const errors: Record<string, string> = {};
  const what = link.escalationMethod === "status" ? "status" : "label";
  if (!link.l2Values.length && !link.l3Values.length) errors.l2Values = `Give at least one ${what} that means level 2 or level 3. Without one, every ticket would count as solved by the first line.`;
  const taken = new Map<string, string>();
  for (const [field, level] of [
    ["l1Values", "level 1"],
    ["l2Values", "level 2"],
    ["l3Values", "level 3"],
  ] as const) {
    for (const v of link[field]) {
      const earlier = taken.get(v.toLowerCase());
      if (earlier) errors[field] ??= `"${v}" is already listed for ${earlier}. A ${what} can mean only one level.`;
      else taken.set(v.toLowerCase(), level);
    }
  }
  return errors;
}

/**
 * The highest support level a ticket ever reached: 3 if it ever carried a level 3 value,
 * else 2 if it ever carried a level 2 value, else 1. A ticket that never carried any listed
 * value counts as level 1: it was never escalated.
 */
export function highestLevel(seen: string[], link: { l2Values: string[]; l3Values: string[] }): 1 | 2 | 3 {
  const had = new Set(seen.map((s) => s.toLowerCase()));
  const any = (list: string[]) => list.some((v) => had.has(v.toLowerCase()));
  return any(link.l3Values) ? 3 : any(link.l2Values) ? 2 : 1;
}

export interface BoardLink {
  id: string;
  vendorId: string;
  projectKey: string;
  projectName: string | null;
  escalationMethod: EscalationMethod;
  l1Values: string[];
  l2Values: string[];
  l3Values: string[];
  active: boolean;
  /** When tickets were last fetched successfully. */
  lastSyncedAt: string | null;
  lastAttemptAt: string | null;
  /** Null until the first attempt. */
  lastSyncOk: boolean | null;
  /** What went wrong at the last attempt, in plain language. */
  lastSyncMessage: string | null;
  /** How many tickets the last successful sync added or updated. */
  lastSyncUpdated: number | null;
  tickets: number;
}

export interface JiraBoardChoice {
  key: string;
  name: string;
  /** The vendor this board is already linked to, if any. */
  linkedTo: string | null;
}

/** What "Test link" found. Never an error reply: a failed test is an answer too. */
export interface LinkTest {
  ok: boolean;
  /** One sentence saying what was found or what went wrong. */
  message: string;
  /** Things worth knowing that do not stop the link from working. */
  warnings: string[];
  statuses: string[];
  labels: string[];
}

// ---------- Monthly metrics (J-3)

/** The counts behind one vendor's month. Every headline figure is worked out from these, in code. */
export interface MonthCounts {
  /** Tickets created in the month for which Jira has a first-response outcome. */
  frMeasured: number;
  frMet: number;
  frMedianMinutes: number | null;
  /** Tickets resolved in the month. */
  resolved: number;
  firstLine: number;
  breached: number;
  /** Open at the end of the month (or now, for the current month). */
  backlog: number;
  backlogMedianDays: number | null;
  backlogOldestDays: number | null;
  /** Ratings given in the month. */
  ratings: number;
  ratingSum: number;
}
export const emptyCounts: MonthCounts = {
  frMeasured: 0,
  frMet: 0,
  frMedianMinutes: null,
  resolved: 0,
  firstLine: 0,
  breached: 0,
  backlog: 0,
  backlogMedianDays: null,
  backlogOldestDays: null,
  ratings: 0,
  ratingSum: 0,
};

/** The headline figure of each metric, in tenths. Null when there was nothing to measure. */
export function headline(c: MonthCounts): Record<MetricKey, number | null> {
  return {
    first_response: shareTenths(c.frMet, c.frMeasured),
    first_line: shareTenths(c.firstLine, c.resolved),
    sla_breaches: shareTenths(c.breached, c.resolved),
    // No open tickets is the best backlog there is: zero days.
    backlog_age: (c.backlogOldestDays ?? 0) * 10,
    csat: c.ratings > 0 ? Math.round((c.ratingSum * 10) / c.ratings) : null,
  };
}

export interface MetricCell {
  valueTenths: number | null;
  targetTenths: number | null;
  verdict: Verdict;
}
export interface MonthMetrics {
  month: Month;
  counts: MonthCounts;
  cells: Record<MetricKey, MetricCell>;
  /** How many targets were missed this month. */
  missed: number;
}
export function monthMetrics(month: Month, counts: MonthCounts, targets: Targets): MonthMetrics {
  const values = headline(counts);
  const cells = Object.fromEntries(
    metricKeys.map((k) => [k, { valueTenths: values[k], targetTenths: targets[k], verdict: judge(k, values[k], targets[k]) }]),
  ) as Record<MetricKey, MetricCell>;
  return { month, counts, cells, missed: metricKeys.filter((k) => cells[k].verdict === "missed").length };
}

/** 45 min, 3 h 20 min, 2 days 4 h. */
export function formatDuration(minutes: number | null): string {
  if (minutes == null) return "–";
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  return `${days} ${days === 1 ? "day" : "days"}${hours ? ` ${hours} h` : ""}`;
}

/** The sets of tickets a figure can open (J-3). Each is defined once, in the performance repo. */
export const ticketSets = ["fr_measured", "fr_met", "fr_missed", "resolved", "first_line", "escalated", "breached", "backlog", "rated"] as const;
export type TicketSet = (typeof ticketSets)[number];
export const ticketSetLabels: Record<TicketSet, string> = {
  fr_measured: "Tickets created, with a first-response result",
  fr_met: "Tickets answered within the agreed time",
  fr_missed: "Tickets answered late, or still waiting past the agreed time",
  resolved: "Tickets resolved",
  first_line: "Tickets solved by the first line",
  escalated: "Tickets that went beyond the first line",
  breached: "Tickets resolved later than agreed",
  backlog: "Tickets open at the end of the month",
  rated: "Tickets rated by the person who asked",
};

export interface Ticket {
  id: string;
  key: string;
  summary: string | null;
  status: string | null;
  createdAt: string;
  resolvedAt: string | null;
  firstResponseAt: string | null;
  firstResponseBreached: boolean | null;
  resolutionBreached: boolean | null;
  highestLevel: number;
  csat: number | null;
  /** Where the ticket lives in Jira; null with the stand-in. */
  url: string | null;
}

export interface VendorPerformance {
  vendor: { id: string; name: string; scoringEnabled: boolean };
  link: BoardLink | null;
  targets: Targets;
  /** Twelve months, oldest first, ending with the chosen month. */
  months: MonthMetrics[];
  /** The latest month that can be chosen: the current one. */
  currentMonth: Month;
}

export interface OverviewRow {
  vendorId: string;
  vendorName: string;
  link: BoardLink;
  metrics: MonthMetrics;
}
export interface PerformanceOverview {
  month: Month;
  currentMonth: Month;
  rows: OverviewRow[];
  /** Scored vendors that have no Jira board yet. */
  unlinked: { id: string; name: string }[];
  /** How often tickets are fetched without anyone asking, in minutes. Zero when switched off. */
  syncEveryMinutes: number;
}
export const overviewSorts = ["vendor", "missed", ...metricKeys] as const;
export type OverviewSort = (typeof overviewSorts)[number];

export interface SyncOutcome {
  vendorName: string;
  projectKey: string;
  ok: boolean;
  updated: number;
  message: string | null;
}
