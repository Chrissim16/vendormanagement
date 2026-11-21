import { describe, expect, it } from "vitest";
import {
  budgetView,
  changeRequestSchema,
  checkApproval,
  checkMilestone,
  consultantSchema,
  daysLate,
  formatRate,
  invoiceSchema,
  milestoneSchema,
  monthsBetween,
  parseRate,
  rateFor,
  summariseSpend,
  toEur,
  type MilestoneInput,
} from "./sow";

const TODAY = "2026-11-21";

describe("exchange rate", () => {
  it("reads a rate with a point or a comma, up to four decimals", () => {
    expect(parseRate("1.17")).toBe(11700);
    expect(parseRate("1,1735")).toBe(11735);
    expect(parseRate("1")).toBe(10000);
    for (const bad of ["", "0", "0.0000", "1.17355", "abc", "-1", "1.1.7"]) expect(parseRate(bad), bad).toBeNull();
    expect(formatRate(11700)).toBe("1.17");
    expect(formatRate(11735)).toBe("1.1735");
    expect(formatRate(10000)).toBe("1.00");
  });
  it("converts pounds to euro cents, rounding to the nearest cent, and leaves euros alone", () => {
    expect(toEur(100_00, "GBP", 11700)).toBe(117_00);
    expect(toEur(1, "GBP", 11750)).toBe(1);
    expect(toEur(3, "GBP", 11750)).toBe(4);
    expect(toEur(31_500_00, "GBP", 11735)).toBe(36_965_25);
    expect(toEur(99_99, "EUR", 11700)).toBe(99_99);
    expect(toEur(8_000_000_000_00, "GBP", 19999)).toBe(15_999_200_000_00);
  });
});

describe("M-5 budget against invoiced", () => {
  it("works out remaining and percentage used", () => {
    expect(budgetView(240_000_00, 199_200_00, 80)).toEqual({ budgetMinor: 240_000_00, invoicedMinor: 199_200_00, remainingMinor: 40_800_00, usedPct: 83, state: "warn" });
  });
  it("warns from exactly the threshold and marks an overrun only above 100%", () => {
    expect(budgetView(1000, 799, 80).state).toBe("ok");
    expect(budgetView(1000, 800, 80).state).toBe("warn");
    expect(budgetView(1000, 1000, 80).state).toBe("warn");
    expect(budgetView(1000, 1001, 80)).toMatchObject({ state: "over", remainingMinor: -1, usedPct: 100 });
    expect(budgetView(3, 2, 67).state).toBe("ok");
    expect(budgetView(3, 2, 66).state).toBe("warn");
  });
  it("never rounds a percentage up across the line, and copes with no budget", () => {
    expect(budgetView(100_000, 79_999, 80).usedPct).toBe(79);
    expect(budgetView(null, 500, 80)).toMatchObject({ state: "none", usedPct: null, remainingMinor: null });
    expect(budgetView(0, 0, 80)).toMatchObject({ state: "ok", usedPct: null });
    expect(budgetView(0, 1, 80).state).toBe("over");
  });
});

