import { describe, expect, it } from "vitest";
import { contractReadingSchema, datesIn, moneyIn, noticeDaysIn, standsIn, targetOf, verifyReading, type ContractReading } from "./reading";
import { STARTING_CURRENCIES } from "./money";

const none: ContractReading = { kind: null, title: null, signedOn: null, startDate: null, endDate: null, noticePeriodDays: null, amount: null, currency: null };
const text = [
  "Subscription: Planning suite, from a European company",
  "This order form was signed on 4 January 2027.",
  "The subscription starts on 01/02/2027 and ends on 31 January 2028.",
  "The annual fee is € 26,500.00, payable within 30 days.",
  "Fees for 2027 are fixed for 12 months.",
  "Either party may cancel by giving 45 days' written notice before 5 June 2027.",
  "Longer terms need 3 months' notice.",
].join("\n");
const verify = (r: Partial<ContractReading>) => verifyReading(text, { ...none, ...r });
const kept = (r: Partial<ContractReading>) => {
  const v = verify(r);
  return Object.fromEntries(
    Object.entries(v.reading)
      .filter(([, f]) => f)
      .map(([k, f]) => [k, f!.value]),
  );
};

describe("E-1 what a passage states", () => {
  it("dates are whole expressions, read day first", () => {
    expect(datesIn("signed on 4 January 2027.")).toEqual(["2027-01-04"]);
    expect(datesIn("on the 9th of March 2027 and March 10, 2027")).toEqual(["2027-03-09", "2027-03-10"]);
    expect(datesIn("the fifteenth day of March 2027 (15/03/2027)")).toEqual(["2027-03-15"]);
    expect(datesIn("starts on 01/02/2027")).toEqual(["2027-02-01"]);
    expect(datesIn("2027-09-30, 3.3.27 and 3 Sept 2027")).toEqual(["2027-09-03", "2027-09-30", "2027-03-03"]);
    // Not dates: a loose year, a month and year, a day that does not exist, the verb "may".
    expect(datesIn("Fees for 2027; in March 2027; on 31/02/2027; either party may cancel before 5 June 2027")).toEqual(["2027-06-05"]);
    expect(datesIn("on 5/2027 for 5 days")).toEqual([]);
  });
  it("an amount is a number with its currency next to it", () => {
    expect(moneyIn("The annual fee is € 26,500.00, payable within 30 days.")).toEqual([{ minor: 26_500_00, currency: "EUR" }]);
    expect(moneyIn("EUR 118,000 excl. VAT; a day rate of £1,150; 48.000,50 euros; 9,000 pounds sterling")).toEqual([
      { minor: 118_000_00, currency: "EUR" },
      { minor: 1_150_00, currency: "GBP" },
      { minor: 48_000_50, currency: "EUR" },
      { minor: 9_000_00, currency: "GBP" },
    ]);
    expect(moneyIn("CHF 9,000 within 30 days, in 2027, for a European company")).toEqual([]);
  });
  it("M-8 an amount can be in any currency on the list, by its code, its sign or its name", () => {
    expect(moneyIn("USD 9,000; $ 1,250.50; US$ 700; 40 dollars; SEK 85,000; 12.500 Norwegian kroner; 7 400,00 Danish kroner; DKK 3")).toEqual([
      { minor: 9_000_00, currency: "USD" },
      { minor: 1_250_50, currency: "USD" },
      { minor: 700_00, currency: "USD" },
      { minor: 40_00, currency: "USD" },
      { minor: 85_000_00, currency: "SEK" },
      { minor: 12_500_00, currency: "NOK" },
      { minor: 7_400_00, currency: "DKK" },
      { minor: 3_00, currency: "DKK" },
    ]);
    // Thousands written with a space are one number, never just their last part.
    expect(moneyIn("SEK 1 250 000 a year")).toEqual([{ minor: 1_250_000_00, currency: "SEK" }]);
  });
  it("M-8 a bare kr does not say which kronor, and a currency not on the list is no currency", () => {
    expect(moneyIn("The fee is kr 85,000, or 85.000 kr.")).toEqual([]);
    expect(moneyIn("CHF 1,000 and 2,000 Swiss francs")).toEqual([]);
    const withFrancs = [...STARTING_CURRENCIES, { code: "CHF", name: "Swiss franc" }];
    expect(moneyIn("CHF 1,000 and 2,000 Swiss francs", withFrancs)).toEqual([
      { minor: 1_000_00, currency: "CHF" },
      { minor: 2_000_00, currency: "CHF" },
    ]);
    // A code counts only in capitals, and a dollar with another country's letters before it is not a US dollar.
    expect(moneyIn("usd 5 and CA$ 100 and A$ 7")).toEqual([]);
  });
  it("a notice period is a number of days in a sentence about notice; months are not converted", () => {
    expect(noticeDaysIn("giving 45 days' written notice before 5 June 2027")).toEqual([45]);
    expect(noticeDaysIn("cancel with 30 calendar days notice")).toEqual([30]);
    expect(noticeDaysIn("payable within 30 days")).toEqual([]);
    expect(noticeDaysIn("3 months' notice")).toEqual([]);
    expect(noticeDaysIn("10 business days' notice")).toEqual([]);
  });
  it("a passage stands in the document only as whole words and whole numbers", () => {
    expect(standsIn(text, "The annual fee is € 26,500.00, payable within 30 days.")).toBe(true);
    expect(standsIn(text, "The annual fee is  € 26,500.00")).toBe(true);
    expect(standsIn(text, "6,500.00, payable within 30 days.")).toBe(false);
    expect(standsIn(text, "1 January 2028.")).toBe(false);
    expect(standsIn(text, "The annual fee is € 26")).toBe(false);
    expect(standsIn(text, "5 days' written notice")).toBe(false);
    expect(standsIn(text, "The annual fee is € 99,000.00")).toBe(false);
  });
});

