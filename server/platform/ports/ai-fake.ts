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

interface Period {
  from: string;
  to: string;
}
interface AskPlanAsk {
  task: "ask_plan";
  today: string;
  periods: Record<string, Period>;
  question: string;
  earlierQuestions: string[];
  vendors: string[];
  people: string[];
  rfps: string[];
}

const periodWords: [RegExp, string][] = [
  [/\bthis quarter\b/, "thisQuarter"],
  [/\b(last|previous) quarter\b/, "lastQuarter"],
  [/\bnext quarter\b/, "nextQuarter"],
  [/\bthis month\b/, "thisMonth"],
  [/\b(last|previous) month\b/, "lastMonth"],
  [/\bnext month\b/, "nextMonth"],
  [/\bthis year\b/, "thisYear"],
  [/\b(last|previous) year\b/, "lastYear"],
  [/\bnext year\b/, "nextYear"],
  [/\bnext (30|thirty) days\b/, "next30Days"],
  [/\bnext (90|ninety) days\b|\bnext three months\b/, "next90Days"],
  [/\b(last|past) (12|twelve) months\b/, "last12Months"],
];
const monthWords = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** The period a question names, if it names one: a phrase such as "this quarter", or a month by name. */
function periodIn(q: string, ask: AskPlanAsk): Period | undefined {
  for (const [pattern, key] of periodWords) if (pattern.test(q)) return ask.periods[key];
  const named = new RegExp(`\\b(?:in|during|for|of) (${monthWords.join("|")})(?: (\\d{4}))?\\b`).exec(q);
  if (!named) return undefined;
  const month = monthWords.indexOf(named[1]!) + 1;
  // A month without a year is the latest one that has started.
  const [thisYear, thisMonth] = [Number(ask.today.slice(0, 4)), Number(ask.today.slice(5, 7))];
  const year = named[2] ? Number(named[2]) : month > thisMonth ? thisYear - 1 : thisYear;
  const two = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${two(month)}-01`, to: `${year}-${two(month)}-${two(new Date(Date.UTC(year, month, 0)).getUTCDate())}` };
}

/** The name from a list that a question mentions: the whole name, or else its first word when that is distinctive. */
function mentioned(q: string, names: string[]): string | undefined {
  const byLength = [...names].sort((a, b) => b.length - a.length);
  const whole = byLength.find((n) => q.includes(n.toLowerCase()));
  if (whole) return whole;
  const words = new Set(q.split(/[^\p{L}\p{N}]+/u));
  const first = byLength.filter((n) => {
    const w = n.split(/\s+/)[0]!.toLowerCase();
    return w.length >= 4 && words.has(w);
  });
  return first.length === 1 ? first[0] : undefined;
}

const CHANGE =
  /^(?:please |can you |could you |will you )?(?:add|create|delete|remove|change|update|set|approve|reject|rename|offboard|cancel|mark|record|move|edit|finalise|finalize|issue)\b/;

/** Which look-ups a question is about, by its words. A real model reads the question; this only recognises the common ones. */
function planFor(q: string, ask: AskPlanAsk): { name: string; args: Record<string, unknown> }[] | "change" | null {
  if (CHANGE.test(q)) return "change";
  // "Invoices over 50,000": the lists have no filter by amount, and leaving the condition out would answer a different question.
  if (/\b(over|above|more than|greater than|under|below|less than|at least|at most|exceed\w*)\s+(?:[€£]|eur|gbp)?\s?\d/.test(q)) return null;
  // A name the app does not know is passed on as it was written, so the answer can say that it is not known.
  const vendor = mentioned(q, ask.vendors) ?? /\b(?:of|for|with|at|from|by) ([A-Z][\p{L}\p{N}&.-]*(?: (?:[A-Z][\p{L}\p{N}&.-]*|Ltd|B\.V\.|GmbH|Inc))+)/u.exec(ask.question)?.[1];
  const period = periodIn(q, ask);
  const has = (pattern: RegExp) => pattern.test(q);

  if (
    has(
      /\b(documents?|clauses?|wording|liabilit\w*|indemni\w*|governing law|penalt\w*|passages?|confidential\w*|contract says?|agreement says?|say about|says about|stat(e|es) about)\b/,
    )
  ) {
    // The words to look for: the question without the words that only ask ("what does ... say about") and without the vendor's own name, which is in every one of its documents.
    const first = vendor?.split(/\s+/)[0]?.toLowerCase();
    const asking =
      /^(what|which|where|when|who|how|does|do|did|is|are|the|a|an|of|in|on|for|with|about|says?|said|mentions?|mentioned|states?|contracts?|documents?|agreements?|our|we|have|has|there|any|that|to|and|or|it|its)$/i;
    const text =
      ask.question
        .split(/[^\p{L}\p{N}'’&.-]+/u)
        .map((w) => w.replace(/^[.'’-]+|[.'’?!-]+$/g, ""))
        .filter((w) => w && !asking.test(w) && (!first || !w.toLowerCase().startsWith(first)))
        .join(" ") || ask.question;
    return [{ name: "documents", args: { text, vendor } }];
  }

  const rfp = mentioned(q, ask.rfps);
  if (rfp && has(/\brfp\b|candidate|shortlist|longlist|winner|won|decision|decided|stage|score/)) return [{ name: "rfp", args: { title: rfp } }];
  if (has(/\brfps?\b|request for proposal|candidates?|shortlist|longlist/))
    return [
      {
        name: "rfps",
        args: { stage: has(/running|open|ongoing|current|still|in progress/) ? "open" : has(/decided|finished|closed/) ? "decided" : has(/cancel/) ? "cancelled" : undefined },
      },
    ];

  if (has(/helpdesk|\bsla\b|tickets?|first response|first.line|backlog|satisfaction|csat|targets?\b/)) {
    const month = period && period.from.slice(0, 7) === period.to.slice(0, 7) ? period.from.slice(0, 7) : undefined;
    return [vendor ? { name: "vendor_helpdesk", args: { vendor, month } } : { name: "helpdesk", args: { month } }];
  }
  if (has(/scorecards?|\bscores?\b|\bscored\b/)) return [{ name: "scorecards", args: { vendor, status: has(/\bfinal/) ? "final" : has(/\bdraft/) ? "draft" : undefined } }];

  const sowTitle = /\bsow \d+\b/.exec(q)?.[0];
  if (sowTitle && has(/milestones?|change requests?|consultants?|day rate|budget|invoiced|remaining|deliver/))
    return [{ name: "sow", args: { title: sowTitle.toUpperCase(), vendor } }];
  if (has(/budgets?|overrun|over.?spen/)) return [{ name: "sow_budgets", args: { vendor } }];
  if (has(/milestones?/)) return [{ name: "warnings", args: { vendor, type: "risk_open_milestones" } }];

  if (has(/invoices?|invoiced|\bspend\b|\bspent\b|\bpaid\b|\bcosts?\b|how much/)) {
    if (!vendor && has(/per vendor|by vendor|per month|by month|\bmost\b|\bspend\b|\bspent\b|each vendor/))
      return [{ name: "spend", args: { from: period?.from, to: period?.to } }];
    return [{ name: "invoices", args: { vendor, from: period?.from, to: period?.to } }];
  }
  if (has(/renew|notice (deadline|period)/)) return [{ name: "renewals", args: {} }];

  if (has(/\b(no|without|missing|lack\w*)\b.*\bnda\b|\bnda\b.*\b(missing|not in place)\b/)) return [{ name: "warnings", args: { vendor, type: "nda_missing" } }];
  if (has(/\b(no|without|missing|lack\w*)\b.*\b(dpa|data processing)\b|\b(dpa|data processing agreement)\b.*\b(missing|not in place)\b/))
    return [{ name: "warnings", args: { vendor, type: "dpa_missing" } }];
  if (has(/risk flags?|\brisks?\b/)) return [{ name: "warnings", args: { vendor, only: "risk_flags" } }];
  if (has(/warnings?|attention|what is wrong|what's wrong|problems?/)) return [{ name: "warnings", args: { vendor } }];

  const kinds: [RegExp, string][] = [
    [/\bsows?\b|statements? of work/, "sow"],
    [/\bmsas?\b|master (services )?agreements?/, "msa"],
    [/subscriptions?|licen[cs]es?/, "subscription"],
    [/\bndas?\b/, "nda"],
    [/\bdpas?\b|data processing/, "dpa"],
  ];
  const kind = kinds.find(([pattern]) => pattern.test(q))?.[1];
  if (kind || has(/agreements?|contracts?/)) {
    const ending = has(/\bend(s|ing|ed)?\b|expir|run out|runs out|finish/);
    return [
      {
        name: "agreements",
        args: {
          vendor,
          kind,
          status: has(/\bactive\b|\brunning\b/)
            ? "active"
            : has(/\bdraft/)
              ? "draft"
              : has(/negotiat/)
                ? "in_negotiation"
                : has(/signature/)
                  ? "out_for_signature"
                  : has(/\bended\b/)
                    ? "ended"
                    : undefined,
          owner: has(/\bown/) ? mentioned(q, ask.people) : undefined,
          endsFrom: ending ? period?.from : undefined,
          endsTo: ending ? period?.to : undefined,
        },
      },
    ];
  }

  // A vendor alone is a question about the vendor only when it reads like one; "what is X's share price" is not something the app holds.
  if (
    vendor &&
    !has(/\bvendors\b|suppliers/) &&
    (has(/tell me|\babout\b|\bwho\b|contacts?|\bown(s|ed|er)?\b|status|details|overview|\bknow\b|paperwork/) || q.split(/\s+/).length <= 3)
  )
    return [{ name: "vendor", args: { vendor } }];
  if (has(/vendors?|suppliers?|\bown(s|ed|er)?\b|consultanc|advisor/)) {
    const type = has(/software/) ? "software" : has(/consultanc/) ? "consultancy" : has(/advisor/) ? "advisory" : undefined;
    const status = has(/prospect/) ? "prospect" : has(/on hold/) ? "on_hold" : has(/offboarded/) ? "offboarded" : has(/\bactive\b/) ? "active" : undefined;
    return [{ name: "vendors", args: { type, status, owner: has(/\bown/) ? mentioned(q, ask.people) : undefined } }];
  }
  return null;
}

function askPlan(ask: AskPlanAsk): string {
  const q = ask.question.toLowerCase();
  let plan = planFor(q, ask);
  // A short follow-up ("and for Quillon?", "and next quarter?") takes the rest from the question before it.
  let before = ask.earlierQuestions.at(-1)?.toLowerCase();
  const followUp = /^(and|what about|how about|same|also)\b/.test(q);
  if (before && followUp && (plan === null || (Array.isArray(plan) && plan[0]?.name === "vendor"))) {
    const [now, then] = [mentioned(q, ask.vendors), mentioned(before, ask.vendors)];
    // The vendor asked about now takes the place of the one asked about before.
    if (now && then) before = before.split(then.toLowerCase()).join(" ").split(then.split(/\s+/)[0]!.toLowerCase()).join(" ");
    if (periodIn(q, ask)) for (const [pattern] of periodWords) before = before.replace(pattern, " ");
    plan = planFor(`${q} ${before}`, ask) ?? plan;
  }
  if (plan === "change") return JSON.stringify({ lookups: [], because: "change" });
  if (!plan) return JSON.stringify({ lookups: [], because: "not_held" });
  return JSON.stringify({ lookups: plan.map((c) => ({ name: c.name, args: Object.fromEntries(Object.entries(c.args).filter(([, v]) => v !== undefined)) })) });
}

interface AskAnswerAsk {
  task: "ask_answer";
  question: string;
  lookedUp: {
    what: string;
    found: number | null;
    figures: Record<string, string>;
    notListedHere: number;
    note: string | null;
    records: ({ ref: string; name: string } & Record<string, string>)[];
    passages: { ref: string; document: string; attachedTo: string; part: string | null; text: string }[];
  }[];
}

/** The facts worth a line in a list, most telling first. */
const tellingFacts = [
  "Vendor",
  "Status",
  "Stage",
  "End date",
  "Renewal date",
  "Notice deadline",
  "Budget used",
  "Budget state",
  "Amount",
  "Date",
  "Overall score",
  "Together in euros",
  "Targets missed",
  "Facts",
  "Due",
  "List",
  "Winner",
];

/** The sentence of a passage that shares the most words with the question, word for word. */
function telling(passage: string, question: string): string {
  const asked = new Set(question.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
  const sentences = passage
    .split(/\n+|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const score = (s: string) => (s.toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => asked.has(w) || [...asked].some((a) => a.slice(0, 5) === w.slice(0, 5))).length;
  // A heading is not a statement; whole sentences are preferred.
  const whole = sentences.filter((s) => /[.!?]$/.test(s));
  return [...(whole.length ? whole : sentences)].sort((a, b) => score(b) - score(a))[0] ?? passage.trim();
}

/** An answer put together from what was looked up, quoting it as given. It lists; it does not reason. */
function askAnswer(ask: AskAnswerAsk): string {
  const out: string[] = [];
  const sources: string[] = [];
  let answered = false;
  const LISTED = 8;
  for (const l of ask.lookedUp) {
    const figures = Object.entries(l.figures).map(([k, v]) => `${k}: ${v}`);
    if (l.passages.length) {
      answered = true;
      for (const p of l.passages.slice(0, 2)) {
        out.push(`The document “${p.document}”${p.part ? `, ${p.part}` : ""} (${p.attachedTo}) says: “${telling(p.text, ask.question)}”`);
        sources.push(p.ref);
      }
    } else if (l.found != null) {
      answered = true;
      out.push(`${l.what}: ${l.found === 0 ? "none" : l.found}.${figures.length && l.found ? ` ${figures.join(". ")}.` : ""}`);
      for (const r of l.records.slice(0, LISTED)) {
        const shown = tellingFacts.filter((k) => r[k]).slice(0, 3);
        out.push(`- ${r.name}${shown.length ? ` (${shown.map((k) => `${k.toLowerCase()}: ${r[k]}`).join("; ")})` : ""}`);
        sources.push(r.ref);
      }
      if (l.records.length > LISTED || l.notListedHere > 0) out.push("Only the first ones are listed here; the list itself has them all.");
    } else if (l.records.length) {
      answered = true;
      out.push(`${l.what}.${figures.length ? ` ${figures.join(". ")}.` : ""}`);
      // One record shown in full (a vendor, a SOW, an RFP) starts with everything known about it; what belongs to it follows as a list.
      const inFull = /^(Vendor|SOW|RFP) · /.test(l.what);
      if (inFull) {
        for (const [k, v] of Object.entries(l.records[0]!)
          .filter(([k]) => k !== "ref" && k !== "name")
          .slice(0, 12))
          out.push(`- ${k}: ${v}`);
        sources.push(l.records[0]!.ref);
      }
      for (const r of l.records.slice(inFull ? 1 : 0, LISTED + 1)) {
        const shown = tellingFacts.filter((k) => r[k]).slice(0, 3);
        out.push(`- ${r.name}${shown.length ? ` (${shown.map((k) => `${k.toLowerCase()}: ${r[k]}`).join("; ")})` : ""}`);
        sources.push(r.ref);
      }
      if (l.records.length > LISTED + 1) out.push("Only the first ones are listed here; the page itself has them all.");
    }
    if (l.note) out.push(l.note);
  }
  return JSON.stringify({ answered, answer: out.join("\n") || "The app looked, and found nothing to answer this from.", sources: sources.slice(0, 12) });
}

interface ContractFieldsAsk {
  task: "contract_fields";
  fileName: string;
  document: string;
}

const MONTHS_LONG = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DATE_WORDS = String.raw`(\d{1,2})(?:st|nd|rd|th)? (january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.? (\d{4})`;
const DATE_FIGURES = String.raw`(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[/.](\d{1,2})[/.](\d{4})`;

/** The first date in a piece of text, as YYYY-MM-DD: "10 February 2027", "2027-02-10" or "10/02/2027" (day first). */
function dateIn(text: string): string | null {
  const two = (n: number | string) => String(n).padStart(2, "0");
  const w = new RegExp(DATE_WORDS, "i").exec(text);
  const f = new RegExp(DATE_FIGURES).exec(text);
  if (w && (!f || w.index <= f.index)) return `${w[3]}-${two(MONTHS_LONG.findIndex((m) => m.startsWith(w[2]!.toLowerCase().slice(0, 3))) + 1)}-${two(w[1]!)}`;
  if (f) return f[1] ? `${f[1]}-${f[2]}-${f[3]}` : `${f[6]}-${two(f[5]!)}-${two(f[4]!)}`;
  return null;
}

/**
 * Reads a contract by looking for the usual phrases, sentence by sentence. A real model
 * understands a contract; this recognises only plain wording, and leaves the rest empty.
 */
function contractFieldsAnswer(ask: ContractFieldsAsk): string {
  const sentences = ask.document
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 400);
  const find = (pattern: RegExp) => sentences.find((s) => pattern.test(s));
  const dated = (pattern: RegExp) => {
    for (const s of sentences) {
      const m = pattern.exec(s);
      const value = m && dateIn(s.slice(m.index));
      if (value) return { value, passage: s };
    }
    return null;
  };
  const kindOf: [RegExp, string][] = [
    [/statement of work|\bsow\b/i, "sow"],
    [/master services agreement|framework agreement|\bmsa\b/i, "msa"],
    [/data processing agreement/i, "dpa"],
    [/non-disclosure|confidentiality agreement|\bnda\b/i, "nda"],
    [/subscription|licen[cs]e|order form/i, "subscription"],
  ];
  const head = sentences.slice(0, 4);
  const kind = kindOf.map(([p, value]) => ({ value, passage: head.find((s) => p.test(s)) })).find((k) => k.passage) ?? null;
  const named = find(/^(?:title|subject|subscription|statement of work|agreement|order form for)\s*[:-]\s*\S/i);
  const title = named
    ? {
        value: named
          .replace(/^[^:-]*[:-]\s*/, "")
          .replace(/[.]$/, "")
          .slice(0, 200),
        passage: named,
      }
    : null;
  const notice = sentences.map((s) => ({ s, m: /(\d{1,3}) days'? (?:written |prior )*notice/i.exec(s) })).find((x) => x.m);
  const money = sentences
    .map((s) => ({ s, m: /(?:budget|annual fee|yearly fee|annual value|fixed price|fee is|price is|fees? of)[^.\d€£]*?(€|£|EUR|GBP)\s?(\d[\d,.]*\d)/i.exec(s) }))
    .find((x) => x.m);
  const amount = money?.m ? money.m[2]!.replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".") : null;
  return JSON.stringify({
    kind,
    title,
    signedOn: dated(/\bsigned\b|\bdated\b|date of signature/i),
    startDate: dated(/\bstarts?\b|\bcommences?\b|effective (?:date|from|on)|\bbegins?\b/i),
    endDate: dated(/\bends?\b|\buntil\b|\bexpires?\b|\brenews on\b|\bterminates on\b/i),
    noticePeriodDays: notice?.m ? { value: Number(notice.m[1]), passage: notice.s } : null,
    amount: amount && money ? { value: amount, passage: money.s } : null,
    currency: money?.m ? { value: /€|EUR/i.test(money.m[1]!) ? "EUR" : "GBP", passage: money.s } : null,
  });
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
    if (ask.task === "contract_fields") return contractFieldsAnswer(ask as ContractFieldsAsk);
    if (ask.task === "ask_plan") return askPlan(ask as AskPlanAsk);
    if (ask.task === "ask_answer") return askAnswer(ask as AskAnswerAsk);
  } catch {
    // Not one of the app's prompts.
  }
  return undefined;
}
