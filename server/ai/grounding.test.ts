import { describe, expect, it } from "vitest";
import { numbersIn, ungrounded } from "./grounding";

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
