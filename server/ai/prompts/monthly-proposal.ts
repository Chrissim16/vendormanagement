import { z } from "zod";
import { formatMetric, formatTarget, metricInfo, monthName, type Month } from "../../../shared/performance";
import type { UsedMetric } from "../../../shared/scorecards";
import type { Prompt } from "../index";

/** What the monthly proposal is made from. Every figure is worked out by the app before the model sees it. */
export interface MonthlyProposalInput {
  vendorName: string;
  month: Month;
  criteria: { id: string; name: string; description: string | null; metrics: UsedMetric[] }[];
  tickets: { key: string; summary: string; description: string | null; level: number; resolved: boolean }[];
}

const output = z.object({
  scores: z.array(z.object({ criterionId: z.string(), score: z.number().int().min(1).max(5), reason: z.string().trim().min(1).max(700) })),
  themes: z
    .array(z.object({ title: z.string().trim().min(1).max(120), summary: z.string().trim().min(1).max(500), ticketKeys: z.array(z.string()).max(500) }))
    .max(8)
    .default([]),
});
export type MonthlyProposalOutput = z.infer<typeof output>;

/**
 * P-1: a score from 1 to 5 per measured criterion with a reason, and the recurring themes
 * in the month's tickets. The model explains and proposes; it is told not to calculate.
 */
export const monthlyProposal: Prompt<MonthlyProposalInput, MonthlyProposalOutput> = {
  kind: "monthly_proposal",
  version: "monthly-proposal/1",
  tier: "strong",
  maxTokens: 3000,
  system: [
    "You help a finance IT team review a helpdesk vendor's month. You are given, as JSON, the criteria the vendor is scored on, the measured figures behind each criterion with the contract target and whether it was met, and the month's tickets.",
    "For every criterion propose a whole score from 1 (poor) to 5 (excellent) and give the reason in one to three plain sentences that quote the figures you were given. Guide: 5 when every target is clearly beaten, 4 when every target is met, 3 when results are mixed or there are no targets to judge by, 2 when most targets are missed, 1 when targets are missed by a wide margin.",
    "Use only the figures provided. Do not calculate new figures, percentages or counts, and do not invent tickets.",
    "Then name up to five recurring themes in the tickets: problems that come back in several tickets. For each theme give a short title, a summary of one or two sentences, and the keys of the tickets that belong to it. Use only keys from the tickets provided. If nothing recurs, return no themes.",
    'Answer with one JSON object and nothing else, shaped as {"scores":[{"criterionId":"...","score":3,"reason":"..."}],"themes":[{"title":"...","summary":"...","ticketKeys":["..."]}]}.',
  ].join("\n"),
  input: (i) => ({
    task: "monthly_proposal",
    vendor: i.vendorName,
    month: monthName(i.month),
    criteria: i.criteria.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      figures: c.metrics.map((m) => ({
        name: metricInfo[m.key].label,
        measures: metricInfo[m.key].measures,
        value: m.valueTenths == null ? "nothing measured" : formatMetric(m.key, m.valueTenths),
        target: m.targetTenths == null ? "no target" : formatTarget(m.key, m.targetTenths),
        result: m.verdict === "none" ? "not judged" : m.verdict,
        // For reading by a program: the same figure in tenths, and which way is better.
        valueTenths: m.valueTenths,
        targetTenths: m.targetTenths,
        better: metricInfo[m.key].direction === "at_least" ? "higher" : "lower",
      })),
    })),
    tickets: i.tickets.map((t) => ({ key: t.key, summary: t.summary, description: t.description?.slice(0, 300) ?? null, supportLevel: t.level, resolved: t.resolved })),
  }),
  output,
  check: (i, o) => {
    for (const c of i.criteria) if (o.scores.filter((s) => s.criterionId === c.id).length !== 1) return `expected exactly one score for criterion ${c.id}`;
    return null;
  },
};
