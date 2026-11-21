import { describe, expect, it } from "vitest";
import { standInAnswer } from "../platform/ports/ai-fake";
import type { AiPort, AiRequest } from "../platform/ports/types";
import { AiUnavailable, ask, jsonIn } from "./index";
import { runEvals } from "./evals";
import { monthlyProposal, type MonthlyProposalInput } from "./prompts/monthly-proposal";

/** A model that answers what the test says; by default, what the local stand-in answers. */
const scriptedAi = (script: (req: AiRequest) => string | undefined = standInAnswer): AiPort => ({
  kind: "stand-in",
  complete: async (req) => ({ text: script(req) ?? "This is a stand-in answer.", model: `scripted-${req.tier}` }),
  check: async () => ({ ok: true, detail: "" }),
});

const metric = (key: "first_response" | "csat", valueTenths: number | null, targetTenths: number | null, verdict: "met" | "missed" | "none") => ({
  key,
  valueTenths,
  targetTenths,
  verdict,
});
const input: MonthlyProposalInput = {
  vendorName: "Example Vendor (invented)",
  month: "2026-10",
  criteria: [
    { id: "c1", name: "Timeliness", description: null, metrics: [metric("first_response", 880, 950, "missed")] },
    { id: "c2", name: "Quality", description: null, metrics: [metric("csat", 43, 40, "met")] },
  ],
  tickets: [1, 2, 3, 4].map((n) => ({ key: `EX-${n}`, summary: n < 4 ? "Printer offline" : "Other", description: "It does not print.", level: 1, resolved: true })),
};
const good = JSON.stringify({
  scores: [
    { criterionId: "c1", score: 2, reason: "Missed." },
    { criterionId: "c2", score: 4, reason: "Met." },
  ],
  themes: [],
});

describe("asking the model (AI-2)", () => {
  it("finds the JSON in an answer wrapped in words or a code fence", () => {
    expect(jsonIn('Here you go:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(() => jsonIn("I cannot help with that.")).toThrow();
  });

  it("returns a valid answer together with the model that gave it", async () => {
    const res = await ask(
      scriptedAi(() => good),
      monthlyProposal,
      input,
      "write a proposal",
    );
    expect(res.model).toBe("scripted-strong");
    expect(res.output.scores.map((s) => s.score)).toEqual([2, 4]);
  });

  it("asks once more after an unusable answer, then gives up in plain words", async () => {
    let calls = 0;
    const second = await ask(
      scriptedAi(() => (++calls === 1 ? "Sorry, no." : good)),
      monthlyProposal,
      input,
      "write a proposal",
    );
    expect(calls).toBe(2);
    expect(second.output.scores).toHaveLength(2);

    calls = 0;
    const never = ask(
      scriptedAi(() => (calls++, '{"scores": []}')),
      monthlyProposal,
      input,
      "write a proposal",
    );
    await expect(never).rejects.toBeInstanceOf(AiUnavailable);
    await expect(never).rejects.toMatchObject({ status: 502, code: "ai_unavailable", message: expect.stringMatching(/could not write a proposal.*by hand/) });
    expect(calls).toBe(2);
  });

  it("refuses a score outside 1 to 5, a missing criterion and a criterion scored twice", async () => {
    const answers = [
      {
        scores: [
          { criterionId: "c1", score: 6, reason: "x" },
          { criterionId: "c2", score: 4, reason: "x" },
        ],
      },
      { scores: [{ criterionId: "c1", score: 3, reason: "x" }] },
      {
        scores: [
          { criterionId: "c1", score: 3, reason: "x" },
          { criterionId: "c1", score: 4, reason: "x" },
          { criterionId: "c2", score: 4, reason: "x" },
        ],
      },
      {
        scores: [
          { criterionId: "c1", score: 3, reason: "" },
          { criterionId: "c2", score: 4, reason: "x" },
        ],
      },
    ];
    for (const a of answers)
      await expect(
        ask(
          scriptedAi(() => JSON.stringify(a)),
          monthlyProposal,
          input,
          "x",
        ),
        JSON.stringify(a),
      ).rejects.toBeInstanceOf(AiUnavailable);
  });

  it("says the AI is unavailable when the model cannot be reached, without passing on the technical reason", async () => {
    const ai = scriptedAi();
    ai.complete = async () => {
      throw new Error("ECONNREFUSED 10.0.0.1:443 token=abc");
    };
    const failed = await ask(ai, monthlyProposal, input, "write a proposal").catch((e: Error) => e);
    expect(failed).toBeInstanceOf(AiUnavailable);
    expect((failed as Error).message).not.toMatch(/ECONN|token/);
  });
});

describe("the stand-in's answers", () => {
  const answer = (i: MonthlyProposalInput) =>
    JSON.parse(standInAnswer({ tier: "strong", system: monthlyProposal.system, user: JSON.stringify(monthlyProposal.input(i)), json: true })!) as {
      scores: { criterionId: string; score: number; reason: string }[];
      themes: { title: string; ticketKeys: string[] }[];
    };
  it("scores low where targets are missed and high where they are met, quoting the figures it was given", () => {
    const a = answer(input);
    expect(a.scores[0]).toMatchObject({ criterionId: "c1", score: 2 });
    expect(a.scores[0]!.reason).toContain("88%");
    expect(a.scores[1]).toMatchObject({ criterionId: "c2", score: 5 });
    expect(a.themes).toEqual([{ title: "Printer offline", summary: expect.any(String), ticketKeys: ["EX-1", "EX-2", "EX-3"] }]);
  });
  it("proposes the middle score when there is no target or nothing was measured", () => {
    const a = answer({
      ...input,
      criteria: [
        { ...input.criteria[0]!, metrics: [metric("first_response", 880, null, "none")] },
        { ...input.criteria[1]!, metrics: [metric("csat", null, 40, "none")] },
      ],
    });
    expect(a.scores.map((s) => s.score)).toEqual([3, 3]);
  });
  it("leaves other prompts to the plain stand-in answer", () => {
    expect(standInAnswer({ tier: "fast", system: "", user: "ping" })).toBeUndefined();
    expect(standInAnswer({ tier: "fast", system: "", user: '{"task":"something else"}', json: true })).toBeUndefined();
  });
});

describe("the evaluation sets", () => {
  it("pass against the stand-in, so the checks themselves are known to work", async () => {
    const results = await runEvals(scriptedAi());
    expect(results.length).toBeGreaterThanOrEqual(4);
    expect(results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.problems.join("; ")}`)).toEqual([]);
  });
});