describe("M-1 milestones", () => {
  const m = (o: Partial<MilestoneInput> = {}): MilestoneInput => milestoneSchema.parse({ title: "M", dueDate: "2026-09-30", ...o });
  const fixed = { pricing: "fixed" as const, budgetMinor: 100_000 };
  it("counts late days for a late delivery or an open milestone past its due date, never for a cancelled one", () => {
    expect(daysLate(m({ status: "delivered", deliveredOn: "2026-10-19" }), TODAY)).toBe(19);
    expect(daysLate(m({ status: "delivered", deliveredOn: "2026-09-30" }), TODAY)).toBe(0);
    expect(daysLate(m({ status: "delivered", deliveredOn: "2026-09-01" }), TODAY)).toBe(0);
    expect(daysLate(m(), TODAY)).toBe(52);
    expect(daysLate(m({ dueDate: TODAY }), TODAY)).toBe(0);
    expect(daysLate(m({ status: "cancelled" }), TODAY)).toBe(0);
  });
  it("keeps fixed-price milestone amounts within the budget, ignoring cancelled ones", () => {
    const others = [
      { status: "open" as const, amountMinor: 60_000 },
      { status: "cancelled" as const, amountMinor: 90_000 },
    ];
    expect(checkMilestone(m({ amountMinor: 40_000 }), fixed, others, TODAY).errors).toEqual({});
    expect(checkMilestone(m({ amountMinor: 40_001 }), fixed, others, TODAY).errors.amountMinor).toMatch(/more than the SOW budget/);
    expect(checkMilestone(m({ amountMinor: 999_999, status: "cancelled" }), fixed, others, TODAY).errors).toEqual({});
    expect(checkMilestone(m(), fixed, others, TODAY).errors).toEqual({});
  });
  it("allows no amounts on a time and materials SOW", () => {
    const tm = { pricing: "time_and_materials" as const, budgetMinor: 100_000 };
    expect(checkMilestone(m({ amountMinor: 1 }), tm, [], TODAY).errors.amountMinor).toMatch(/fixed-price/);
    expect(checkMilestone(m(), tm, [], TODAY).errors).toEqual({});
  });
  it("dates a delivery today unless told otherwise, refuses a future one, and clears it when reopened", () => {
    expect(checkMilestone(m({ status: "delivered" }), fixed, [], TODAY).value.deliveredOn).toBe(TODAY);
    expect(checkMilestone(m({ status: "delivered", deliveredOn: "2026-11-22" }), fixed, [], TODAY).errors.deliveredOn).toBeTruthy();
    expect(checkMilestone(m({ status: "open", deliveredOn: "2026-10-01" }), fixed, [], TODAY).value.deliveredOn).toBeNull();
  });
});

