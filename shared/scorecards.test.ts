import { describe, expect, it } from "vitest";
import {
  addQuarter,
  checkCriterion,
  criterionSchema,
  isQuarter,
  overallTenths,
  quarterBounds,
  quarterName,
  quarterOf,
  scorecardSaveSchema,
  suggestedScore,
  unscored,
} from "./scorecards";

describe("quarters", () => {
  it("finds the quarter of a day and its first and last day", () => {
    expect(quarterOf("2026-11-21")).toBe("2026-Q4");
    expect(quarterOf("2026-01-01")).toBe("2026-Q1");
    expect(quarterOf("2026-09-30")).toBe("2026-Q3");
    expect(quarterBounds("2026-Q3")).toEqual({ start: "2026-07-01", end: "2026-09-30", months: ["2026-07", "2026-08", "2026-09"] });
    expect(quarterBounds("2028-Q1").end).toBe("2028-03-31");
    expect(quarterBounds("2026-Q4").end).toBe("2026-12-31");
    expect(quarterName("2026-Q3")).toBe("Q3 2026");
  });
  it("steps across years", () => {
    expect(addQuarter("2026-Q4", 1)).toBe("2027-Q1");
    expect(addQuarter("2026-Q1", -1)).toBe("2025-Q4");
    expect(addQuarter("2026-Q4", -1)).toBe("2026-Q3");
  });
  it("knows what is not a quarter", () => {
    expect(isQuarter("2026-Q4")).toBe(true);
    for (const v of ["2026-Q5", "2026-Q0", "2026-4", "Q4 2026", 20264, null]) expect(isQuarter(v)).toBe(false);
  });
});

describe("the overall score", () => {
  it("is the weighted average of the scored lines, to one decimal", () => {
    expect(
      overallTenths([
        { score: 4, weight: 20 },
        { score: 2, weight: 20 },
      ]),
    ).toBe(30);
    // (5*30 + 3*10) / 40 = 4.5
    expect(
      overallTenths([
        { score: 5, weight: 30 },
        { score: 3, weight: 10 },
      ]),
    ).toBe(45);
    // (4 + 4 + 5) / 3 = 4.33 -> 4.3
    expect(overallTenths([4, 4, 5].map((score) => ({ score, weight: 7 })))).toBe(43);
  });
  it("leaves out lines without a score, and is empty while nothing is scored", () => {
    expect(
      overallTenths([
        { score: 4, weight: 20 },
        { score: null, weight: 80 },
      ]),
    ).toBe(40);
    expect(overallTenths([{ score: null, weight: 20 }])).toBeNull();
    expect(overallTenths([])).toBeNull();
  });
  it("names the criteria still to be scored", () => {
    expect(
      unscored([
        { name: "A", score: 3 },
        { name: "B", score: null },
      ]),
    ).toEqual(["B"]);
  });
});

describe("what the monthly proposals suggest for a quarter", () => {
  it("is their average as a whole score, a half rounding up", () => {
    expect(suggestedScore([4, 4, 5])).toBe(4);
    expect(suggestedScore([4, 5])).toBe(5);
    expect(suggestedScore([2, 3, 2])).toBe(2);
    expect(suggestedScore([3])).toBe(3);
  });
  it("is nothing without proposals", () => expect(suggestedScore([])).toBeNull());
});

describe("criteria and what can be saved", () => {
  it("needs a figure for a measured criterion, and none for a manual one", () => {
    expect(checkCriterion({ source: "measured", metrics: [] }).metrics).toMatch(/at least one/);
    expect(checkCriterion({ source: "measured", metrics: ["csat"] })).toEqual({});
    expect(checkCriterion({ source: "manual", metrics: [] })).toEqual({});
  });
  it("refuses a weight outside 1 to 100, a missing name and an unknown figure", () => {
    const ok = { name: "  Speed  of   change ", weight: 10, source: "manual" };
    expect(criterionSchema.parse(ok).name).toBe("Speed of change");
    for (const bad of [
      { ...ok, weight: 0 },
      { ...ok, weight: 101 },
      { ...ok, weight: 2.5 },
      { ...ok, name: " " },
      { ...ok, source: "guess" },
      { ...ok, metrics: ["speed"] },
    ])
      expect(criterionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
  it("refuses a score outside 1 to 5", () => {
    const line = (score: unknown) => scorecardSaveSchema.safeParse({ lines: [{ criterionId: "3f2b0c9e-8a51-4e0b-9a44-0d6f1c2e7b11", score }] }).success;
    expect([1, 5, null].map(line)).toEqual([true, true, true]);
    expect([0, 6, 3.5, "4"].map(line)).toEqual([false, false, false, false]);
  });
});
