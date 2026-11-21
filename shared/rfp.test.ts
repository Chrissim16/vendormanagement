import { describe, expect, it } from "vitest";
import {
  approvalBlocker,
  contentProblems,
  draftToContent,
  formatHundredths,
  matchAnswers,
  reviewBlockers,
  rfpContentSchema,
  rfpDemandSchema,
  rfpResults,
  RFP_TEMPLATE,
  sameAsDraft,
  templateDraft,
} from "./rfp";

const owner = "7b0e1c7e-2f43-4a7e-9a39-0d4f3f0f2a11";

describe("the demand (Q-1)", () => {
  it("needs a title, a need and an owner, and two part weights that add up to 100", () => {
    expect(rfpDemandSchema.safeParse({ title: " ", need: "", ownerUserId: owner }).success).toBe(false);
    expect(rfpDemandSchema.parse({ title: "Tool", need: "A tool", ownerUserId: owner })).toMatchObject({ writtenWeight: 70, demoWeight: 30, currency: "EUR", budgetMinor: null });
    const off = rfpDemandSchema.safeParse({ title: "Tool", need: "A tool", ownerUserId: owner, writtenWeight: 60, demoWeight: 30 });
    expect(off.success).toBe(false);
    expect(off.error?.issues[0]?.message).toContain("add up to 90");
  });
});

describe("the document (Q-2)", () => {
  const content = (over: object = {}) =>
    rfpContentSchema.parse({
      sections: [{ heading: "Introduction", body: "Hello" }],
      criteria: [
        { key: "a", name: "Fit", weight: 60, part: "written" },
        { key: "b", name: "Price", weight: 40, part: "written" },
        { key: "c", name: "Demo", weight: 100, part: "demo" },
      ],
      questions: [{ text: "How?", criterionKey: "a" }],
      ...over,
    });

  it("accepts weights that add up to 100 within each part", () => {
    expect(contentProblems(content())).toEqual({});
  });
  it("refuses weights within a part that do not add up to 100, saying what they add up to", () => {
    const c = content({
      criteria: [
        { key: "a", name: "Fit", weight: 60, part: "written" },
        { key: "b", name: "Price", weight: 30, part: "written" },
      ],
    });
    expect(contentProblems(c)["weights.written"]).toContain("add up to 90");
  });
  it("refuses a question without a criterion, and one that points at a demo criterion", () => {
    expect(contentProblems(content({ questions: [{ text: "How?", criterionKey: "zzz" }] }))["questions.0.criterionKey"]).toBeTruthy();
    expect(contentProblems(content({ questions: [{ text: "How?", criterionKey: "c" }] }))["questions.0.criterionKey"]).toContain("written");
  });
  it("refuses the same criterion name twice within a part, ignoring case", () => {
    const c = content({
      criteria: [
        { key: "a", name: "Fit", weight: 50, part: "written" },
        { key: "b", name: " fit ", weight: 50, part: "written" },
      ],
    });
    expect(contentProblems(c)["criteria.1.name"]).toBeTruthy();
  });
  it("the template's weights add up to 100 in both parts", () => {
    expect(contentProblems(draftToContent(templateDraft()))).toEqual({});
    expect(RFP_TEMPLATE.criteria.filter((c) => c.part === "written").reduce((n, c) => n + c.weight, 0)).toBe(100);
  });
  it("says what stops a draft from going to review", () => {
    expect(reviewBlockers({ sections: [], criteria: [], questions: [], writtenWeight: 70, demoWeight: 30 })).toHaveLength(4);
    const ready = {
      sections: [1],
      criteria: [
        { part: "written" as const, weight: 100 },
        { part: "demo" as const, weight: 100 },
      ],
      questions: [1],
      writtenWeight: 70,
      demoWeight: 30,
    };
    expect(reviewBlockers(ready)).toEqual([]);
    expect(reviewBlockers({ ...ready, demoWeight: 0, writtenWeight: 100 })[0]).toContain("counts for 0%");
    expect(reviewBlockers({ ...ready, criteria: [{ part: "written" as const, weight: 100 }] })[0]).toContain("have no criteria");
  });
  it("tells a document that still reads as the AI drafted it from one a person changed", () => {
    const draft = {
      sections: [{ heading: "Intro", body: "Hello  there" }],
      criteria: [{ name: "Fit", part: "written" as const, weight: 100 }],
      questions: [{ text: "How?", criterion: "fit" }],
    };
    const doc = {
      sections: [{ id: "s", heading: "Intro", body: "Hello there" }],
      criteria: [{ id: "k", name: "Fit", part: "written" as const, weight: 100 }],
      questions: [{ id: "q", number: 1, text: "How?", criterionId: "k" }],
    };
    expect(sameAsDraft(doc, draft)).toBe(true);
    expect(sameAsDraft({ ...doc, questions: [{ ...doc.questions[0]!, text: "How exactly?" }] }, draft)).toBe(false);
  });
});