describe("M-2 change requests", () => {
  const sow = { status: "active", pricing: "fixed", budgetMinor: 210_000_00, startDate: "2026-04-01", endDate: "2026-11-30" };
  it("needs a budget change, a new end date, or both", () => {
    const base = { title: "Change", requestedOn: "2026-09-01" };
    expect(changeRequestSchema.safeParse(base).success).toBe(false);
    expect(changeRequestSchema.safeParse({ ...base, budgetChangeMinor: 0 }).success).toBe(false);
    expect(changeRequestSchema.safeParse({ ...base, budgetChangeMinor: -500 }).success).toBe(true);
    expect(changeRequestSchema.safeParse({ ...base, newEndDate: "2027-02-28" }).success).toBe(true);
  });
  it("applies the budget change and the new end date", () => {
    expect(checkApproval({ budgetChangeMinor: 30_000_00, newEndDate: "2027-02-28" }, sow, 0)).toEqual({ error: null, budgetMinor: 240_000_00, endDate: "2027-02-28" });
    expect(checkApproval({ budgetChangeMinor: null, newEndDate: "2027-02-28" }, sow, 0)).toMatchObject({ budgetMinor: 210_000_00, endDate: "2027-02-28" });
    expect(checkApproval({ budgetChangeMinor: -10_000_00, newEndDate: null }, sow, 0)).toMatchObject({ error: null, budgetMinor: 200_000_00, endDate: "2026-11-30" });
  });
  it("refuses a change that breaks the SOW", () => {
    expect(checkApproval({ budgetChangeMinor: -210_000_01, newEndDate: null }, sow, 0).error).toMatch(/below zero/);
    expect(checkApproval({ budgetChangeMinor: -20_000_00, newEndDate: null }, sow, 200_000_00).error).toMatch(/below what the milestones add up to/);
    expect(checkApproval({ budgetChangeMinor: -20_000_00, newEndDate: null }, { ...sow, pricing: "time_and_materials" }, 200_000_00).error).toBeNull();
    expect(checkApproval({ budgetChangeMinor: null, newEndDate: "2026-03-31" }, sow, 0).error).toMatch(/before the SOW's start date/);
    expect(checkApproval({ budgetChangeMinor: 1, newEndDate: null }, { ...sow, status: "ended" }, 0).error).toMatch(/has ended/);
  });
});

describe("M-3 rate cards", () => {
  const lines = [
    { role: "Lead architect", validFrom: "2025-01-01", dayRateMinor: 1250_00 },
    { role: "Lead architect", validFrom: "2026-07-01", dayRateMinor: 1350_00 },
    { role: "lead ARCHITECT", validFrom: "2027-01-01", dayRateMinor: 1400_00 },
    { role: "Data engineer", validFrom: "2026-12-01", dayRateMinor: 980_00 },
  ];
  it("uses the latest line that has started, ignoring case", () => {
    expect(rateFor(lines, "lead architect", TODAY)?.dayRateMinor).toBe(1350_00);
    expect(rateFor(lines, "Lead architect", "2026-06-30")?.dayRateMinor).toBe(1250_00);
    expect(rateFor(lines, "Lead architect", "2027-01-01")?.dayRateMinor).toBe(1400_00);
  });
  it("has no rate for a role that has not started or does not exist", () => {
    expect(rateFor(lines, "Data engineer", TODAY)).toBeNull();
    expect(rateFor(lines, "Tester", TODAY)).toBeNull();
  });
  it("refuses a consultant whose end date is before the start", () => {
    expect(consultantSchema.safeParse({ name: "A", role: "R", fromDate: "2026-02-01", toDate: "2026-01-31" }).success).toBe(false);
    expect(consultantSchema.parse({ name: " A ", role: "R", fromDate: "", toDate: "" })).toEqual({ name: "A", role: "R", fromDate: null, toDate: null });
  });
});

describe("M-4 invoices", () => {
  const base = { agreementId: "00000000-0000-4000-8000-000000000001", invoiceNumber: "  INV   2026-001 ", invoiceDate: "2026-11-01", amountMinor: 12_500_00 };
  it("tidies the invoice number and needs a positive amount and a real date", () => {
    expect(invoiceSchema.parse(base)).toMatchObject({ invoiceNumber: "INV 2026-001", milestoneId: null, description: null });
    for (const bad of [{ amountMinor: 0 }, { amountMinor: -5 }, { amountMinor: 10.5 }, { invoiceDate: "2026-02-30" }, { invoiceNumber: "   " }])
      expect(invoiceSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("M-6 spend", () => {
  const row = (vendorId: string, month: string, currency: "EUR" | "GBP", amountMinor: number) => ({ vendorId, vendorName: `Vendor ${vendorId}`, month, currency, amountMinor });
  it("lists every month in the period, including empty ones", () => {
    expect(monthsBetween("2025-12-15", "2026-03-01")).toEqual(["2025-12", "2026-01", "2026-02", "2026-03"]);
    expect(monthsBetween("2026-11-01", "2026-11-30")).toEqual(["2026-11"]);
    expect(monthsBetween("2026-12-01", "2026-11-30")).toEqual([]);
  });
  it("keeps each currency apart and adds a converted euro total", () => {
    const s = summariseSpend(
      [row("a", "2026-01", "EUR", 100_00), row("a", "2026-02", "EUR", 50_00), row("b", "2026-02", "GBP", 200_00), row("c", "2026-02", "EUR", 10_00)],
      "2026-01-01",
      "2026-03-31",
      11700,
    );
    expect(s.total).toEqual({ EUR: 160_00, GBP: 200_00, eurMinor: 394_00 });
    expect(s.byVendor.map((v) => [v.vendorId, v.EUR, v.GBP, v.eurMinor])).toEqual([
      ["b", 0, 200_00, 234_00],
      ["a", 150_00, 0, 150_00],
      ["c", 10_00, 0, 10_00],
    ]);
    expect(s.byMonth.map((m) => [m.month, m.eurMinor])).toEqual([
      ["2026-01", 100_00],
      ["2026-02", 294_00],
      ["2026-03", 0],
    ]);
  });
  it("converts the sum once, so many small pound amounts do not pile up rounding", () => {
    const s = summariseSpend(
      Array.from({ length: 100 }, () => row("a", "2026-01", "GBP", 1)),
      "2026-01-01",
      "2026-01-31",
      11750,
    );
    expect(s.total).toEqual({ EUR: 0, GBP: 100, eurMinor: 118 });
    expect(s.byMonth[0]!.eurMinor).toBe(118);
  });
  it("changes only the converted totals when the rate changes", () => {
    const rows = [row("a", "2026-01", "EUR", 100_00), row("b", "2026-01", "GBP", 100_00)];
    const one = summariseSpend(rows, "2026-01-01", "2026-01-31", 11700);
    const two = summariseSpend(rows, "2026-01-01", "2026-01-31", 12000);
    expect([one.total.EUR, one.total.GBP, two.total.EUR, two.total.GBP]).toEqual([100_00, 100_00, 100_00, 100_00]);
    expect([one.total.eurMinor, two.total.eurMinor]).toEqual([217_00, 220_00]);
  });
});
