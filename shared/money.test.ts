import { describe, expect, it } from "vitest";
import { isoCurrency } from "./iso-currencies";
import {
  addMoney,
  convertedNote,
  currenciesIn,
  eurWithOriginal,
  formatMoney,
  formatRate,
  isMixed,
  moneyLine,
  noMoney,
  parseAmount,
  parseRate,
  ratesOf,
  ratesUsed,
  STARTING_CURRENCIES,
  toEur,
  totalInWords,
} from "./money";

const rates = ratesOf([
  { code: "EUR", unitsPerEurE4: 10000, starting: false },
  { code: "GBP", unitsPerEurE4: 8550, starting: false },
  { code: "USD", unitsPerEurE4: 10800, starting: true },
  { code: "SEK", unitsPerEurE4: 114900, starting: false },
]);

describe("M-8 rates, typed as 1 EUR = so much", () => {
  it("reads a rate with a point or a comma, up to four decimals and five whole digits", () => {
    expect(parseRate("0.855")).toBe(8550);
    expect(parseRate("11,49")).toBe(114900);
    expect(parseRate("1")).toBe(10000);
    expect(parseRate("16450.5")).toBe(164_505_000);
    for (const bad of ["", "0", "0.0000", "1.17355", "abc", "-1", "1.1.7", "123456"]) expect(parseRate(bad), bad).toBeNull();
  });
  it("shows a rate with two to four decimals", () => {
    expect(formatRate(8550)).toBe("0.855");
    expect(formatRate(114900)).toBe("11.49");
    expect(formatRate(10835)).toBe("1.0835");
    expect(formatRate(10000)).toBe("1.00");
  });
  it("converts to euro cents by dividing by the rate, rounding half away from zero, and leaves euros alone", () => {
    expect(toEur(85_50, "GBP", rates)).toBe(100_00);
    expect(toEur(1_149_00, "SEK", rates)).toBe(100_00);
    expect(toEur(100_00, "USD", rates)).toBe(92_59);
    // 1.5 euro cents is rounded up, -1.5 down.
    expect(toEur(3, "SEK", ratesOf([{ code: "SEK", unitsPerEurE4: 20000, starting: false }]))).toBe(2);
    expect(toEur(-3, "SEK", ratesOf([{ code: "SEK", unitsPerEurE4: 20000, starting: false }]))).toBe(-2);
    expect(toEur(99_99, "EUR", rates)).toBe(99_99);
    expect(toEur(9_000_000_000_00, "GBP", ratesOf([{ code: "GBP", unitsPerEurE4: 1, starting: false }]))).toBe(9_000_000_000_00 * 10000);
  });
  it("refuses to convert a currency it has no rate for, rather than guess", () => {
    expect(() => toEur(100, "CHF", rates)).toThrow();
  });
  it("starts with euros, pounds, US dollars and Swedish, Norwegian and Danish kronor", () => {
    expect(STARTING_CURRENCIES.map((c) => c.code)).toEqual(["EUR", "GBP", "USD", "SEK", "NOK", "DKK"]);
    for (const c of STARTING_CURRENCIES) expect(isoCurrency(c.code)?.decimals, c.code).toBe(2);
  });
  it("knows which standard currencies have no cents or three decimals", () => {
    expect(isoCurrency("jpy")).toMatchObject({ code: "JPY", decimals: 0 });
    expect(isoCurrency("BHD")).toMatchObject({ decimals: 3 });
    expect(isoCurrency("CHF")).toMatchObject({ name: "Swiss franc", decimals: 2 });
    expect(isoCurrency("XYZ")).toBeUndefined();
  });
});

describe("M-8 totals across currencies", () => {
  it("adds up per currency and converts each currency once, on its sum", () => {
    const m = noMoney();
    for (let i = 0; i < 100; i++) addMoney(m, "SEK", 1, rates);
    addMoney(m, "EUR", 10_00, rates);
    // Each öre alone is 0.087 euro cents, rounded to nothing; 100 öre are 8.7, so 9 cents.
    expect(m).toEqual({ amounts: { SEK: 100, EUR: 10_00 }, eurMinor: 10_09 });
  });
  it("names the currencies euros first, then A to Z, leaving out empty ones", () => {
    expect(currenciesIn({ SEK: 1, USD: 2, EUR: 3, GBP: 0 })).toEqual(["EUR", "SEK", "USD"]);
    expect(moneyLine({ SEK: 85_000_00, USD: 30_000_00, EUR: 120_000_00 })).toBe("€ 120,000.00 · SEK 85,000.00 · $ 30,000.00");
    expect(isMixed({ EUR: 5 })).toBe(false);
    expect(isMixed({ EUR: 5, USD: 1 })).toBe(true);
    expect(isMixed({ USD: 1 })).toBe(true);
  });
  it("says which rates were used, and which are starting rates", () => {
    const used = ratesUsed({ EUR: 1, USD: 1, GBP: 1 }, rates);
    expect(used.map((r) => r.code)).toEqual(["GBP", "USD"]);
    expect(convertedNote(used)).toBe("Converted at 1 EUR = 0.855 GBP and 1 EUR = 1.08 USD (starting rate, not yet set by an admin).");
    expect(convertedNote([])).toBe("");
  });
  it("writes a total in euros, with the original amounts when anything was converted", () => {
    const m = addMoney(addMoney(noMoney(), "EUR", 98_000_00, rates), "USD", 30_000_00, rates);
    expect(eurWithOriginal(m)).toBe("€ 125,777.78 (€ 98,000.00 · $ 30,000.00)");
    expect(eurWithOriginal(addMoney(noMoney(), "EUR", 5_00, rates))).toBe("€ 5.00");
    expect(totalInWords(m, ratesUsed(m.amounts, rates))).toBe(
      "€ 125,777.78 in euros, converted (€ 98,000.00 · $ 30,000.00). Converted at 1 EUR = 1.08 USD (starting rate, not yet set by an admin).",
    );
  });
});

describe("M-8 amounts in any currency", () => {
  it("shows the euro, the pound and the dollar with their sign, every other currency with its code", () => {
    expect(formatMoney(1_250_000, "EUR")).toBe("€ 12,500.00");
    expect(formatMoney(1_250_000, "USD")).toBe("$ 12,500.00");
    expect(formatMoney(8_500_000, "SEK")).toBe("SEK 85,000.00");
    expect(formatMoney(-50, "NOK")).toBe("-NOK 0.50");
  });
  it("reads an amount typed with a sign or a code in front or behind", () => {
    expect(parseAmount("SEK 85,000")).toBe(85_000_00);
    expect(parseAmount("85.000,50 NOK")).toBe(85_000_50);
    expect(parseAmount("$1,250.00")).toBe(1_250_00);
    expect(parseAmount("US$ 9,000")).toBe(9_000_00);
    expect(parseAmount("dkk 12")).toBe(12_00);
    expect(parseAmount("12 kronor")).toBeNull();
  });
});
