import { describe, expect, it } from "vitest";
import {
  addMonth,
  boardLinkSchema,
  checkLevels,
  emptyCounts,
  formatDuration,
  formatMetric,
  formatTarget,
  headline,
  highestLevel,
  isMonth,
  judge,
  monthMetrics,
  monthName,
  monthsUpTo,
  parseTarget,
  shareTenths,
  splitValues,
  targetsSchema,
} from "./performance";

describe("figures and targets (J-3, J-4)", () => {
  it("holds a share in tenths of a percent, rounded to one decimal", () => {
    expect(shareTenths(44, 49)).toBe(898);
    expect(shareTenths(1, 3)).toBe(333);
    expect(shareTenths(2, 3)).toBe(667);
    expect(shareTenths(0, 5)).toBe(0);
    expect(shareTenths(5, 5)).toBe(1000);
  });
  it("has no figure when there was nothing to measure", () => expect(shareTenths(0, 0)).toBeNull());

  it("judges 'at least' metrics: on the target is met, a tenth under is missed", () => {
    expect(judge("first_response", 950, 950)).toBe("met");
    expect(judge("first_response", 949, 950)).toBe("missed");
    expect(judge("csat", 43, 40)).toBe("met");
    expect(judge("first_line", 600, 650)).toBe("missed");
  });
  it("judges 'at most' metrics the other way round", () => {
    expect(judge("sla_breaches", 50, 50)).toBe("met");
    expect(judge("sla_breaches", 51, 50)).toBe("missed");
    expect(judge("backlog_age", 410, 300)).toBe("missed");
    expect(judge("backlog_age", 0, 300)).toBe("met");
  });
  it("gives no verdict without a figure or without a target", () => {
    expect(judge("csat", null, 40)).toBe("none");
    expect(judge("csat", 43, null)).toBe("none");
  });
  it("judges the figure as shown, so 94.96% reads 95% and meets a 95% target", () => {
    const shown = shareTenths(9496, 10000)!;
    expect(formatMetric("first_response", shown)).toBe("95%");
    expect(judge("first_response", shown, 950)).toBe("met");
  });

  it("writes figures the way people read them", () => {
    expect(formatMetric("first_response", 885)).toBe("88.5%");
    expect(formatMetric("first_response", 880)).toBe("88%");
    expect(formatMetric("backlog_age", 410)).toBe("41 days");
    expect(formatMetric("backlog_age", 10)).toBe("1 day");
    expect(formatMetric("csat", 40)).toBe("4.0");
    expect(formatMetric("csat", null)).toBe("–");
    expect(formatTarget("first_response", 950)).toBe("95% or more");
    expect(formatTarget("backlog_age", 300)).toBe("30 days or less");
  });
  it("reads a typed target with a comma or a point, and refuses what is not a number or is out of range", () => {
    expect(parseTarget("first_response", "95")).toBe(950);
    expect(parseTarget("first_response", "97,5 %")).toBe(975);
    expect(parseTarget("csat", "4.2")).toBe(42);
    expect(parseTarget("csat", "")).toBeUndefined();
    expect(parseTarget("csat", "6")).toBeNull();
    expect(parseTarget("first_response", "101")).toBeNull();
    expect(parseTarget("first_response", "9.55")).toBeNull();
    expect(parseTarget("backlog_age", "soon")).toBeNull();
  });
  it("refuses targets outside what the metric can be", () => {
    expect(targetsSchema.safeParse({ first_response: 1001 }).success).toBe(false);
    expect(targetsSchema.safeParse({ csat: 5 }).success).toBe(false);
    expect(targetsSchema.safeParse({ csat: 51 }).success).toBe(false);
    expect(targetsSchema.safeParse({ csat: 42, backlog_age: null }).success).toBe(true);
    expect(targetsSchema.safeParse({ sla_breaches: 4.5 }).success).toBe(false);
  });

  it("works out each headline figure from the month's counts", () => {
    const counts = { ...emptyCounts, frMeasured: 4, frMet: 3, resolved: 4, firstLine: 2, breached: 1, existed: 9, backlog: 2, backlogOldestDays: 31, ratings: 3, ratingSum: 13 };
    expect(headline(counts)).toEqual({ first_response: 750, first_line: 500, sla_breaches: 250, backlog_age: 310, csat: 43 });
  });
  it("has no figure at all for a month before the board's first ticket, and a backlog of zero days once the helpdesk runs with nothing open", () => {
    expect(headline(emptyCounts)).toEqual({ first_response: null, first_line: null, sla_breaches: null, backlog_age: null, csat: null });
    expect(headline({ ...emptyCounts, existed: 12 }).backlog_age).toBe(0);
    expect(judge("backlog_age", headline(emptyCounts).backlog_age, 300)).toBe("none");
    expect(judge("backlog_age", headline({ ...emptyCounts, existed: 12 }).backlog_age, 300)).toBe("met");
  });
  it("counts the targets missed in a month", () => {
    const counts = { ...emptyCounts, frMeasured: 10, frMet: 8, resolved: 10, firstLine: 9, breached: 2 };
    const m = monthMetrics("2026-10", counts, { first_response: 950, first_line: 650, sla_breaches: 50, backlog_age: null, csat: 40 });
    expect(m.cells.first_response.verdict).toBe("missed");
    expect(m.cells.first_line.verdict).toBe("met");
    expect(m.cells.sla_breaches.verdict).toBe("missed");
    expect(m.cells.backlog_age.verdict).toBe("none");
    expect(m.cells.csat.verdict).toBe("none");
    expect(m.missed).toBe(2);
  });
  it("writes a response time in minutes, hours or days", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(200)).toBe("3 h 20 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(3120)).toBe("2 days 4 h");
    expect(formatDuration(null)).toBe("–");
  });
});

