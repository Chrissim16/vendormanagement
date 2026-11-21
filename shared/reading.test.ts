import { describe, expect, it } from "vitest";
import { contractReadingSchema, passageHasAmount, passageHasDate, readingProblem, targetOf, type ContractReading } from "./reading";

const none: ContractReading = { kind: null, title: null, signedOn: null, startDate: null, endDate: null, noticePeriodDays: null, amount: null, currency: null };
const text = [
  "Statement of work: Ledger clean-up",
  "This statement of work was signed on 3 March 2027.",
  "The work starts on 01/04/2027 and ends on 2027-09-30.",
  "The budget is EUR 120,000.00, invoiced per milestone.",
  "Either party may end it by giving 3 months' notice.",
].join("\n");

describe("E-1 a passage must hold the value it is given for", () => {
  it("a date is found however it is written, and not when only part of it is there", () => {
    expect(passageHasDate("signed on 3 March 2027.", "2027-03-03")).toBe(true);
    expect(passageHasDate("signed on 3 Mar 2027", "2027-03-03")).toBe(true);
    expect(passageHasDate("starts on 01/04/2027", "2027-04-01")).toBe(true);
    expect(passageHasDate("ends on 2027-09-30", "2027-09-30")).toBe(true);
    expect(passageHasDate("on 3.3.27", "2027-03-03")).toBe(true);
    expect(passageHasDate("signed on 3 March 2027.", "2027-03-04")).toBe(false);
    expect(passageHasDate("signed on 3 March 2027.", "2027-04-03")).toBe(false);
    expect(passageHasDate("signed on 3 March 2027.", "2028-03-03")).toBe(false);
    // Day and month the same number: it must stand there twice when written in figures.
    expect(passageHasDate("on 5/2027 for 5 days", "2027-05-05")).toBe(true);
    expect(passageHasDate("on 5 June 2027", "2027-05-05")).toBe(false);
    // "may" inside another word is not the month.
    expect(passageHasDate("payment is due 7 days after 2027 dismay", "2027-05-07")).toBe(false);
  });
  it("an amount is found with any separators, and not a different one", () => {
    expect(passageHasAmount("The budget is EUR 120,000.00, invoiced", "120000")).toBe(true);
    expect(passageHasAmount("fee of € 48.000,50 a year", "48000.50")).toBe(true);
    expect(passageHasAmount("fee of 48000.", "48000")).toBe(true);
    expect(passageHasAmount("The budget is EUR 120,000.00", "12000")).toBe(false);
    expect(passageHasAmount("within 30 days", "120000")).toBe(false);
  });
  it("a reading that quotes the document and holds its values passes", () => {
    const good: ContractReading = {
      kind: { value: "sow", passage: "Statement of work: Ledger clean-up" },
      title: { value: "Ledger clean-up", passage: "Statement of work: Ledger clean-up" },
      signedOn: { value: "2027-03-03", passage: "This statement of work was signed on 3 March 2027." },
      startDate: { value: "2027-04-01", passage: "The work starts on 01/04/2027 and ends on 2027-09-30." },
      endDate: { value: "2027-09-30", passage: "The work starts on  01/04/2027 and ends on 2027-09-30." },
      noticePeriodDays: { value: 90, passage: "Either party may end it by giving 3 months' notice." },
      amount: { value: "120000", passage: "The budget is EUR 120,000.00, invoiced per milestone." },
      currency: { value: "EUR", passage: "The budget is EUR 120,000.00, invoiced per milestone." },
    };
    expect(readingProblem(text, good)).toBeNull();
    expect(readingProblem(text, none)).toBeNull();
  });
  it("a passage that is not in the document, or does not hold its value, is refused", () => {
    const p = (r: Partial<ContractReading>) => readingProblem(text, { ...none, ...r });
    expect(p({ signedOn: { value: "2027-03-03", passage: "It was signed on 3 March 2027 by both parties." } })).toContain("not in the document");
    expect(p({ endDate: { value: "2027-12-31", passage: "The work starts on 01/04/2027 and ends on 2027-09-30." } })).toContain("does not hold that date");
    expect(p({ amount: { value: "999999", passage: "The budget is EUR 120,000.00, invoiced per milestone." } })).toContain("does not hold that amount");
    expect(p({ noticePeriodDays: { value: 60, passage: "Either party may end it by giving 3 months' notice." } })).toContain("notice period");
    expect(p({ currency: { value: "GBP", passage: "The budget is EUR 120,000.00, invoiced per milestone." } })).toContain("currency");
    expect(p({ title: { value: "Something else entirely", passage: "Statement of work: Ledger clean-up" } })).toContain("title");
  });
  it("the answer's shape: values as the app stores them, a field left out counts as not found", () => {
    expect(contractReadingSchema.parse({ kind: { value: "sow", passage: "Statement of work" } })).toEqual({ ...none, kind: { value: "sow", passage: "Statement of work" } });
    for (const bad of [
      { kind: { value: "lease", passage: "Statement of work" } },
      { signedOn: { value: "2027-02-30", passage: "signed on 30 February 2027" } },
      { amount: { value: "€ 120,000", passage: "The budget is EUR 120,000.00" } },
      { noticePeriodDays: { value: 12.5, passage: "12.5 days' notice" } },
      { title: { value: "A title", passage: "short" } },
    ])
      expect(contractReadingSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("E-1 where a read value goes", () => {
  it("depends on the kind of agreement", () => {
    expect(targetOf("amount", "sow")).toEqual({ key: "budgetMinor", label: "Budget" });
    expect(targetOf("amount", "subscription")).toEqual({ key: "annualValueMinor", label: "Annual value" });
    expect(targetOf("amount", "msa")).toHaveProperty("why");
    expect(targetOf("noticePeriodDays", "sow")).toHaveProperty("why");
    expect(targetOf("endDate", "msa")).toHaveProperty("why");
    expect(targetOf("startDate", "nda")).toHaveProperty("why");
    expect(targetOf("endDate", "nda")).toEqual({ key: "endDate", label: "Valid until" });
    expect(targetOf("kind", "sow")).toHaveProperty("why");
  });
});
