import { describe, expect, it } from "vitest";
import { agreementSchema, checkAgreement, inPlace, nextTermEnd, noticeDeadline, renewalState, type AgreementInput } from "./agreements";
import { addDays, addMonths, daysBetween, isDay, todayIn } from "./dates";
import { formatMoney, parseAmount } from "./money";
import { buildWarnings, cleanName, paperwork, vendorSchema, type WarningAgreement, type WarningVendor } from "./vendors";

describe("days", () => {
  it("knows real dates from impossible ones", () => {
    expect(isDay("2028-02-29")).toBe(true);
    for (const bad of ["2027-02-29", "2026-13-01", "21-11-2026", "", null]) expect(isDay(bad)).toBe(false);
  });
  it("adds days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
  it("adds months, landing on the month's last day when needed", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2027-01-31", 13)).toBe("2028-02-29");
    expect(addMonths("2026-11-21", 12)).toBe("2027-11-21");
  });
  it("counts whole days, also across a clock change", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-11-21", "2026-11-20")).toBe(-1);
  });
  it("takes today from the team's time zone, not the server's", () => {
    expect(todayIn("Europe/Amsterdam", new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
    expect(todayIn("America/New_York", new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-14");
  });
});

describe("money", () => {
  it("reads amounts the way people type them", () => {
    expect(parseAmount("12500")).toBe(1_250_000);
    expect(parseAmount("12,500.00")).toBe(1_250_000);
    expect(parseAmount("12.500,00")).toBe(1_250_000);
    expect(parseAmount("€ 12 500,5")).toBe(1_250_050);
    expect(parseAmount("1.234")).toBe(123_400);
    expect(parseAmount("1,5")).toBe(150);
    expect(parseAmount("0.07")).toBe(7);
    expect(parseAmount("1,234,567.89")).toBe(123_456_789);
  });
  it("refuses what is not an amount", () => {
    for (const bad of ["", "abc", "-5", "1.2.3", "12,50,00", "1.234.56", "1e3", "1.234,567", "0.500", "0,123", "00.250"]) expect(parseAmount(bad), bad).toBeNull();
  });
  it("shows amounts with their currency and never drifts by a cent", () => {
    expect(formatMoney(1_250_000, "EUR")).toBe("€ 12,500.00");
    expect(formatMoney(3_150_050, "GBP")).toBe("£ 31,500.50");
    expect(formatMoney(parseAmount("0.29")! + parseAmount("0.58")!, "EUR")).toBe("€ 0.87");
  });
});

const sub = { kind: "subscription" as const, status: "active" as const, endDate: "2027-02-10", noticePeriodDays: 90 };

describe("renewals", () => {
  it("puts the notice deadline the notice period before the renewal date", () => {
    expect(noticeDeadline(sub)).toBe("2026-11-12");
    expect(noticeDeadline({ ...sub, noticePeriodDays: null })).toBe("2026-11-12");
    expect(noticeDeadline({ ...sub, kind: "sow" })).toBeNull();
  });
  it("is overdue the day after the deadline, due soon inside the window, otherwise fine", () => {
    expect(renewalState(sub, "2026-11-13", false)).toBe("overdue");
    expect(renewalState(sub, "2026-11-12", false)).toBe("due_soon");
    expect(renewalState(sub, "2026-08-14", false)).toBe("due_soon");
    expect(renewalState(sub, "2026-08-13", false)).toBe("ok");
  });
  it("is settled once a decision is recorded for the term, and absent for anything not an active subscription", () => {
    expect(renewalState(sub, "2026-11-13", true)).toBe("ok");
    expect(renewalState({ ...sub, status: "draft" }, "2026-11-13", false)).toBe("none");
    expect(renewalState({ ...sub, kind: "msa", endDate: null }, "2026-11-13", false)).toBe("none");
  });
  it("rolls forward by the renewal term", () => {
    expect(nextTermEnd("2027-02-10", 12)).toBe("2028-02-10");
    expect(nextTermEnd("2027-08-31", 6)).toBe("2028-02-29");
    expect(nextTermEnd("2027-02-10", null)).toBe("2028-02-10");
  });
});

const ids = { vendorId: "00000000-0000-4000-8000-000000000001", ownerUserId: "00000000-0000-4000-8000-000000000002" };
const check = (a: Partial<AgreementInput> & { kind: AgreementInput["kind"] }) => checkAgreement(agreementSchema.parse({ ...ids, title: "T", ...a }));

describe("agreement rules per kind", () => {
  it("an MSA never has an end date while it runs, nor a budget", () => {
    const r = check({ kind: "msa", endDate: "2030-01-01", budgetMinor: 5 });
    expect(r.errors).toEqual({});
    expect(r.value).toMatchObject({ endDate: null, budgetMinor: null });
  });
  it("a SOW needs start, end, pricing and budget", () => {
    expect(Object.keys(check({ kind: "sow" }).errors).sort()).toEqual(["budgetMinor", "endDate", "pricing", "startDate"]);
    expect(check({ kind: "sow", pricing: "fixed", budgetMinor: 1000, startDate: "2026-01-01", endDate: "2026-06-30" }).errors).toEqual({});
  });
  it("a subscription needs a renewal date and annual value, and gets the default notice period", () => {
    expect(Object.keys(check({ kind: "subscription" }).errors).sort()).toEqual(["annualValueMinor", "endDate"]);
    expect(check({ kind: "subscription", annualValueMinor: 100, endDate: "2027-01-01" }).value).toMatchObject({ noticePeriodDays: 90, autoRenews: false, renewalTermMonths: 12 });
  });
  it("an NDA or data processing agreement needs its signing date once it is active, not while it is being negotiated", () => {
    expect(check({ kind: "nda", status: "in_negotiation" }).errors).toEqual({});
    expect(check({ kind: "nda", status: "active" }).errors.signedOn).toBeTruthy();
    expect(check({ kind: "dpa", status: "active", signedOn: "2026-01-01" }).errors).toEqual({});
  });
  it("refuses an end date before the start date, and allows the same day", () => {
    const sow = { kind: "sow" as const, pricing: "fixed" as const, budgetMinor: 1, startDate: "2026-06-30" };
    expect(check({ ...sow, endDate: "2026-06-29" }).errors.endDate).toMatch(/before the start/);
    expect(check({ ...sow, endDate: "2026-06-30" }).errors).toEqual({});
  });
  it("active needs the signing date; ended needs a reason; a reason is dropped otherwise", () => {
    expect(check({ kind: "msa", status: "active" }).errors.signedOn).toBeTruthy();
    expect(check({ kind: "msa", status: "ended", signedOn: "2026-01-01" }).errors.endReason).toBeTruthy();
    expect(check({ kind: "msa", status: "active", signedOn: "2026-01-01", endReason: "expired" }).value.endReason).toBeNull();
  });
  it("refuses impossible dates and negative amounts before any rule runs", () => {
    expect(agreementSchema.safeParse({ ...ids, kind: "nda", title: "T", signedOn: "2026-02-31" }).success).toBe(false);
    expect(agreementSchema.safeParse({ ...ids, kind: "sow", title: "T", budgetMinor: -1 }).success).toBe(false);
  });
  it("an NDA or data processing agreement has no start date, so a stale one can never block its valid-until date", () => {
    const r = check({ kind: "nda", startDate: "2026-12-01", endDate: "2026-11-30" });
    expect(r.errors).toEqual({});
    expect(r.value.startDate).toBeNull();
  });
});

describe("paperwork", () => {
  const nda = { kind: "nda" as const, status: "active" as const, endDate: null };
  it("is in place when active and not past its valid-until date", () => {
    expect(inPlace(nda, "2026-11-21")).toBe(true);
    expect(inPlace({ ...nda, endDate: "2026-11-21" }, "2026-11-21")).toBe(true);
    expect(inPlace({ ...nda, endDate: "2026-11-20" }, "2026-11-21")).toBe(false);
    expect(inPlace({ ...nda, status: "draft" }, "2026-11-21")).toBe(false);
  });
  it("tells missing from expired, and respects not required", () => {
    expect(paperwork("nda", true, [], "2026-11-21")).toBe("missing");
    expect(paperwork("nda", true, [{ ...nda, status: "draft" }], "2026-11-21")).toBe("missing");
    expect(paperwork("nda", true, [{ ...nda, endDate: "2026-01-01" }], "2026-11-21")).toBe("expired");
    expect(paperwork("nda", true, [{ ...nda, endDate: "2026-01-01" }, nda], "2026-11-21")).toBe("in_place");
    expect(paperwork("dpa", true, [nda], "2026-11-21")).toBe("missing");
    expect(paperwork("dpa", false, [], "2026-11-21")).toBe("not_required");
  });
});

describe("vendor names", () => {
  it("ignores extra spaces", () => expect(cleanName("  Blue   finch  ")).toBe("Blue finch"));
  it("requires a name, type and owner, and a proper web address", () => {
    const base = { name: "X", type: "software", ownerUserId: ids.ownerUserId };
    expect(vendorSchema.safeParse(base).success).toBe(true);
    expect(vendorSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(vendorSchema.safeParse({ ...base, website: "javascript:alert(1)" }).success).toBe(false);
    expect(vendorSchema.parse({ ...base, website: "", country: "nl" })).toMatchObject({ website: null, country: "NL" });
  });
});

describe("warnings", () => {
  const today = "2026-11-21";
  const vendor = (o: Partial<WarningVendor> = {}): WarningVendor => ({
    id: "v1",
    name: "Bluefinch",
    status: "active",
    ownerUserId: "u1",
    ndaRequired: false,
    dpaRequired: false,
    ...o,
  });
  const ag = (o: Partial<WarningAgreement>): WarningAgreement => ({
    id: "a1",
    vendorId: "v1",
    title: "Thing",
    ownerUserId: "u1",
    kind: "subscription",
    status: "active",
    endDate: null,
    noticePeriodDays: 90,
    decidedForTerm: false,
    ...o,
  });
  const types = (v: WarningVendor[], a: WarningAgreement[]) => buildWarnings(v, a, today).map((w) => w.type);

  it("flags notice deadlines that are overdue or within 90 days, and not those decided or further out", () => {
    expect(types([vendor()], [ag({ endDate: "2027-02-10" })])).toEqual(["renewal_overdue"]);
    expect(types([vendor()], [ag({ endDate: "2027-03-16" })])).toEqual(["renewal_due"]);
    expect(types([vendor()], [ag({ endDate: "2027-05-21" })])).toEqual([]);
    expect(types([vendor()], [ag({ endDate: "2027-02-10", decidedForTerm: true })])).toEqual([]);
    expect(types([vendor()], [ag({ endDate: "2027-02-10", status: "draft" })])).toEqual([]);
  });
  it("flags SOWs ending within 30 days and those past their end date while still active", () => {
    const sow = { kind: "sow" as const };
    expect(types([vendor()], [ag({ ...sow, endDate: "2026-12-21" })])).toEqual(["sow_ending"]);
    expect(types([vendor()], [ag({ ...sow, endDate: "2026-12-22" })])).toEqual([]);
    expect(types([vendor()], [ag({ ...sow, endDate: "2026-11-20" })])).toEqual(["sow_past_end"]);
    expect(types([vendor()], [ag({ ...sow, endDate: "2026-11-20", status: "ended" })])).toEqual([]);
  });
  it("never lists an MSA, which has no end", () => expect(types([vendor()], [ag({ kind: "msa" })])).toEqual([]));
  it("flags a required NDA or data processing agreement that is missing or expired, for active vendors only", () => {
    const needs = vendor({ ndaRequired: true, dpaRequired: true });
    expect(types([needs], []).sort()).toEqual(["dpa_missing", "nda_missing"]);
    expect(types([needs], [ag({ kind: "nda", endDate: "2026-01-01" }), ag({ id: "a2", kind: "dpa" })])).toEqual(["nda_expired"]);
    expect(types([{ ...needs, status: "prospect" }], [])).toEqual([]);
    expect(types([{ ...needs, status: "offboarded" }], [])).toEqual([]);
  });
  it("leads a paperwork warning to the one closest to signed, else to the expired one, else nowhere", () => {
    const needs = vendor({ ndaRequired: true });
    const one = (a: WarningAgreement[]) => buildWarnings([needs], a, today)[0]!;
    expect(one([])).toMatchObject({ type: "nda_missing", agreementId: null, detail: "No NDA is in place." });
    const draft = ag({ id: "d", kind: "nda", title: "Draft", status: "draft", endDate: null });
    const signing = ag({ id: "s", kind: "nda", title: "Signing", status: "out_for_signature", endDate: null });
    expect(one([draft])).toMatchObject({ agreementId: "d", detail: "No NDA is in place. “Draft” is still a draft." });
    expect(one([draft, signing])).toMatchObject({ agreementId: "s", detail: "No NDA is in place. “Signing” is out for signature." });
    // A DPA under way says nothing about the NDA.
    expect(one([{ ...signing, kind: "dpa" }])).toMatchObject({ agreementId: null });
    const expired = ag({ id: "x", kind: "nda", endDate: "2026-01-01" });
    expect(one([expired])).toMatchObject({ type: "nda_expired", agreementId: "x", detail: "NDA expired on 1 Jan 2026." });
    expect(one([expired, ag({ id: "n", kind: "nda", title: "Next", status: "in_negotiation", endDate: null })])).toMatchObject({
      type: "nda_expired",
      agreementId: "n",
      detail: "NDA expired on 1 Jan 2026. “Next” is in negotiation.",
    });
  });
  it("puts what is already wrong first, then the soonest", () => {
    const list = buildWarnings(
      [vendor()],
      [ag({ id: "due", endDate: "2027-03-16" }), ag({ id: "late", endDate: "2027-02-10" }), ag({ id: "sow", kind: "sow", endDate: "2026-12-01" })],
      today,
    );
    expect(list.map((w) => w.agreementId)).toEqual(["late", "sow", "due"]);
    expect(list[0]!.detail).toBe("The notice deadline passed on 12 Nov 2026. It renews on 10 Feb 2027.");
  });
});
