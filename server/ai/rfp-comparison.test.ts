import { describe, expect, it } from "vitest";
import { unpacksWithin } from "../features/import/service";
import { rfpComparison, type RfpComparisonInput, type RfpComparisonOutput } from "./prompts/rfp-comparison";
import ExcelJS from "exceljs";

/** Q-7: what the comparison's own check lets through and what it throws away, whatever a model answers. */

const input: RfpComparisonInput = {
  rfpTitle: "Expense tool",
  criterion: { id: "k", name: "Technology and security" },
  candidates: [
    { id: "a", name: "Vendor A 2000 (invented)" },
    { id: "b", name: "Vendor B (invented)" },
  ],
  questions: [
    {
      id: "q1",
      number: 1,
      text: "Where is the data stored?",
      answers: [
        { candidateId: "a", text: "All data is stored in two data centres in the Netherlands, audited in March 2026." },
        { candidateId: "b", text: null },
      ],
    },
    {
      id: "q2",
      number: 2,
      text: "Which certifications do you hold?",
      answers: [
        { candidateId: "a", text: "Yes." },
        { candidateId: "b", text: null },
      ],
    },
  ],
};
const good: RfpComparisonOutput = {
  questions: [
    {
      questionId: "q1",
      summaries: [
        { candidateId: "a", summary: "Stored in two data centres in the Netherlands." },
        { candidateId: "b", summary: "No answer." },
      ],
      differences: "Only Vendor A 2000 (invented) answered.",
    },
    {
      questionId: "q2",
      summaries: [
        { candidateId: "a", summary: "Says yes without naming any." },
        { candidateId: "b", summary: "No answer." },
      ],
      differences: "Only Vendor A 2000 (invented) answered.",
    },
  ],
  scores: [
    {
      candidateId: "a",
      score: 3,
      reason: "Specific on hosting, audited in March 2026, but names no certification.",
      quote: "All data is stored in two data centres in the Netherlands",
    },
  ],
};
const check = (o: RfpComparisonOutput) => rfpComparison.check!(input, o);
const withScore = (score: Partial<RfpComparisonOutput["scores"][number]>) => ({ ...good, scores: [{ ...good.scores[0]!, ...score }] });

describe("the check on an AI comparison of answers", () => {
  it("lets a faithful comparison through, also when the quote has other quotation marks or spacing around it", () => {
    expect(check(good)).toBeNull();
    expect(check(withScore({ quote: "“All data is stored in  two data centres in the Netherlands”" }))).toBeNull();
    // A short answer may be quoted whole.
    expect(check(withScore({ quote: "Yes." }))).toBeNull();
  });
  it("refuses a quote that is not in that candidate's own answers", () => {
    expect(check(withScore({ quote: "All data is stored in three data centres in Germany" }))).toContain("not in that candidate's answers");
    // Words from the question are not the candidate's words.
    expect(check(withScore({ quote: "Which certifications do you hold?" }))).toContain("not in that candidate's answers");
  });
  it("refuses a quote of a word or two, which would be found in almost any answer", () => {
    expect(check(withScore({ quote: "data" }))).toContain("too short");
    expect(check(withScore({ quote: "in the Netherlands" }))).toContain("too short");
  });
  it("refuses a number that is not in the answers, but not one inside a candidate's name", () => {
    expect(check(withScore({ reason: "Audited in March 2026 and holds ISO 27001." }))).toContain("27001");
    expect(check({ ...good, questions: [{ ...good.questions[0]!, differences: "Vendor A 2000 (invented) has 99.9% uptime." }, good.questions[1]!] })).toContain("99.9");
    // 2000 is part of the name the team typed, not a figure; on its own it is refused.
    expect(check(withScore({ reason: "Founded in 2000." }))).toContain("2000");
  });
  it("refuses a score for a candidate that answered nothing, a missing score, and a second score", () => {
    expect(check({ ...good, scores: [...good.scores, { candidateId: "b", score: 5, reason: "Great.", quote: "Great answer, very complete indeed." }] })).toContain(
      "answered nothing",
    );
    expect(check({ ...good, scores: [] })).toContain("exactly one score for candidate a");
    expect(check({ ...good, scores: [good.scores[0]!, good.scores[0]!] })).toContain("exactly one score");
  });
  it("refuses an unknown question or candidate, and a missing summary", () => {
    expect(check({ ...good, questions: [...good.questions, { questionId: "q9", summaries: [], differences: "x" }] })).toContain("unknown question");
    expect(check({ ...good, questions: [good.questions[0]!] })).toContain("question q2");
    expect(check({ ...good, questions: [{ ...good.questions[0]!, summaries: [good.questions[0]!.summaries[0]!] }, good.questions[1]!] })).toContain("summary of b");
    expect(
      check({ ...good, questions: [{ ...good.questions[0]!, summaries: [...good.questions[0]!.summaries, { candidateId: "z", summary: "Who?" }] }, good.questions[1]!] }),
    ).toContain("unknown candidate");
    expect(check({ ...good, scores: [...good.scores, { candidateId: "z", score: 3, reason: "x", quote: "A passage of some length here." }] })).toContain("unknown candidate");
  });
});

describe("the guard on uploaded workbooks", () => {
  it("counts what a workbook really unpacks into, whatever sizes the file declares", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Answers");
    for (let i = 0; i < 2000; i++) ws.addRow([i, `${i} the same text again and again `.repeat(20)]);
    const zip = Buffer.from(await wb.xlsx.writeBuffer());
    // About 1.2 MB of sheet in a file a fraction of that size.
    expect(zip.length).toBeLessThan(400_000);
    expect(unpacksWithin(zip, 5_000_000)).toBe(true);
    expect(unpacksWithin(zip, 500_000)).toBe(false);
    // The same file claiming that every part is empty: the claim changes nothing.
    const lying = Buffer.from(zip);
    for (let i = lying.indexOf("PK\x01\x02", 0, "latin1"); i >= 0; i = lying.indexOf("PK\x01\x02", i + 4, "latin1")) lying.writeUInt32LE(0, i + 24);
    expect(unpacksWithin(lying, 500_000)).toBe(false);
    expect(unpacksWithin(Buffer.from("not a zip at all"), 10)).toBe(true);
  });
});
