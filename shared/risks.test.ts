import { describe, expect, it } from "vitest";
import { emptyCounts, monthMetrics, type MetricKey, type MonthMetrics, type Targets } from "./performance";
import { budgetTrend, metricRiskFlags, sowRiskFlags, worseningMetrics, type RiskSow } from "./risks";

const TODAY = "2026-11-21";
const sow = (o: Partial<RiskSow> = {}): RiskSow => ({
  id: "s1",
  vendorId: "v1",
  vendorName: "Sample Vendor",
  title: "SOW 01",
  ownerUserId: "u1",
  pricing: "time_and_materials",
  startDate: "2026-09-22", // 60 days ago
  endDate: "2027-01-20", // 120 days after the start
  budgetMinor: 40_000_00,
  invoicedMinor: 27_000_00,
  currency: "EUR",
  openMilestones: [],
  ...o,
});

describe("R-1 a SOW whose invoicing points to an overrun before its end date", () => {
  it("projects the pace so far to the end date and names the day the budget runs out", () => {
    // 27,000 in 60 days is 450 a day: 54,000 by day 120, and 40,000 is reached on day 89.
    expect(budgetTrend(sow(), TODAY)).toEqual({ elapsedDays: 60, totalDays: 120, projectedMinor: 54_000_00, runsOutOn: "2026-12-20" });
  });

  it("raises a flag that states the facts behind it", () => {
    const [flag, ...rest] = sowRiskFlags([sow()], TODAY, 30);
    expect(rest).toEqual([]);
    expect(flag).toMatchObject({ type: "risk_budget_trend", tone: "warn", label: "Heading over budget", agreementId: "s1", title: "Sample Vendor · SOW 01", date: "2026-12-20" });
    expect(flag!.detail).toBe(
      "€ 27,000.00 of the € 40,000.00 budget has been invoiced in 60 of 120 days. At this pace the budget runs out around 20 Dec 2026, before the end date of 20 Jan 2027, and about € 54,000.00 would be invoiced by then.",
    );
  });

  it("stays quiet when the pace fits the budget", () => {
    expect(sowRiskFlags([sow({ invoicedMinor: 20_000_00 })], TODAY, 30)).toEqual([]);
    // Exactly on budget at the end date is not an overrun.
    expect(sowRiskFlags([sow({ invoicedMinor: 20_000_00, budgetMinor: 40_000_00 })], TODAY, 30)).toEqual([]);
  });

  it("does not judge a SOW that has only just started, has ended, has no budget, or is already over budget", () => {
    expect(budgetTrend(sow({ startDate: "2026-10-23" }), TODAY)).toBeNull(); // 29 days
    expect(budgetTrend(sow({ startDate: "2026-10-22" }), TODAY)).not.toBeNull(); // 30 days
    expect(budgetTrend(sow({ endDate: "2026-11-20" }), TODAY)).toBeNull();
    expect(budgetTrend(sow({ endDate: TODAY }), TODAY)).toBeNull();
    expect(budgetTrend(sow({ budgetMinor: null }), TODAY)).toBeNull();
    expect(budgetTrend(sow({ startDate: null }), TODAY)).toBeNull();
    expect(budgetTrend(sow({ invoicedMinor: 0 }), TODAY)).toBeNull();
    expect(budgetTrend(sow({ invoicedMinor: 40_000_01 }), TODAY)).toBeNull();
  });

  it("applies to a fixed-price SOW as well", () => {
    expect(sowRiskFlags([sow({ pricing: "fixed" })], TODAY, 30).map((f) => f.type)).toEqual(["risk_budget_trend"]);
  });

  it("works in pounds too", () => {
    expect(sowRiskFlags([sow({ currency: "GBP" })], TODAY, 30)[0]!.detail).toContain("£ 27,000.00 of the £ 40,000.00 budget");
  });
});

