import { describe, expect, it } from "vitest";
import { applySuggestedEdit } from "./review";

const edit = (removedText: string, addedText: string, beforeText = "", afterText = "") => ({ removedText, addedText, beforeText, afterText });

describe("Q-13 taking a suggested edit over", () => {
  it("replaces the words where they stand, keeping the formatting around them", () => {
    const body = "We invite **all vendors** to respond by 1 March.\n\n- one\n- two";
    expect(applySuggestedEdit(body, edit("1 March", "15 March", "respond by ", "."))).toEqual({
      ok: true,
      body: "We invite **all vendors** to respond by 15 March.\n\n- one\n- two",
    });
    // Inside bold text, the new words are bold too.
    expect(applySuggestedEdit(body, edit("all", "selected", "invite ", " vendors"))).toEqual({
      ok: true,
      body: "We invite **selected vendors** to respond by 1 March.\n\n- one\n- two",
    });
  });

  it("adds words where nothing was removed, found by the words around them", () => {
    expect(applySuggestedEdit("Send the sheet back.", edit("", " filled in", "Send the sheet", " back."))).toEqual({ ok: true, body: "Send the sheet filled in back." });
  });

  it("works in list items and table cells, and removes an item left empty", () => {
    expect(applySuggestedEdit("- keep\n- drop me", edit("drop me", ""))).toEqual({ ok: true, body: "- keep" });
    expect(applySuggestedEdit("| A | B |\n| --- | --- |\n| 10 | 20 |", edit("20", "25", "", ""))).toEqual({ ok: true, body: "| A | B |\n| --- | --- |\n| 10 | 25 |" });
  });

  it("falls back on the removed words alone when the words around them changed", () => {
    expect(applySuggestedEdit("Respond within ten days, please.", edit("ten days", "two weeks", "Answer within ", "."))).toEqual({
      ok: true,
      body: "Respond within two weeks, please.",
    });
  });

  it("refuses when the words are no longer there, or stand there more than once", () => {
    expect(applySuggestedEdit("Something else entirely.", edit("1 March", "15 March", "by ", "."))).toEqual({ ok: false, why: "not_found" });
    expect(applySuggestedEdit("Yes. Yes.", edit("Yes", "No"))).toEqual({ ok: false, why: "more_than_once" });
    expect(applySuggestedEdit("Add here.", edit("", "x", "", ""))).toEqual({ ok: false, why: "not_found" });
  });
});

describe("Q-13 a suggested edit never changes part of a word, nor words the reviewer did not touch", () => {
  it("does not take a number inside another number, nor a word inside another word", () => {
    // The words around "30" changed: "30" alone is not distinctive enough to be looked for.
    expect(applySuggestedEdit("Support within 45 days. We have 300 users.", edit("30", "60", "within ", " days."))).toEqual({ ok: false, why: "not_found" });
    expect(applySuggestedEdit("Yesterday we met.", edit("", " and no", "Yes", ""))).toEqual({ ok: false, why: "not_found" });
    expect(applySuggestedEdit("We have 30 users and 300 seats.", edit("30", "40", "", " users"))).toEqual({ ok: true, body: "We have 40 users and 300 seats." });
  });
  it("still finds distinctive words whose surroundings changed", () => {
    expect(applySuggestedEdit("All of it is confidential, now.", edit("confidential", "strictly confidential", "is ", " and"))).toEqual({
      ok: true,
      body: "All of it is strictly confidential, now.",
    });
  });
  it("applies an edit of a heading to the heading", async () => {
    const { applyToHeading } = await import("./review");
    expect(applyToHeading("Scope", edit("", " of work", "Scope", ""))).toEqual({ ok: true, heading: "Scope of work" });
    expect(applyToHeading("Scope and goals", edit("goals", "aims", "and ", ""))).toEqual({ ok: true, heading: "Scope and aims" });
  });
});

describe("words added next to bold words", () => {
  it("take the marks of the words before them", () => {
    expect(applySuggestedEdit("Plain with **bold** end.", edit("", "really ", "Plain with ", "bold"))).toEqual({ ok: true, body: "Plain with really **bold** end." });
  });
});