describe("months", () => {
  it("recognises a month and steps across years", () => {
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(isMonth("0050-01")).toBe(false);
    expect(addMonth("2026-01", -1)).toBe("2025-12");
    expect(addMonth("2026-12", 1)).toBe("2027-01");
    expect(monthName("2026-11")).toBe("November 2026");
  });
  it("lists twelve months ending with the chosen one, oldest first", () => {
    const months = monthsUpTo("2026-11", 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-12");
    expect(months.at(-1)).toBe("2026-11");
  });
});

describe("board link and support levels (J-1)", () => {
  const link = { l2Values: ["Escalated to second line"], l3Values: ["With vendor engineering"] };
  it("takes the highest level a ticket ever carried, ignoring case", () => {
    expect(highestLevel(["waiting for support", "in progress", "resolved"], link)).toBe(1);
    expect(highestLevel(["in progress", "escalated to second line", "resolved"], link)).toBe(2);
    expect(highestLevel(["ESCALATED TO SECOND LINE", "with vendor engineering"], link)).toBe(3);
  });
  it("counts a ticket that never carried a listed value as level 1", () => {
    expect(highestLevel([], link)).toBe(1);
    expect(highestLevel(["something else"], link)).toBe(1);
  });

  it("tidies a typed list of values", () => {
    expect(splitValues(" tier-2,  Tier-2 ;tier-3\n\n second   line ")).toEqual(["tier-2", "tier-3", "second line"]);
  });
  it("needs a value for level 2 or level 3", () => {
    expect(checkLevels({ escalationMethod: "label", l1Values: ["x"], l2Values: [], l3Values: [] }).l2Values).toMatch(/at least one label/);
    expect(checkLevels({ escalationMethod: "label", l1Values: [], l2Values: [], l3Values: ["tier-3"] })).toEqual({});
  });
  it("refuses one value for two levels, ignoring case", () => {
    const errors = checkLevels({ escalationMethod: "status", l1Values: ["Open"], l2Values: ["Escalated"], l3Values: ["escalated"] });
    expect(errors.l3Values).toBe('"escalated" is already listed for level 2. A status can mean only one level.');
  });
  it("stores a board key in capitals and refuses what is not a key", () => {
    const ok = boardLinkSchema.parse({ projectKey: " blu ", escalationMethod: "status", l2Values: ["A", "a ", ""].filter(Boolean) });
    expect(ok.projectKey).toBe("BLU");
    expect(ok.l2Values).toEqual(["A"]);
    expect(ok.active).toBe(true);
    expect(boardLinkSchema.safeParse({ projectKey: "B", escalationMethod: "status" }).success).toBe(false);
    expect(boardLinkSchema.safeParse({ projectKey: "BLU; drop", escalationMethod: "status" }).success).toBe(false);
    expect(boardLinkSchema.safeParse({ projectKey: "BLU", escalationMethod: "guess" }).success).toBe(false);
  });
});