describe("review (Q-3)", () => {
  it("needs at least one approval and no open change request", () => {
    const ok = { outcome: "approved" as const, resolvedOn: null, superseded: false };
    const asked = { outcome: "changes_requested" as const, resolvedOn: null, superseded: false };
    expect(approvalBlocker([])).toContain("No reviewer has approved");
    expect(approvalBlocker([ok])).toBeNull();
    expect(approvalBlocker([ok, asked])).toContain("still open");
    expect(approvalBlocker([ok, { ...asked, resolvedOn: "2026-11-20" }])).toBeNull();
    expect(approvalBlocker([{ ...asked, resolvedOn: "2026-11-20" }])).toContain("No reviewer has approved");
  });
  it("an approval of an earlier version of the document does not count, and a request about it is no longer open", () => {
    const old = { outcome: "approved" as const, resolvedOn: null, superseded: true };
    expect(approvalBlocker([old])).toContain("changed after it was approved");
    expect(approvalBlocker([old, { outcome: "changes_requested", resolvedOn: null, superseded: true }])).toContain("changed after it was approved");
    expect(approvalBlocker([old, { outcome: "approved", resolvedOn: null, superseded: false }])).toBeNull();
  });
});

describe("matching an answer sheet (Q-6)", () => {
  const questions = [
    { id: "q1", number: 1, text: "Where is the data stored?" },
    { id: "q2", number: 2, text: "Describe your pricing model." },
    { id: "q3", number: 3, text: "Who is on the team?" },
  ];
  const row = (row: number, number: string, question: string, answer: string) => ({ row, number, question, answer });

  it("matches by the question's number, whatever the order of the rows", () => {
    const { matched, unmatched } = matchAnswers([row(7, "2", "", "Per user"), row(6, "1", "", " In the EU ")], questions);
    expect(matched).toEqual([
      { questionId: "q2", text: "Per user", row: 7 },
      { questionId: "q1", text: "In the EU", row: 6 },
    ]);
    expect(unmatched).toEqual([]);
  });
  it("reads numbers written as 2., Q3 or 1.0", () => {
    expect(matchAnswers([row(1, "2.", "", "a"), row(2, "Q3", "", "b"), row(3, "1.0", "", "c")], questions).matched.map((m) => m.questionId)).toEqual(["q2", "q3", "q1"]);
  });
  it("falls back to the question's wording when the number is missing or unknown", () => {
    const { matched } = matchAnswers([row(6, "", "where is the DATA  stored", "In the EU"), row(7, "99", "Describe your pricing model.", "Per user")], questions);
    expect(matched.map((m) => m.questionId)).toEqual(["q1", "q2"]);
  });
  it("does not trust a number when the row's own question is a different one: the wording decides", () => {
    // A sheet made before question 2 was removed: its old number 3 now belongs to another question.
    const old = matchAnswers(
      [row(6, "1", "Where is the data stored?", "In the EU"), row(7, "2", "Who is on the team?", "Three consultants"), row(8, "3", "A question that no longer exists", "Stray")],
      questions,
    );
    expect(old.matched).toEqual([
      { questionId: "q1", text: "In the EU", row: 6 },
      { questionId: "q3", text: "Three consultants", row: 7 },
    ]);
    expect(old.unmatched.map((u) => u.answer)).toEqual(["Stray"]);
    // Small differences in spacing, case and the closing mark are still the same question.
    expect(matchAnswers([row(6, "2", "  describe your PRICING model", "Per user")], questions).matched.map((m) => m.questionId)).toEqual(["q2"]);
  });
  it("hands back what it cannot match, and a second answer to the same question", () => {
    const { matched, unmatched } = matchAnswers([row(6, "1", "", "First"), row(7, "1", "", "Second"), row(8, "", "Something else?", "Stray")], questions);
    expect(matched).toHaveLength(1);
    expect(unmatched.map((u) => u.answer)).toEqual(["Second", "Stray"]);
  });
  it("leaves out rows without an answer", () => {
    expect(matchAnswers([row(6, "1", "", "  "), row(7, "", "", "")], questions)).toEqual({ matched: [], unmatched: [] });
  });
});

