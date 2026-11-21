import type { AiRequest } from "./types";

/**
 * What the local stand-in for the AI answers. It reads the JSON a prompt sends and writes
 * an answer by simple rules, in the shape a real model is asked for, so every screen can
 * be used and tested without a model. It proves the flow, not the quality of real answers.
 */

interface Figure {
  name: string;
  value: string;
  target: string;
  result: string;
  valueTenths: number | null;
  targetTenths: number | null;
  better: "higher" | "lower";
}
interface MonthlyProposalAsk {
  task: "monthly_proposal";
  criteria: { id: string; name: string; figures: Figure[] }[];
  tickets: { key: string; summary: string; description: string | null }[];
}

/** How far a missed figure is from its target, as a share of the target. */
const gap = (f: Figure) => (f.valueTenths == null || !f.targetTenths ? 0 : Math.abs(f.valueTenths - f.targetTenths) / f.targetTenths);

function scoreOf(figures: Figure[]): { score: number; reason: string } {
  const quoted = figures
    .filter((f) => f.valueTenths != null)
    .map((f) => `${f.name} was ${f.value}${f.targetTenths == null ? "" : ` against a target of ${f.target} (${f.result})`}`);
  const facts = quoted.length ? ` ${quoted.join(". ")}.` : "";
  const judged = figures.filter((f) => f.result === "met" || f.result === "missed");
  if (!quoted.length) return { score: 3, reason: "Nothing was measured for this criterion this month, so the middle score is proposed." };
  if (!judged.length) return { score: 3, reason: `There are no targets to judge these figures by, so the middle score is proposed.${facts}` };
  const missed = judged.filter((f) => f.result === "missed");
  if (!missed.length) {
    const clear = judged.every((f) => gap(f) >= 0.04);
    return { score: clear ? 5 : 4, reason: `${clear ? "Every target was clearly beaten." : "Every target was met."}${facts}` };
  }
  const wide = missed.some((f) => gap(f) >= 0.15);
  if (missed.length === judged.length)
    return { score: wide ? 1 : 2, reason: `${judged.length === 1 ? "The target was missed" : "Every target was missed"}${wide ? " by a wide margin" : ""}.${facts}` };
  return { score: wide ? 2 : 3, reason: `Results were mixed: ${missed.length} of ${judged.length} targets missed.${facts}` };
}

function monthlyProposal(ask: MonthlyProposalAsk): string {
  // Tickets about the same thing: here, simply the same summary.
  const groups = new Map<string, MonthlyProposalAsk["tickets"]>();
  for (const t of ask.tickets) groups.set(t.summary, [...(groups.get(t.summary) ?? []), t]);
  const themes = [...groups.entries()]
    .filter(([, list]) => list.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([summary, list]) => ({
      title: summary,
      summary: `Several tickets this month describe the same problem. ${list[0]!.description ?? ""}`.trim(),
      ticketKeys: list.map((t) => t.key),
    }));
  return JSON.stringify({ scores: ask.criteria.map((c) => ({ criterionId: c.id, ...scoreOf(c.figures) })), themes });
}

/** Answers the prompts it knows; anything else gets the plain stand-in answer. */
export function standInAnswer(req: AiRequest): string | undefined {
  if (!req.json) return undefined;
  try {
    const ask = JSON.parse(req.user) as { task?: string };
    if (ask.task === "monthly_proposal") return monthlyProposal(ask as MonthlyProposalAsk);
  } catch {
    // Not one of the app's prompts.
  }
  return undefined;
}
