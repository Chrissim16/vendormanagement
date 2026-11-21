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

interface ReportSummaryAsk {
  task: "report_summary";
  month: string;
  invoicedInTheMonth: { togetherInEuros: string; byVendor: { vendor: string; togetherInEuros: string }[] };
  sowBudgets: { vendor: string; sow: string; used: string; state: string }[];
  agreementsEndingSoon: { vendor: string; agreement: string; ends: string }[];
  vendorScores: { vendor: string; score: string; trend: string; before: string | null }[];
  missedHelpdeskTargets: { vendor: string; measure: string; figure: string; target: string }[];
  helpdeskVendorsMeasured: number;
}

/** A paragraph put together from the report's own lines, quoting them as given. */
function reportSummary(ask: ReportSummaryAsk): string {
  const out: string[] = [];
  const top = ask.invoicedInTheMonth.byVendor[0];
  out.push(
    top
      ? `In ${ask.month}, ${ask.invoicedInTheMonth.togetherInEuros} was invoiced, the largest part by ${top.vendor} (${top.togetherInEuros}).`
      : `Nothing was invoiced in ${ask.month}.`,
  );
  const tight = ask.sowBudgets.filter((s) => s.state !== "within budget").slice(0, 2);
  if (tight.length) out.push(`Budgets need attention: ${tight.map((s) => `${s.vendor} ${s.sow} is ${s.state} with ${s.used} used`).join(", and ")}.`);
  else if (ask.sowBudgets.length) out.push("Every SOW is within its budget.");
  const next = ask.agreementsEndingSoon[0];
  if (next) out.push(`The first agreement to end is ${next.agreement} with ${next.vendor}, on ${next.ends}.`);
  const fell = ask.vendorScores.filter((s) => s.trend === "down").slice(0, 2);
  if (fell.length) out.push(`${fell.map((s) => `${s.vendor}'s score fell to ${s.score}${s.before ? ` from ${s.before}` : ""}`).join(", and ")}.`);
  const missed = ask.missedHelpdeskTargets.slice(0, 2);
  if (missed.length) out.push(`Helpdesk targets were missed: ${missed.map((m) => `${m.vendor} on ${m.measure} (${m.figure} against ${m.target})`).join(", and ")}.`);
  else if (ask.helpdeskVendorsMeasured > 0) out.push("Every helpdesk target was met.");
  return JSON.stringify({ summary: out.join(" ") });
}

interface BriefingAsk {
  task: "briefing";
  vendor: { name: string; status: string };
  upcomingDates: { date: string; what: string; when: string }[];
  budgets: { sow: string; used: string; state: string }[];
  missedTargets: { month: string; measure: string; figure: string; target: string }[];
  openMilestones: { sow: string; milestone: string; due: string; late: string }[];
  changeRequestsWaiting: { sow: string; change: string }[];
  warningsAndRiskFlags: { about: string; what: string; facts: string }[];
}

/** A summary and talking points picked from the briefing's own facts, in the order a meeting would take them. */
function briefing(ask: BriefingAsk): string {
  const name = ask.vendor.name;
  const flags = ask.warningsAndRiskFlags;
  const summary: string[] = [];
  if (flags.length) summary.push(`What most needs attention with ${name}: ${flags[0]!.about} (${flags[0]!.what.toLowerCase()}). ${flags[0]!.facts}`);
  else summary.push(`Nothing about ${name} needs attention at the moment.`);
  const tight = ask.budgets.filter((b) => b.state !== "within budget");
  if (tight.length) summary.push(`${tight[0]!.sow} is ${tight[0]!.state} with ${tight[0]!.used} used.`);
  else if (ask.budgets.length) summary.push("Its SOWs are within budget.");
  if (ask.missedTargets.length)
    summary.push(`Helpdesk targets were missed in the last months, most recently ${ask.missedTargets.at(-1)!.measure} in ${ask.missedTargets.at(-1)!.month}.`);

  const points: string[] = [];
  for (const f of flags.slice(0, 3)) points.push(`${f.about}: ${f.what.toLowerCase()}. Ask what the vendor will do about it and by when.`);
  const missed = ask.missedTargets.at(-1);
  if (missed) points.push(`Ask what is being done about ${missed.measure}, which was ${missed.figure} in ${missed.month} against a target of ${missed.target}.`);
  const late = ask.openMilestones.find((m) => m.late !== "not late");
  if (late) points.push(`Ask for a firm date for "${late.milestone}" on ${late.sow}, which was due ${late.due} and is ${late.late}.`);
  const change = ask.changeRequestsWaiting[0];
  if (change) points.push(`Decide on the change request "${change.change}" for ${change.sow}, which is still waiting.`);
  const date = ask.upcomingDates.find((d) => d.when !== "passed");
  if (date) points.push(`Agree what has to happen before ${date.date}: ${date.what}.`);
  if (!points.length) points.push("Nothing needs raising from the records; confirm that the vendor sees it the same way.");
  return JSON.stringify({ summary: summary.join(" "), talkingPoints: points.slice(0, 6) });
}

interface RfpDraftAsk {
  task: "rfp_draft";
  title: string;
  need: string;
  decisionWantedBy: string | null;
  template: { sections: { heading: string; guidance: string }[]; criteria: { name: string; part: "written" | "demo"; weight: number }[] };
}

/** Questions a first draft can always ask, per kind of criterion. A real model writes them for the need at hand. */
const questionBank: string[][] = [
  [
    "Describe how your offer meets the need set out in the introduction.",
    "Which parts of the need are met as standard, which need configuration and which need custom work?",
    "Which comparable organisations use your offer for the same purpose, and since when?",
    "What is on your roadmap for the coming year that matters for this need?",
  ],
  [
    "Where is our data stored and processed, and which subprocessors are involved?",
    "Which security certifications do you hold, and when were they last audited?",
    "How does your offer connect to other systems, and which interfaces are available?",
  ],
  [
    "Describe your implementation approach, with the main phases and what you need from us in each.",
    "What support do you give after going live, during which hours and with which response times?",
    "Who would be on the team for this work, and what is their experience?",
  ],
  [
    "Describe your pricing model and what drives the price.",
    "Which costs come on top of the licence or fee, such as implementation, training or support?",
    "What are the contract term, the notice period and the conditions for renewal?",
  ],
];

/** A first draft put together from the template and the need as it was typed. */
function rfpDraft(ask: RfpDraftAsk): string {
  const bodies = [
    // The need was written for colleagues; a real model rewords it for vendors. The stand-in leaves that to a person and does not copy it.
    `We invite you to respond to this request for proposal for ${ask.title}. [Describe here, in words meant for vendors, what you need and why. The need as recorded in the demand was written for colleagues and is not copied into this document.]`,
    `The scope of this request is ${ask.title}, as described in the introduction. Please make clear what your offer includes as standard and what it does not. [Add what is out of scope.]`,
    `Responses are compared on the written answers first. Vendors on the shortlist may then be invited to a demonstration or an interview. ${ask.decisionWantedBy ? `We intend to decide by ${ask.decisionWantedBy}.` : "[Add the day a decision is expected.]"}`,
    "Answer every question in the answer sheet that comes with this document, in the Answer column, and return the sheet as an Excel file. Supporting material may be sent along as PDF or Word. [Add the closing date and whom to ask questions.]",
    "Every response is scored per criterion on a scale from 1 to 5. The criteria and their weights are listed in this document, so that you know what matters most to us.",
    "This document, and everything shared in the course of this request, is confidential and is to be used for preparing your response only. [Add the terms that apply.]",
  ];
  const written = ask.template.criteria.filter((c) => c.part === "written");
  return JSON.stringify({
    sections: ask.template.sections.map((s, i) => ({ heading: s.heading, body: bodies[i] ?? `${s.guidance} [To be written.]` })),
    criteria: ask.template.criteria,
    questions: written.flatMap((c, i) =>
      (questionBank[i] ?? [`Describe how you would meet our expectations on ${c.name.toLowerCase()}.`, `What evidence can you give for ${c.name.toLowerCase()}?`]).map((text) => ({
        text,
        criterion: c.name,
      })),
    ),
  });
}

interface RfpComparisonAsk {
  task: "rfp_comparison";
  criterion: string;
  candidates: { id: string; name: string; answered: string }[];
  questions: { id: string; number: number; question: string; answers: { candidateId: string; answer: string | null }[] }[];
}

/** The opening of an answer, cut between words so that no figure is cut in two. */
function opening(answer: string): string {
  const text = answer.trim().replace(/\s+/g, " ");
  const sentence = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
  if (sentence.length <= 280) return sentence;
  return sentence.slice(0, sentence.lastIndexOf(" ", 280));
}

/** A passage to quote: the opening of the first answer that is long enough to show something, or else a whole short answer. */
function passage(answers: string[]): string {
  const openings = answers.map(opening);
  return openings.find((o) => o.length >= 20) ?? answers.map((a) => a.trim().replace(/\s+/g, " ")).find((a) => a.length <= 500) ?? openings[0]!;
}

/** Summaries that open with each candidate's own words, and scores that only reward how much was answered. */
function rfpComparison(ask: RfpComparisonAsk): string {
  const name = (id: string) => ask.candidates.find((c) => c.id === id)?.name ?? "A candidate";
  const questions = ask.questions.map((q) => {
    const given = q.answers.filter((a) => a.answer?.trim());
    const silent = q.answers.filter((a) => !a.answer?.trim());
    const fullest = [...given].sort((a, b) => b.answer!.length - a.answer!.length)[0];
    const differences = [
      !given.length
        ? "Nobody answered this question."
        : given.length === 1
          ? `Only ${name(given[0]!.candidateId)} answered.`
          : `${name(fullest!.candidateId)} gave the most detail.`,
      given.length > 1 && silent.length ? `${silent.map((a) => name(a.candidateId)).join(" and ")} did not answer.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return { questionId: q.id, summaries: q.answers.map((a) => ({ candidateId: a.candidateId, summary: a.answer?.trim() ? opening(a.answer) : "No answer." })), differences };
  });
  const scores = ask.candidates.flatMap((c) => {
    const mine = ask.questions.map((q) => q.answers.find((a) => a.candidateId === c.id)?.answer?.trim() ?? "").filter(Boolean);
    if (!mine.length) return [];
    const all = mine.length === ask.questions.length;
    const detailed = mine.reduce((n, a) => n + a.length, 0) / mine.length >= 150;
    const score = all ? (detailed ? 4 : 3) : 2;
    const how = all ? (detailed ? "in some detail" : "briefly") : "and left the rest open";
    return [
      {
        candidateId: c.id,
        score,
        reason: `${c.name} answered ${c.answered} on ${ask.criterion}, ${how}. Read the answers before relying on this score.`,
        quote: passage(mine),
      },
    ];
  });
  return JSON.stringify({ questions, scores });
}

/** Answers the prompts it knows; anything else gets the plain stand-in answer. */
export function standInAnswer(req: AiRequest): string | undefined {
  if (!req.json) return undefined;
  try {
    const ask = JSON.parse(req.user) as { task?: string };
    if (ask.task === "monthly_proposal") return monthlyProposal(ask as MonthlyProposalAsk);
    if (ask.task === "report_summary") return reportSummary(ask as ReportSummaryAsk);
    if (ask.task === "briefing") return briefing(ask as BriefingAsk);
    if (ask.task === "rfp_draft") return rfpDraft(ask as RfpDraftAsk);
    if (ask.task === "rfp_comparison") return rfpComparison(ask as RfpComparisonAsk);
  } catch {
    // Not one of the app's prompts.
  }
  return undefined;
}