describe("scores (Q-8)", () => {
  const criteria = [
    { id: "fit", part: "written" as const, weight: 60 },
    { id: "price", part: "written" as const, weight: 40 },
    { id: "demo", part: "demo" as const, weight: 100 },
  ];
  const rfp = { writtenWeight: 70, demoWeight: 30 };
  const s = (candidateId: string, criterionId: string, score: number) => ({ candidateId, criterionId, score });

  it("averages across evaluators, weights the criteria within a part and combines the parts", () => {
    const [a] = rfpResults(rfp, criteria, ["a"], [s("a", "fit", 4), s("a", "fit", 5), s("a", "price", 3), s("a", "demo", 4), s("a", "demo", 4), s("a", "demo", 5)]);
    // fit 4.5, price 3 → written 0.6×4.5 + 0.4×3 = 3.9; demo 13/3 = 4.33; overall 0.7×3.9 + 0.3×4.3333 = 4.03
    expect(a!.criteria.map((c) => c.averageHundredths)).toEqual([450, 300, 433]);
    expect(a!.written).toEqual({ hundredths: 390, scored: 2, criteria: 2 });
    expect(a!.demo.hundredths).toBe(433);
    expect(a!.overallHundredths).toBe(403);
    expect(formatHundredths(a!.overallHundredths)).toBe("4.03");
  });
  it("gives no part score and no overall score until every criterion that counts has a score", () => {
    const [a] = rfpResults(rfp, criteria, ["a"], [s("a", "fit", 4), s("a", "demo", 4)]);
    expect(a!.written).toEqual({ hundredths: null, scored: 1, criteria: 2 });
    expect(a!.demo.hundredths).toBe(400);
    expect(a!.overallHundredths).toBeNull();
    expect(a!.rank).toBeNull();
  });
  it("leaves a part out when it counts for nothing", () => {
    const [a] = rfpResults({ writtenWeight: 100, demoWeight: 0 }, criteria, ["a"], [s("a", "fit", 5), s("a", "price", 5)]);
    expect(a!.overallHundredths).toBe(500);
  });
  it("ranks on the overall score, best first, and lets equal scores share a place", () => {
    const full = (id: string, n: number) => [s(id, "fit", n), s(id, "price", n), s(id, "demo", n)];
    const out = rfpResults(rfp, criteria, ["a", "b", "c", "d"], [...full("a", 3), ...full("b", 5), ...full("c", 3), s("d", "fit", 5)]);
    expect(out.map((r) => r.rank)).toEqual([2, 1, 2, null]);
  });
  it("rounds halves up, once, at the end", () => {
    // 4 and 5 and 5 on one criterion: 14/3 = 4.666… → 4.67
    const [a] = rfpResults({ writtenWeight: 100, demoWeight: 0 }, [{ id: "k", part: "written", weight: 100 }], ["a"], [s("a", "k", 4), s("a", "k", 5), s("a", "k", 5)]);
    expect(a!.overallHundredths).toBe(467);
    // 0.5×4 + 0.5×4.25 = 4.125 → 4.13
    const two = [
      { id: "x", part: "written" as const, weight: 50 },
      { id: "y", part: "written" as const, weight: 50 },
    ];
    const [b] = rfpResults({ writtenWeight: 100, demoWeight: 0 }, two, ["b"], [s("b", "x", 4), s("b", "y", 4), s("b", "y", 4), s("b", "y", 4), s("b", "y", 5)]);
    expect(b!.overallHundredths).toBe(413);
  });
});