describe("R-1 a SOW ending within the window with open milestones", () => {
  const ending = (o: Partial<RiskSow> = {}) => sow({ invoicedMinor: 0, endDate: "2026-12-09", openMilestones: [{ title: "Recommendations", dueDate: "2026-12-01" }], ...o });

  it("names the end date and the milestones still open", () => {
    const flags = sowRiskFlags([ending()], TODAY, 30);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ type: "risk_open_milestones", label: "1 open milestone", date: "2026-12-09" });
    expect(flags[0]!.detail).toBe("It ends on 9 Dec 2026, in 18 days, and one milestone is still open: Recommendations (due 1 Dec 2026).");
  });

  it("lists up to three, soonest first, and counts the rest", () => {
    const open = ["D", "C", "B", "A"].map((title, i) => ({ title, dueDate: `2026-12-0${4 - i}` }));
    const flag = sowRiskFlags([ending({ openMilestones: open })], TODAY, 30)[0]!;
    expect(flag.label).toBe("4 open milestones");
    expect(flag.detail).toContain("4 milestones are still open: A (due 1 Dec 2026), B (due 2 Dec 2026), C (due 3 Dec 2026) and 1 more.");
  });

  it("follows the window: the last day counts, the day after does not, and neither does a SOW already past its end", () => {
    expect(sowRiskFlags([ending({ endDate: "2026-12-21" })], TODAY, 30)).toHaveLength(1);
    expect(sowRiskFlags([ending({ endDate: "2026-12-22" })], TODAY, 30)).toHaveLength(0);
    expect(sowRiskFlags([ending({ endDate: "2026-12-22" })], TODAY, 45)).toHaveLength(1);
    expect(sowRiskFlags([ending({ endDate: TODAY })], TODAY, 30)[0]!.detail).toContain("today");
    expect(sowRiskFlags([ending({ endDate: "2026-11-20" })], TODAY, 30)).toHaveLength(0);
  });

  it("stays quiet when every milestone is delivered or cancelled", () => {
    expect(sowRiskFlags([ending({ openMilestones: [] })], TODAY, 30)).toEqual([]);
  });
});

describe("R-1 a metric that got worse three months in a row", () => {
  const targets: Targets = { first_response: 950, first_line: null, sla_breaches: 100, backlog_age: null, csat: null };
  /** A month where `met` of 1000 first responses were in time and `late` of 1000 resolutions were late. */
  const month = (m: string, met: number | null, late: number | null = 50): MonthMetrics =>
    monthMetrics(
      m,
      { ...emptyCounts, frMeasured: met == null ? 0 : 1000, frMet: met ?? 0, resolved: late == null ? 0 : 1000, breached: late ?? 0, firstLine: late == null ? 0 : 700 },
      targets,
    );
  const months = (values: (number | null)[], late: (number | null)[] = [50, 50, 50, 50]) => values.map((v, i) => month(`2026-${String(7 + i).padStart(2, "0")}`, v, late[i]));
  const keys = (list: MonthMetrics[]): MetricKey[] => worseningMetrics(list).map((w) => w.key);

  it("flags a figure that fell three times running, where higher is better", () => {
    expect(keys(months([961, 940, 912, 880]))).toEqual(["first_response"]);
  });

  it("flags a figure that rose three times running, where lower is better", () => {
    expect(keys(months([950, 950, 950, 950], [20, 40, 60, 90]))).toEqual(["sla_breaches"]);
  });

  it("needs every step to be worse: a month that held or recovered breaks the run", () => {
    expect(keys(months([961, 940, 940, 880]))).toEqual([]);
    expect(keys(months([961, 940, 950, 880]))).toEqual([]);
    expect(keys(months([900, 961, 940, 912]))).toEqual([]);
  });

  it("needs four measured months: a month with nothing measured breaks the run", () => {
    expect(keys(months([961, 940, 912]))).toEqual([]);
    expect(keys(months([961, null, 912, 880]))).toEqual([]);
    expect(keys(months([null, 940, 912, 880]))).toEqual([]);
  });

  it("looks at the last four months only", () => {
    expect(keys([month("2026-06", 990), ...months([980, 985, 912, 880])])).toEqual([]);
    expect(keys([month("2026-06", 700), ...months([961, 940, 912, 880])])).toEqual(["first_response"]);
  });

  it("states the four figures and the target", () => {
    const flags = metricRiskFlags([{ vendorId: "v1", vendorName: "Sample Vendor", ownerUserId: "u1", months: months([961, 940, 912, 880]) }]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ type: "risk_metric_worsening", tone: "warn", label: "Getting worse", title: "Sample Vendor · First response", agreementId: null });
    expect(flags[0]!.detail).toBe(
      "First response (answered within the agreed time) got worse three months in a row: 96.1% in Jul, 94% in Aug, 91.2% in Sep, 88% in Oct 2026. The target is 95% or more.",
    );
  });

  it("leaves the target out when there is none", () => {
    const list = months([961, 940, 912, 880]).map((m) => ({ ...m, cells: { ...m.cells, first_response: { ...m.cells.first_response, targetTenths: null } } }));
    expect(metricRiskFlags([{ vendorId: "v1", vendorName: "V", ownerUserId: "u1", months: list }])[0]!.detail).not.toContain("target");
  });
});
