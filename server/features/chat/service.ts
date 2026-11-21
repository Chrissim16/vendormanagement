import { askSchema, NOT_HELD, READ_ONLY, type AskAnswer, type AskLookup, type AskSource } from "../../../shared/ask";
import type { User } from "../../../shared/types";
import { AiUnavailable, ask, recordSuggestion } from "../../ai";
import { askAnswer, askPlan } from "../../ai/prompts/ask";
import { AppError } from "../../platform/errors";
import { listRfps } from "../rfp/service";
import { known, runLookup, type ChatContext } from "./lookups";

export type { ChatContext };

/** AI-2, said for this page: there is nothing to do by hand here, but every figure has its own page. */
const unavailable = () =>
  new AppError(
    502,
    "ai_unavailable",
    "The AI could not answer just now. Nothing was changed. Everything it would have looked up is still on its own page: Vendors, Agreements, Money, Performance and RFPs. Try again later.",
  );

/**
 * Answers a question from the app's own records (C-1). The model first picks look-ups
 * from a fixed, read-only list; the app runs them; the model then writes the answer from
 * what they returned. The answer is kept as an AI suggestion row, so that it can be traced
 * to its model and prompt. Nothing else is written: asking changes no record.
 */
export async function askQuestion(ctx: ChatContext, input: unknown, by: User): Promise<AskAnswer> {
  const { question, earlier } = askSchema.parse(input);
  const today = ctx.today();
  try {
    const [k, rfps] = await Promise.all([known(ctx), listRfps(ctx.db, { sort: "updated", dir: "desc", page: 1, pageSize: 100 })]);
    const plan = await ask(
      ctx.ai,
      askPlan,
      { question, earlier, today, vendors: k.vendors.map((v) => v.name), people: k.people.map((p) => p.name), rfps: rfps.items.map((r) => r.title) },
      "answer",
    );

    let lookups: AskLookup[] = [];
    let written = { answered: false, answer: plan.output.because === "change" ? READ_ONLY : NOT_HELD, sources: [] as string[] };
    let model = plan.model;
    if (plan.output.lookups.length) {
      const ran = await Promise.all(plan.output.lookups.map((call, i) => runLookup(ctx, call, k, "ABCD"[i]!)));
      lookups = ran.map((r) => r.lookup);
      const answer = await ask(
        ctx.ai,
        askAnswer,
        { question, today, lookups, names: [...ran.flatMap((r) => r.names), ...k.vendors.map((v) => v.name), ...k.people.map((p) => p.name)] },
        "answer",
      );
      written = answer.output;
      model = answer.model;
    }

    const byRef = new Map<string, AskSource>(lookups.flatMap((l) => l.rows.map((r) => [r.ref, { label: r.label, href: r.href }] as const)));
    const passages = lookups.flatMap((l) => l.passages).filter((p) => written.sources.includes(p.ref));
    const sources = written.sources
      .map((ref) => byRef.get(ref))
      .filter((s): s is AskSource => !!s)
      // Several rows of one record (a SOW and its milestones) lead to the same page: one link is enough.
      .filter((s, i, all) => all.findIndex((o) => o.href === s.href && o.label === s.label) === i);
    const at = ctx.now();
    const row = await recordSuggestion(ctx.db, {
      prompt: plan.output.lookups.length ? askAnswer : askPlan,
      subjectType: "user",
      subjectId: by.id,
      model,
      inputSummary: question,
      output: {
        ...written,
        sources,
        passages: passages.map((p) => ({ document: p.document, part: p.part, where: p.where })),
        lookups: lookups.map((l) => ({ name: l.name, title: l.title, count: l.count, totals: l.totals })),
      },
      at,
    });
    return { id: row.id, question, answered: written.answered, answer: written.answer, sources, passages, lookups, model, createdAt: at.toISOString() };
  } catch (e) {
    if (e instanceof AiUnavailable) throw unavailable();
    throw e;
  }
}
