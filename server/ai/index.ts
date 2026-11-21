import { eq } from "drizzle-orm";
import type { z } from "zod";
import { aiSuggestions } from "../../db/schema";
import type { SuggestionStatus } from "../../shared/scorecards";
import { AppError } from "../platform/errors";
import type { AiPort, Queryable } from "../platform/ports/types";

/**
 * The only way to the language model. A feature describes what it wants as a `Prompt`,
 * calls `ask`, and stores the answer with `recordSuggestion`: a suggestion that takes
 * effect only when a person accepts or edits it (AI-1).
 */
export interface Prompt<I, O> {
  /** What kind of suggestion this makes; stored with every answer. */
  kind: string;
  /** Changes whenever the wording or the expected answer changes, so an answer can be traced to its prompt. */
  version: string;
  tier: "strong" | "fast";
  system: string;
  /** What the model is given. Sent as JSON. */
  input: (input: I) => unknown;
  /** The shape the answer must have. */
  output: z.ZodType<O>;
  /** Checks the shape cannot express, such as "one score for every criterion asked about". Returns what is wrong, or null. */
  check?: (input: I, output: O) => string | null;
  maxTokens?: number;
}

/** The AI did not answer, or answered something that cannot be used (AI-2). The message is written for the person on the page. */
export class AiUnavailable extends AppError {
  constructor(what: string) {
    super(502, "ai_unavailable", `The AI could not ${what} just now. Nothing was changed, and everything on this page can still be done by hand. Try again later.`);
  }
}

/** The JSON object in a model's answer, which may be wrapped in a code fence or a sentence. */
export function jsonIn(text: string): unknown {
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  if (from < 0 || to <= from) throw new Error("no JSON object in the answer");
  return JSON.parse(text.slice(from, to + 1));
}

/**
 * Asks the model and returns an answer of the promised shape. An answer that cannot be
 * used is asked for once more; after that, and when the model cannot be reached at all,
 * it fails with `AiUnavailable`. `what` finishes the sentence "The AI could not ...".
 */
export async function ask<I, O>(ai: AiPort, prompt: Prompt<I, O>, input: I, what: string): Promise<{ output: O; model: string }> {
  const user = JSON.stringify(prompt.input(input));
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let answer;
    try {
      answer = await ai.complete({ tier: prompt.tier, system: prompt.system, user, json: true, maxTokens: prompt.maxTokens });
    } catch (e) {
      console.error(`AI call ${prompt.version} failed:`, (e as Error).message);
      throw new AiUnavailable(what);
    }
    try {
      const parsed = prompt.output.safeParse(jsonIn(answer.text));
      if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
      const wrong = prompt.check?.(input, parsed.data);
      if (wrong) throw new Error(wrong);
      return { output: parsed.data, model: answer.model };
    } catch (e) {
      problem = (e as Error).message;
    }
  }
  console.error(`AI answer for ${prompt.version} could not be used:`, problem.slice(0, 300));
  throw new AiUnavailable(what);
}

export interface SuggestionRow {
  id: string;
  status: SuggestionStatus;
  model: string;
  createdAt: Date;
  reviewedBy: string | null;
  reviewedAt: Date | null;
}

/** Stores a model's answer as a suggestion nobody has looked at yet. */
export async function recordSuggestion(
  tx: Queryable,
  s: { prompt: Pick<Prompt<unknown, unknown>, "kind" | "version">; subjectType: string; subjectId: string; model: string; inputSummary: string; output: unknown; at: Date },
): Promise<SuggestionRow> {
  const rows = await tx
    .insert(aiSuggestions)
    .values({
      kind: s.prompt.kind,
      subjectType: s.subjectType,
      subjectId: s.subjectId,
      model: s.model,
      promptVersion: s.prompt.version,
      inputSummary: s.inputSummary,
      output: s.output,
      createdAt: s.at,
    })
    .returning();
  return rows[0]!;
}

/** Records what a person decided about a suggestion. */
export async function reviewSuggestion(tx: Queryable, id: string, status: Exclude<SuggestionStatus, "proposed">, byEmail: string, at: Date): Promise<void> {
  await tx.update(aiSuggestions).set({ status, reviewedBy: byEmail, reviewedAt: at }).where(eq(aiSuggestions.id, id));
}
