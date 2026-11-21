import { describe, expect, it } from "vitest";
import { askSchema, lookupArgs, lookupGuide, lookupNames, periodsFor } from "./ask";

describe("periods a question can name", () => {
  it("are whole months, quarters and years around today", () => {
    const p = periodsFor("2026-11-21");
    expect(p.thisMonth).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(p.lastMonth).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(p.nextMonth).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(p.thisQuarter).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(p.lastQuarter).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(p.nextQuarter).toEqual({ from: "2027-01-01", to: "2027-03-31" });
    expect(p.thisYear).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(p.next30Days).toEqual({ from: "2026-11-21", to: "2026-12-21" });
    expect(p.last12Months).toEqual({ from: "2025-12-01", to: "2026-11-21" });
  });
  it("cross a year and a leap day correctly", () => {
    expect(periodsFor("2028-01-31").nextMonth).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodsFor("2027-01-05").lastQuarter).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodsFor("2027-03-31").lastMonth).toEqual({ from: "2027-02-01", to: "2027-02-28" });
  });
});

describe("the look-ups a model may choose", () => {
  it("every look-up is described, and none of them is a verb that changes something", () => {
    expect(Object.keys(lookupGuide).sort()).toEqual([...lookupNames].sort());
    for (const n of lookupNames) expect(n).not.toMatch(/add|create|delete|remove|update|set|save|approve|write/);
  });
  it("arguments a model leaves empty count as not given; unknown ones are dropped; wrong ones are refused", () => {
    expect(lookupArgs.agreements.parse({ vendor: null, kind: "", status: "active", somethingElse: 1 })).toEqual({ status: "active" });
    expect(lookupArgs.agreements.safeParse({ kind: "lease" }).success).toBe(false);
    expect(lookupArgs.agreements.safeParse({ endsFrom: "2026-02-30" }).success).toBe(false);
    expect(lookupArgs.helpdesk.safeParse({ month: "2026-13" }).success).toBe(false);
    expect(lookupArgs.vendor.safeParse({}).success).toBe(false);
  });
  it("a question is trimmed and bounded", () => {
    expect(askSchema.parse({ question: "  How many?  " })).toEqual({ question: "How many?", earlier: [] });
    expect(askSchema.safeParse({ question: "" }).success).toBe(false);
  });
});
