import type { MetricKey } from "../../../shared/performance";
import type { UsedMetric } from "../../../shared/scorecards";
import { monthlyProposal, type MonthlyProposalInput, type MonthlyProposalOutput } from "../prompts/monthly-proposal";
import type { EvalCase } from "./index";

// Everything here is invented: vendor, tickets and figures.

const m = (key: MetricKey, valueTenths: number | null, targetTenths: number | null, verdict: UsedMetric["verdict"]): UsedMetric => ({ key, valueTenths, targetTenths, verdict });
const ticket = (n: number, summary: string, description: string) => ({ key: `EVAL-${n}`, summary, description, level: 1, resolved: true });
const criteria = (quality: UsedMetric[], timeliness: UsedMetric[]): MonthlyProposalInput["criteria"] => [
  { id: "quality", name: "Quality of delivery", description: "How well tickets are solved the first time, and how users rate the result.", metrics: quality },
  { id: "timeliness", name: "Timeliness", description: "Speed of first response and resolution against the contract.", metrics: timeliness },
];
const mixedTickets = [
  ticket(1, "Bank statement import failed overnight", "No statements were loaded this morning."),
  ticket(2, "Bank file not imported", "The import of the bank file stopped with a format error."),
  ticket(3, "Statements missing after nightly import", "Yesterday's statements are missing."),
  ticket(4, "Password reset link does not arrive", "The reset email never arrives."),
  ticket(5, "Cannot reset password", "The link in the reset mail is expired at once."),
  ticket(6, "Question about closing a period", "Which steps are needed to reopen a period?"),
];
const base = (c: MonthlyProposalInput["criteria"], tickets = mixedTickets): MonthlyProposalInput => ({
  vendorName: "Evaluation Vendor (invented)",
  month: "2026-10",
  criteria: c,
  tickets,
});

type Case = EvalCase<MonthlyProposalInput, MonthlyProposalOutput>;
const scoreOf = (o: MonthlyProposalOutput, id: string) => o.scores.find((s) => s.criterionId === id)!;
const within = (o: MonthlyProposalOutput, id: string, lo: number, hi: number, why: string) => {
  const s = scoreOf(o, id).score;
  return s >= lo && s <= hi ? [] : [`${id}: score ${s} where ${lo} to ${hi} was expected (${why})`];
};
/** A reason must quote at least one of the figures it was given, and must not introduce percentages that were not in the input. */
function grounded(input: MonthlyProposalInput, o: MonthlyProposalOutput): string[] {
  const given = JSON.stringify(monthlyProposal.input(input));
  const problems: string[] = [];
  for (const s of o.scores) {
    const numbers = s.reason.match(/\d+(?:[.,]\d+)?\s?%/g) ?? [];
    for (const n of numbers)
      if (!given.includes(n.replace(/\s/g, "").replace(",", "."))) problems.push(`${s.criterionId}: the reason quotes ${n}, which is not one of the figures provided`);
  }
  return problems;
}
const knownTickets = (input: MonthlyProposalInput, o: MonthlyProposalOutput) => {
  const keys = new Set(input.tickets.map((t) => t.key));
  return o.themes.flatMap((t) => t.ticketKeys.filter((k) => !keys.has(k)).map((k) => `theme "${t.title}" names ticket ${k}, which was not provided`));
};

const allMet = base(
  criteria(
    [m("first_line", 780, 650, "met"), m("csat", 46, 40, "met")],
    [m("first_response", 985, 950, "met"), m("sla_breaches", 20, 100, "met"), m("backlog_age", 80, 300, "met")],
  ),
);
const timelinessMissed = base(
  criteria(
    [m("first_line", 700, 650, "met"), m("csat", 43, 40, "met")],
    [m("first_response", 720, 950, "missed"), m("sla_breaches", 240, 100, "missed"), m("backlog_age", 610, 300, "missed")],
  ),
);
const noTargets = base(
  criteria(
    [m("first_line", 700, null, "none"), m("csat", 41, null, "none")],
    [m("first_response", 900, null, "none"), m("sla_breaches", 80, null, "none"), m("backlog_age", 120, null, "none")],
  ),
);
const nothingRecurs = base(
  criteria(
    [m("first_line", 700, 650, "met"), m("csat", null, 40, "none")],
    [m("first_response", 960, 950, "met"), m("sla_breaches", 90, 100, "met"), m("backlog_age", null, 300, "none")],
  ),
  [
    ticket(1, "Printer for remittance advice offline", "Nothing prints since the move."),
    ticket(2, "Cost centre missing from the dropdown", "A new cost centre cannot be chosen."),
    ticket(3, "Export cuts off rows", "The export stops at ten thousand rows."),
  ],
);

export const monthlyProposalCases: Case[] = [
  {
    name: "monthly proposal: every target met gives high scores",
    prompt: monthlyProposal,
    input: allMet,
    check: (o) => [...within(o, "quality", 4, 5, "all targets met"), ...within(o, "timeliness", 4, 5, "all targets met"), ...grounded(allMet, o), ...knownTickets(allMet, o)],
  },
  {
    name: "monthly proposal: timeliness missed by a wide margin scores low, quality stays high",
    prompt: monthlyProposal,
    input: timelinessMissed,
    check: (o) => [
      ...within(o, "timeliness", 1, 2, "every timeliness target missed widely"),
      ...within(o, "quality", 4, 5, "quality targets met"),
      ...grounded(timelinessMissed, o),
      ...knownTickets(timelinessMissed, o),
    ],
  },
  {
    name: "monthly proposal: without targets the score stays in the middle",
    prompt: monthlyProposal,
    input: noTargets,
    check: (o) => [...within(o, "quality", 3, 3, "no targets to judge by"), ...within(o, "timeliness", 3, 3, "no targets to judge by"), ...grounded(noTargets, o)],
  },
  {
    name: "monthly proposal: recurring problems are named as themes with their own tickets",
    // The tickets describe the same problem in different words.
    needsRealModel: true,
    prompt: monthlyProposal,
    input: allMet,
    check: (o) => {
      const bank = o.themes.find((t) => /bank|statement|import/i.test(`${t.title} ${t.summary}`));
      if (!bank) return o.themes.length ? ["no theme about the bank statement import, which three tickets describe"] : ["no themes at all, although two problems recur"];
      return ["EVAL-1", "EVAL-2", "EVAL-3"].filter((k) => !bank.ticketKeys.includes(k)).map((k) => `the bank import theme leaves out ${k}`);
    },
  },
  {
    name: "monthly proposal: no themes are invented when nothing recurs",
    prompt: monthlyProposal,
    input: nothingRecurs,
    check: (o) => [...(o.themes.length ? [`${o.themes.length} theme(s) named although no problem occurs twice`] : []), ...knownTickets(nothingRecurs, o)],
  },
];