describe("E-1 only values their passage bears out are kept", () => {
  it("a careful reading is kept whole, and an amount takes its currency from its own passage", () => {
    const v = verify({
      kind: { value: "subscription", passage: "Subscription: Planning suite, from a European company" },
      title: { value: "Planning suite", passage: "Subscription: Planning suite, from a European company" },
      signedOn: { value: "2027-01-04", passage: "This order form was signed on 4 January 2027." },
      startDate: { value: "2027-02-01", passage: "The subscription starts on 01/02/2027 and ends on 31 January 2028." },
      endDate: { value: "2028-01-31", passage: "The subscription starts on 01/02/2027 and ends on 31 January 2028." },
      noticePeriodDays: { value: 45, passage: "Either party may cancel by giving 45 days' written notice before 5 June 2027." },
      amount: { value: "26500", passage: "The annual fee is € 26,500.00, payable within 30 days." },
    });
    expect(v.unverified).toEqual([]);
    expect(Object.values(v.reading).every(Boolean)).toBe(true);
    expect(v.reading.currency).toEqual({ value: "EUR", passage: "The annual fee is € 26,500.00, payable within 30 days." });
  });
  it.each<[string, Partial<ContractReading>, string]>([
    ["a passage cut inside a number", { amount: { value: "6500", passage: "6,500.00, payable within 30 days." } }, "amount"],
    ["a passage cut inside a date", { endDate: { value: "2028-01-01", passage: "1 January 2028." } }, "endDate"],
    ["a notice period cut out of a longer number", { noticePeriodDays: { value: 5, passage: "5 days' written notice before 5 June 2027." } }, "noticePeriodDays"],
    ["a payment term taken for the amount", { amount: { value: "30", passage: "The annual fee is € 26,500.00, payable within 30 days." } }, "amount"],
    ["a year taken for the amount", { amount: { value: "2027", passage: "Fees for 2027 are fixed for 12 months." } }, "amount"],
    ["a payment term taken for the notice period", { noticePeriodDays: { value: 30, passage: "The annual fee is € 26,500.00, payable within 30 days." } }, "noticePeriodDays"],
    ["months turned into days", { noticePeriodDays: { value: 90, passage: "Longer terms need 3 months' notice." } }, "noticePeriodDays"],
    ["twelve months taken for 360 days' notice", { noticePeriodDays: { value: 360, passage: "Fees for 2027 are fixed for 12 months." } }, "noticePeriodDays"],
    ["day and month swapped", { startDate: { value: "2027-01-02", passage: "The subscription starts on 01/02/2027 and ends on 31 January 2028." } }, "startDate"],
    ["two dates in a passage mixed into a third", { endDate: { value: "2027-01-31", passage: "The subscription starts on 01/02/2027 and ends on 31 January 2028." } }, "endDate"],
    ["the verb may read as the month", { endDate: { value: "2027-05-05", passage: "Either party may cancel by giving 45 days' written notice before 5 June 2027." } }, "endDate"],
    ["European read as euro", { currency: { value: "EUR", passage: "Subscription: Planning suite, from a European company" } }, "currency"],
    ["a title that is not in its passage", { title: { value: "The annual fee", passage: "This order form was signed on 4 January 2027." } }, "title"],
    ["a title of one letter", { title: { value: "a", passage: "Subscription: Planning suite, from a European company" } }, "title"],
    ["a kind the passage has no word for", { kind: { value: "sow", passage: "This order form was signed on 4 January 2027." } }, "kind"],
    ["a made-up passage", { signedOn: { value: "2027-01-04", passage: "It was signed by both parties on 4 January 2027." } }, "signedOn"],
  ])("%s is left out and named", (_what, reading, field) => {
    const v = verify(reading);
    expect(v.unverified).toEqual([field]);
    expect(kept(reading)).toEqual({});
  });
  it("one doubtful value does not cost the others", () => {
    const r = {
      signedOn: { value: "2027-01-04", passage: "This order form was signed on 4 January 2027." },
      endDate: { value: "2030-12-31", passage: "The subscription starts on 01/02/2027 and ends on 31 January 2028." },
    };
    expect(verify(r).unverified).toEqual(["endDate"]);
    expect(kept(r)).toEqual({ signedOn: "2027-01-04" });
  });
  it("a currency that contradicts the amount's own passage is dropped for the passage's; an amount without a currency next to it is dropped", () => {
    const pounds = verify({
      amount: { value: "26500", passage: "The annual fee is € 26,500.00, payable within 30 days." },
      currency: { value: "GBP", passage: "The annual fee is € 26,500.00, payable within 30 days." },
    });
    expect(pounds.reading.currency?.value).toBe("EUR");
    expect(pounds.unverified).toEqual(["currency"]);
    const francs = verifyReading("The annual fee is CHF 9,000 a year.", { ...none, amount: { value: "9000", passage: "The annual fee is CHF 9,000 a year." } });
    expect(francs.reading.amount).toBeNull();
    expect(francs.unverified).toEqual(["amount"]);
    const kronor = verifyReading("The annual fee is kr 9,000 a year.", { ...none, amount: { value: "9000", passage: "The annual fee is kr 9,000 a year." }, currency: { value: "SEK", passage: "The annual fee is kr 9,000 a year." } });
    expect(kronor.reading.amount).toBeNull();
    expect(kronor.reading.currency).toBeNull();
    expect(kronor.unverified).toEqual(["amount", "currency"]);
    const dollars = verifyReading("The annual fee is USD 9,000 a year.", { ...none, amount: { value: "9000", passage: "The annual fee is USD 9,000 a year." } });
    expect(dollars.reading.currency?.value).toBe("USD");
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
