import type { AiPort } from "../../platform/ports/types";
import { ask, type Prompt } from "../index";
import { askAnswerCases, askPlanCases } from "./ask";
import { contractFieldsCases } from "./contract-fields";
import { monthlyProposalCases } from "./monthly-proposal";
import { briefingCases, reportSummaryCases } from "./overview";
import { rfpComparisonCases, rfpDraftCases } from "./rfp";

/**
 * Evaluation sets: for each prompt, a handful of invented inputs with checks on what a
 * good answer must and must not contain. They are run on demand against a real model
 * (`npm run ai:eval`) to judge the quality of its answers; `npm run check` runs them
 * against the stand-in only, which proves the checks work and nothing about quality.
 */
export interface EvalCase<I, O> {
  name: string;
  prompt: Prompt<I, O>;
  input: I;
  /** Set when the case needs real understanding of language, which the rule-based stand-in does not have. */
  needsRealModel?: true;
  /** Returns what is wrong with the answer, in plain words; empty when it is fine. */
  check: (output: O) => string[];
}
export interface EvalResult {
  name: string;
  ok: boolean;
  model: string | null;
  problems: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each case carries its own input and output types.
const cases: EvalCase<any, any>[] = [
  ...monthlyProposalCases,
  ...reportSummaryCases,
  ...briefingCases,
  ...rfpDraftCases,
  ...rfpComparisonCases,
  ...askPlanCases,
  ...askAnswerCases,
  ...contractFieldsCases,
];

export async function runEvals(ai: AiPort): Promise<EvalResult[]> {
  const out: EvalResult[] = [];
  for (const c of cases) {
    if (c.needsRealModel && ai.kind === "stand-in") continue;
    try {
      const { output, model } = await ask(ai, c.prompt, c.input, "answer");
      const problems = c.check(output);
      out.push({ name: c.name, ok: problems.length === 0, model, problems });
    } catch (e) {
      out.push({ name: c.name, ok: false, model: null, problems: [(e as Error).message] });
    }
  }
  return out;
}
