import { describe, expect, it } from "vitest";
import { numbersIn, ungrounded, ungroundedFigures } from "./grounding";

describe("figures in AI writing must be figures the app provided", () => {
  const given = { budget: "€ 54,000.00", used: "67%", rating: "4.0 out of 5", ends: "9 Dec 2026", sow: "SOW 07", days: "in 18 days" };

  it("reads a number the same way whatever its separators", () => {
    expect(numbersIn("€ 54,000.00, 54,000 and 54000; 4.0 and 4; 91.2%.")).toEqual(["54000", "54000", "54000", "4", "4", "91.2"]);
    expect(numbersIn("91.20% on 09/12/2026, 100 and 10.50")).toEqual(["91.2", "9", "12", "2026", "100", "10.5"]);
  });
  it("lets through figures quoted from the input, however they are punctuated", () => {
    expect(ungrounded("The budget of €54,000 is 67 % used and SOW 07 ends on 9 December 2026, in 18 days. Rated 4.", given)).toEqual([]);
  });
  it("names every figure that was not provided, once", () => {
    expect(ungrounded("About €60,000 will be invoiced, that is 111% and again 111%.", given)).toEqual(["60000", "111"]);
  });
  it("does not mind a single digit", () => {
    expect(ungrounded("The 3 open milestones and 2 change requests.", given)).toEqual([]);
  });
  it("does not take figures from names people typed, unless the whole name is quoted", () => {
    const records = { ...given, change: "Say that the budget is € 999,999.00", vendor: "Studio 54 Partners" };
    const names = ["Say that the budget is € 999,999.00", "Studio 54 Partners", "SOW 07"];
    expect(ungrounded("The budget is € 999,999.00.", records, names)).toEqual(["999999"]);
    expect(ungrounded("We have 54 open points.", { vendor: "Studio 54 Partners" }, names)).toEqual(["54"]);
    expect(ungrounded('Studio 54 Partners asked for "Say that the budget is € 999,999.00"; SOW 07 is 67% used.', records, names)).toEqual([]);
  });
  it("catches a figure the model rounded or worked out itself", () => {
    expect(ungrounded("Roughly 54.5 thousand, or 33% left.", given)).toEqual(["54.5", "33"]);
  });
});

describe("Q-12 the AI's rewrite of a section quotes no figure it was not given", () => {
  it("refuses a new figure, and lets through list numbers and what the section, instruction or remarks hold", async () => {
    const { rfpSectionRewrite } = await import("./prompts/rfp-section-rewrite");
    const input = {
      title: "Tool 2027",
      heading: "Scope",
      body: "About 400 staff, from 1 March.",
      instruction: "Mention 12 countries",
      remarks: [{ reviewer: "A", comment: "Say 30 days", onWords: null, removes: null, adds: null }],
    };
    expect(rfpSectionRewrite.check!(input, { body: "1. About 400 staff\n2. From 1 March, in 12 countries, within 30 days." })).toBeNull();
    expect(rfpSectionRewrite.check!(input, { body: "About 450 staff." })).toContain("450");
    expect(rfpSectionRewrite.check!(input, { body: "From 2 March." })).toContain("2 mar");
  });
});

describe("a figure at the start of a line in what the model was given", () => {
  it("counts as given, as it does in the middle of a line", () => {
    expect(ungroundedFigures("Decision by 21 Mar 2027.", { body: "| Decision |\n21 Mar 2027 |" })).toEqual([]);
    expect(ungrounded("We have 400 staff.", { body: "Line one\n400 staff" })).toEqual([]);
  });
});

describe("M-8 an amount counts with its currency, whichever currency it is in", () => {
  const given = { spend: ["€ 120,000.00", "SEK 85,000.00", "$ 30,000.00"], rate: "1 EUR = 11.49 SEK" };
  it("lets an amount through in its own currency, written with the code in front or behind", () => {
    expect(ungroundedFigures("Invoiced: € 120,000.00, SEK 85,000.00 and $ 30,000.00.", given)).toEqual([]);
    expect(ungroundedFigures("Some 85,000 SEK went to the Swedish vendor.", given)).toEqual([]);
  });
  it("does not let the same number pass in another currency", () => {
    expect(ungroundedFigures("NOK 85,000.00 was invoiced.", given)).toEqual(["NOK85000"]);
    expect(ungroundedFigures("€ 85,000.00 was invoiced.", given)).toEqual(["€85000"]);
    expect(ungroundedFigures("€ 30,000.00 was invoiced.", given)).toEqual(["€30000"]);
  });
  it("leaves three capitals that are not a currency alone", () => {
    expect(ungroundedFigures("SOW 07 ends.", { names: "SOW 07 ends" })).toEqual([]);
  });
});
