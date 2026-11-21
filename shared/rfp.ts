import { z } from "zod";
import { isDay, type Day } from "./dates";
import { currencies, type Currency } from "./money";
import type { TextSuggestion } from "./overview";
import { cleanName, vendorTypes, type Paperwork, type VendorStatus, type VendorType } from "./vendors";

/**
 * The rules of an RFP (Q-1 to Q-11): its stages, what a document must hold before it can
 * be reviewed, how an answer sheet is matched to the questions, and how scores add up.
 * Everything here is pure, so the screens and the server apply the very same rules.
 */

export const rfpStages = ["drafting", "in_review", "approved", "issued", "evaluating", "decided", "cancelled"] as const;
export type RfpStage = (typeof rfpStages)[number];
export const rfpStageLabels: Record<RfpStage, string> = {
  drafting: "Drafting",
  in_review: "In review",
  approved: "Approved",
  issued: "Issued",
  evaluating: "Evaluating",
  decided: "Decided",
  cancelled: "Cancelled",
};
/** The stages an RFP passes through, in order. Cancelled is a way out of any of them. */
export const rfpPath: RfpStage[] = ["drafting", "in_review", "approved", "issued", "evaluating", "decided"];
export const isOpen = (stage: RfpStage) => stage !== "decided" && stage !== "cancelled";
/** Sections, criteria and questions can be changed until the RFP has gone out to a candidate (Q-5). */
export const contentLocked = (stage: RfpStage) => !["drafting", "in_review", "approved"].includes(stage);
/**
 * The document and the two part weights are changed while drafting or in review. An
 * approved RFP is taken back to drafting first, so that what goes out is what was approved.
 */
export const contentEditable = (stage: RfpStage) => stage === "drafting" || stage === "in_review";

export const parts = ["written", "demo"] as const;
export type Part = (typeof parts)[number];
export const partLabels: Record<Part, string> = { written: "Written answers", demo: "Demo and interview" };

const day = z.string().refine(isDay, "That date does not exist.");
const optionalDay = z.preprocess((v) => (v === "" ? null : v), day.nullable()).default(null);
const optionalText = (max: number) =>
  z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z
        .string()
        .trim()
        .max(max, `At most ${max.toLocaleString("en-GB")} characters.`)
        .nullable(),
    )
    .default(null);
const requiredText = (max: number, missing: string) =>
  z
    .string()
    .trim()
    .min(1, missing)
    .max(max, `At most ${max.toLocaleString("en-GB")} characters.`);

// ---------- Demand (Q-1)

export const rfpDemandSchema = z
  .object({
    title: requiredText(200, "Give the RFP a title."),
    need: requiredText(5000, "Describe what is needed."),
    budgetMinor: z.number().int().min(0, "The budget cannot be negative.").max(Number.MAX_SAFE_INTEGER).nullable().default(null),
    currency: z.enum(currencies).default("EUR"),
    sponsor: optionalText(200),
    demandApprovedOn: optionalDay,
    targetDecisionDate: optionalDay,
    ownerUserId: z.string().uuid("Choose an owner."),
    writtenWeight: z.number().int().min(0).max(100).default(70),
    demoWeight: z.number().int().min(0).max(100).default(30),
  })
  .superRefine((v, ctx) => {
    if (v.writtenWeight + v.demoWeight !== 100)
      ctx.addIssue({ code: "custom", path: ["demoWeight"], message: `The two parts must add up to 100. They now add up to ${v.writtenWeight + v.demoWeight}.` });
  });
export type RfpDemand = z.infer<typeof rfpDemandSchema>;

// ---------- The document: sections, criteria, questions (Q-2)

export const rfpContentSchema = z.object({
  sections: z
    .array(z.object({ heading: requiredText(200, "Give the section a heading."), body: optionalText(10_000) }))
    .max(30, "An RFP has at most 30 sections.")
    .default([]),
  criteria: z
    .array(
      z.object({
        /** Names the criterion within this save, so questions can point at one that has no id yet. */
        key: z.string().min(1).max(60),
        name: z.string().transform(cleanName).pipe(requiredText(120, "Give the criterion a name.")),
        weight: z.number("Enter a weight.").int("A weight is a whole number.").min(1, "A weight is between 1 and 100.").max(100, "A weight is between 1 and 100."),
        part: z.enum(parts),
      }),
    )
    .max(20, "An RFP has at most 20 criteria.")
    .default([]),
  questions: z
    .array(z.object({ text: requiredText(1000, "Write the question."), criterionKey: z.string().min(1, "Choose the criterion this question belongs to.").max(60) }))
    .max(150, "An RFP has at most 150 questions.")
    .default([]),
});
export type RfpContentInput = z.infer<typeof rfpContentSchema>;

/**
 * What is wrong with a document as a whole, keyed the way the form names its fields:
 * weights within a part add up to 100, names are not repeated within a part, and every
 * question belongs to one written criterion.
 */
export function contentProblems(c: RfpContentInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of parts) {
    const mine = c.criteria.filter((x) => x.part === part);
    const sum = mine.reduce((n, x) => n + x.weight, 0);
    if (mine.length && sum !== 100) out[`weights.${part}`] = `The weights for ${partLabels[part].toLowerCase()} must add up to 100. They now add up to ${sum}.`;
  }
  const seen = new Set<string>();
  c.criteria.forEach((x, i) => {
    const k = `${x.part}:${x.name.toLowerCase()}`;
    if (seen.has(k)) out[`criteria.${i}.name`] = "This part already has a criterion with this name.";
    seen.add(k);
  });
  const byKey = new Map(c.criteria.map((x) => [x.key, x]));
  c.questions.forEach((q, i) => {
    const criterion = byKey.get(q.criterionKey);
    if (!criterion) out[`questions.${i}.criterionKey`] = "Choose the criterion this question belongs to.";
    else if (criterion.part !== "written") out[`questions.${i}.criterionKey`] = "A question belongs to a criterion for the written answers.";
  });
  return out;
}

/** What still stops a draft from going to its reviewers, in plain sentences. Empty when it can go. */
export function reviewBlockers(r: { sections: unknown[]; criteria: { part: Part; weight: number }[]; questions: unknown[]; demoWeight: number; writtenWeight: number }): string[] {
  const out: string[] = [];
  const written = r.criteria.filter((c) => c.part === "written");
  const demo = r.criteria.filter((c) => c.part === "demo");
  const sum = (list: { weight: number }[]) => list.reduce((n, c) => n + c.weight, 0);
  if (!r.sections.length) out.push("The RFP has no sections yet.");
  if (!written.length && r.writtenWeight > 0) out.push("There is no criterion for the written answers yet.");
  if (written.length && sum(written) !== 100) out.push("The weights for the written answers do not add up to 100.");
  if (demo.length && sum(demo) !== 100) out.push("The weights for demo and interview do not add up to 100.");
  if (!r.questions.length) out.push("The question list is empty.");
  if (r.demoWeight > 0 && !demo.length) out.push(`Demo and interview count for ${r.demoWeight}% but have no criteria. Add one, or set that part to 0 in the demand.`);
  if (r.demoWeight === 0 && demo.length) out.push("There are criteria for demo and interview, but that part counts for 0%. Give it a weight in the demand, or remove them.");
  if (r.writtenWeight === 0 && written.length) out.push("There are criteria for the written answers, but that part counts for 0%. Give it a weight in the demand, or remove them.");
  return out;
}

/** The template every RFP starts from: the sections to write, with what each is for, and the usual criteria. */
export const RFP_TEMPLATE: { sections: { heading: string; guidance: string }[]; criteria: { name: string; part: Part; weight: number }[] } = {
  sections: [
    { heading: "Introduction and background", guidance: "Who we are, what prompts this request and what we want to achieve." },
    { heading: "Scope and requirements", guidance: "What the vendor is asked to deliver, what is in scope and what is not." },
    { heading: "Timeline and process", guidance: "The steps from issue to decision and what happens at each." },
    { heading: "How to respond", guidance: "What to send back, in what form, and whom to ask questions." },
    { heading: "How responses are evaluated", guidance: "The criteria, the written answers and the demo or interview." },
    { heading: "Confidentiality and terms", guidance: "How information is handled and which terms apply to this request." },
  ],
  criteria: [
    { name: "Functional fit", part: "written", weight: 40 },
    { name: "Technology and security", part: "written", weight: 25 },
    { name: "Implementation and support", part: "written", weight: 20 },
    { name: "Commercial terms", part: "written", weight: 15 },
    { name: "Demonstration", part: "demo", weight: 60 },
    { name: "Team and interview", part: "demo", weight: 40 },
  ],
};

/** What the AI drafts, and what "start from the template" fills in without it. */
export interface RfpDraft {
  sections: { heading: string; body: string }[];
  criteria: { name: string; part: Part; weight: number }[];
  /** `criterion` is the name of one of the written criteria above. */
  questions: { text: string; criterion: string }[];
}
export const templateDraft = (): RfpDraft => ({ sections: RFP_TEMPLATE.sections.map((s) => ({ heading: s.heading, body: "" })), criteria: RFP_TEMPLATE.criteria, questions: [] });

/** A draft in the shape a save takes, with the criteria named by their position. */
export const draftToContent = (d: RfpDraft): RfpContentInput => {
  const key = (name: string) => `new-${d.criteria.findIndex((c) => c.part === "written" && c.name.toLowerCase() === name.toLowerCase())}`;
  return {
    sections: d.sections.map((s) => ({ heading: s.heading, body: s.body || null })),
    criteria: d.criteria.map((c, i) => ({ key: `new-${i}`, name: c.name, weight: c.weight, part: c.part })),
    questions: d.questions.map((q) => ({ text: q.text, criterionKey: key(q.criterion) })),
  };
};

const squash = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
/** Whether the document still reads exactly as the AI drafted it; if not, a person has edited it (AI-1). */
export function sameAsDraft(doc: { sections: RfpSection[]; criteria: RfpCriterion[]; questions: RfpQuestion[] }, d: RfpDraft): boolean {
  const names = new Map(doc.criteria.map((c) => [c.id, c.name]));
  const mine = JSON.stringify([
    doc.sections.map((s) => [squash(s.heading), squash(s.body)]),
    doc.criteria.map((c) => [squash(c.name).toLowerCase(), c.part, c.weight]),
    doc.questions.map((q) => [squash(q.text), squash(names.get(q.criterionId)).toLowerCase()]),
  ]);
  const theirs = JSON.stringify([
    d.sections.map((s) => [squash(s.heading), squash(s.body)]),
    d.criteria.map((c) => [squash(c.name).toLowerCase(), c.part, c.weight]),
    d.questions.map((q) => [squash(q.text), squash(q.criterion).toLowerCase()]),
  ]);
  return mine === theirs;
}

// ---------- Review (Q-3)

export const signoffOutcomes = ["approved", "changes_requested"] as const;
export type SignoffOutcome = (typeof signoffOutcomes)[number];
export const signoffLabels: Record<SignoffOutcome, string> = { approved: "Approved", changes_requested: "Changes requested" };
export const signoffSchema = z
  .object({
    reviewerName: requiredText(200, "Name the reviewer."),
    reviewerRole: optionalText(200),
    outcome: z.enum(signoffOutcomes, "Choose what the reviewer decided."),
    onDate: day,
    comment: optionalText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === "changes_requested" && !v.comment) ctx.addIssue({ code: "custom", path: ["comment"], message: "Say which changes were asked for." });
  });

// ---------- Candidates (Q-4, Q-5)

export const candidateLists = ["longlist", "shortlist", "dropped"] as const;
export type CandidateList = (typeof candidateLists)[number];
export const candidateListLabels: Record<CandidateList, string> = { longlist: "Longlist", shortlist: "Shortlist", dropped: "Dropped" };
const reason = requiredText(1000, "Give the reason.");
export const candidateSchema = z
  .object({
    vendorId: z.string().uuid().nullable().default(null),
    /** A candidate the app does not know yet is added as a prospect vendor. */
    newVendor: z
      .object({ name: z.string().transform(cleanName).pipe(requiredText(200, "Give the vendor a name.")), type: z.enum(vendorTypes, "Choose a type.") })
      .nullable()
      .default(null),
    list: z.enum(["longlist", "shortlist"]).default("longlist"),
    reason,
  })
  .superRefine((v, ctx) => {
    if (!v.vendorId && !v.newVendor) ctx.addIssue({ code: "custom", path: ["vendorId"], message: "Choose a vendor, or add a new one." });
  });
export const candidateMoveSchema = z.object({ list: z.enum(candidateLists), reason });
export const issueSchema = z.object({ issuedOn: day, ndaWarningAcknowledged: z.boolean().default(false) });

// ---------- Responses (Q-6)

export const MAX_ANSWER = 8000;
export const answerSchema = z.object({
  text: z.string().trim().max(MAX_ANSWER, "An answer is at most 8,000 characters."),
  /** The row of the uploaded sheet this text was taken from, when it is one of the rows that could not be matched. */
  fromUnmatchedRow: z.number().int().nullable().default(null),
});
/** Names one of the rows that could not be matched: its place in the sheet and what it says, so a row of a sheet uploaded since is never taken for it. */
export const unmatchedRowSchema = z.object({ row: z.number().int(), answer: z.string().max(MAX_ANSWER) });

export interface SheetRow {
  /** The row in the uploaded sheet, as Excel numbers it. */
  row: number;
  number: string;
  question: string;
  answer: string;
}

const plainText = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.?!:;]+$/, "");

/**
 * Matches the rows of a filled answer sheet to the questions (Q-6). A row belongs to the
 * question whose number it carries, provided the question written in the row is that
 * question: a sheet made before the questions were renumbered, or one in which a vendor
 * moved rows about, must not put an answer under another question. When number and
 * wording disagree, or there is no usable number, the wording decides. Rows without an
 * answer are left out. A row that fits no question, or a second answer to the same
 * question, is handed back as unmatched.
 */
export function matchAnswers(
  rows: SheetRow[],
  questions: { id: string; number: number; text: string }[],
): { matched: { questionId: string; text: string; row: number }[]; unmatched: SheetRow[] } {
  const byNumber = new Map(questions.map((q) => [String(q.number), q]));
  const byText = new Map(questions.map((q) => [plainText(q.text), q]));
  const matched: { questionId: string; text: string; row: number }[] = [];
  const unmatched: SheetRow[] = [];
  const taken = new Set<string>();
  for (const r of rows) {
    const answer = r.answer.trim();
    if (!answer) continue;
    const number = r.number.trim().replace(/^q\s*/i, "").replace(/\.0*$/, "").replace(/[.)]$/, "");
    const wording = r.question.trim() ? plainText(r.question) : null;
    const numbered = byNumber.get(number);
    const q = numbered && (wording == null || plainText(numbered.text) === wording) ? numbered : wording == null ? undefined : byText.get(wording);
    if (!q || taken.has(q.id)) unmatched.push({ ...r, answer });
    else {
      taken.add(q.id);
      matched.push({ questionId: q.id, text: answer, row: r.row });
    }
  }
  return { matched, unmatched };
}

// ---------- AI comparison (Q-7)

export interface RfpComparison {
  questions: { questionId: string; summaries: { candidateId: string; summary: string }[]; differences: string }[];
  /** A proposed score per candidate and written criterion, with a reason and the passage of the answer it rests on. */
  scores: { candidateId: string; criterionId: string; score: number; reason: string; quote: string }[];
}

// ---------- Scoring (Q-8)

export const rfpScoreSchema = z.object({
  score: z.number("Choose a score.").int().min(1, "A score is between 1 and 5.").max(5, "A score is between 1 and 5."),
  comment: optionalText(1000),
  /** Set when the score is the AI's proposal taken over: the comparison that was on screen. */
  suggestionId: z.string().uuid().nullable().default(null),
});

export interface ScoreInput {
  candidateId: string;
  criterionId: string;
  score: number;
}
export interface CandidateResult {
  candidateId: string;
  /** Average across evaluators per criterion, in hundredths (425 is 4.25); null while nobody has scored it. */
  criteria: { criterionId: string; averageHundredths: number | null; scores: number }[];
  written: PartResult;
  demo: PartResult;
  /** Written and demo combined by their weights; null until every criterion that counts has a score. */
  overallHundredths: number | null;
  /** 1 is best. Candidates with the same overall score share a place. Null until there is an overall score. */
  rank: number | null;
}
export interface PartResult {
  hundredths: number | null;
  scored: number;
  criteria: number;
}

interface Fraction {
  num: number;
  den: number;
}
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const frac = (num: number, den: number): Fraction => {
  const g = gcd(num, den) || 1;
  return { num: num / g, den: den / g };
};
const add = (a: Fraction, b: Fraction) => frac(a.num * b.den + b.num * a.den, a.den * b.den);
const times = (a: Fraction, n: number, d = 1) => frac(a.num * n, a.den * d);
/** A fraction as hundredths, halves rounded up, without ever leaving whole numbers. */
const hundredths = (f: Fraction) => Math.floor((200 * f.num + f.den) / (2 * f.den));

/** 425 → "4.25" */
export const formatHundredths = (h: number | null | undefined) => (h == null ? "–" : `${Math.floor(h / 100)}.${String(h % 100).padStart(2, "0")}`);

/**
 * The scores of an RFP worked out (Q-8). A candidate's score on a criterion is the average
 * of everyone's scores for it. A part's score is the average of its criteria by weight.
 * The overall score combines the written and the demo part by the RFP's two weights.
 * Averages are kept exact and rounded once, at the end, to two decimals; candidates are
 * ranked on that rounded overall score, so two candidates showing the same figure share a place.
 */
export function rfpResults(
  rfp: { writtenWeight: number; demoWeight: number },
  criteria: { id: string; part: Part; weight: number }[],
  candidateIds: string[],
  scores: ScoreInput[],
): CandidateResult[] {
  const out = candidateIds.map((candidateId): CandidateResult => {
    const averages = new Map<string, Fraction>();
    const perCriterion = criteria.map((c) => {
      const mine = scores.filter((s) => s.candidateId === candidateId && s.criterionId === c.id);
      if (!mine.length) return { criterionId: c.id, averageHundredths: null, scores: 0 };
      const average = frac(
        mine.reduce((n, s) => n + s.score, 0),
        mine.length,
      );
      averages.set(c.id, average);
      return { criterionId: c.id, averageHundredths: hundredths(average), scores: mine.length };
    });
    const part = (p: Part): { exact: Fraction | null; view: PartResult } => {
      const mine = criteria.filter((c) => c.part === p);
      const scored = mine.filter((c) => averages.has(c.id));
      const total = mine.reduce((n, c) => n + c.weight, 0);
      if (!mine.length || scored.length < mine.length || total === 0) return { exact: null, view: { hundredths: null, scored: scored.length, criteria: mine.length } };
      const exact = mine.reduce<Fraction>((sum, c) => add(sum, times(averages.get(c.id)!, c.weight, total)), frac(0, 1));
      return { exact, view: { hundredths: hundredths(exact), scored: scored.length, criteria: mine.length } };
    };
    const written = part("written");
    const demo = part("demo");
    // A part that counts for nothing is left out; a part that counts must be complete.
    let overall: Fraction | null = null;
    if (rfp.demoWeight === 0) overall = written.exact;
    else if (rfp.writtenWeight === 0) overall = demo.exact;
    else if (written.exact && demo.exact) overall = add(times(written.exact, rfp.writtenWeight, 100), times(demo.exact, rfp.demoWeight, 100));
    return { candidateId, criteria: perCriterion, written: written.view, demo: demo.view, overallHundredths: overall ? hundredths(overall) : null, rank: null };
  });
  for (const r of out) if (r.overallHundredths != null) r.rank = 1 + out.filter((o) => o.overallHundredths != null && o.overallHundredths > r.overallHundredths!).length;
  return out;
}

// ---------- Decision (Q-9)

export const decisionSchema = z.object({
  winnerCandidateId: z.string().uuid("Choose the winner."),
  decidedOn: day,
  rationale: requiredText(4000, "Give the reasons for the decision."),
});
export const cancelSchema = z.object({ reason: requiredText(1000, "Say why the RFP is cancelled.") });
export const stageMoveSchema = z.object({ to: z.enum(["drafting", "in_review", "approved"]) });

// ---------- What the app hands to the screens

export interface RfpRow {
  id: string;
  title: string;
  stage: RfpStage;
  ownerUserId: string;
  ownerName: string;
  targetDecisionDate: Day | null;
  candidates: number;
  winnerName: string | null;
  updatedAt: string;
}
export interface RfpSection {
  id: string;
  heading: string;
  body: string | null;
}
export interface RfpCriterion {
  id: string;
  name: string;
  weight: number;
  part: Part;
}
export interface RfpQuestion {
  id: string;
  number: number;
  text: string;
  criterionId: string;
}
export interface Signoff {
  id: string;
  reviewerName: string;
  reviewerRole: string | null;
  outcome: SignoffOutcome;
  onDate: Day;
  comment: string | null;
  resolvedOn: Day | null;
  /** The document was changed after this sign-off, so it speaks for an earlier version and no longer counts. */
  superseded: boolean;
  createdBy: string | null;
}
export interface RfpDocument {
  id: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
  createdBy: string | null;
}
export interface Candidate {
  id: string;
  vendorId: string;
  vendorName: string;
  vendorStatus: VendorStatus;
  vendorType: VendorType;
  /** Whether an NDA is in place today (Q-5). */
  nda: Paperwork;
  list: CandidateList;
  reason: string;
  issuedOn: Day | null;
  ndaWarningAcknowledgedBy: string | null;
  responseReceivedOn: Day | null;
  unmatched: SheetRow[];
  answered: number;
  documents: RfpDocument[];
}
export interface RfpAnswer {
  candidateId: string;
  questionId: string;
  text: string;
}
export interface RfpScore {
  candidateId: string;
  criterionId: string;
  evaluatorUserId: string;
  evaluatorName: string;
  score: number;
  comment: string | null;
  suggestedScore: number | null;
}
export interface RfpDetail extends Omit<RfpDemand, "ownerUserId"> {
  id: string;
  stage: RfpStage;
  ownerUserId: string;
  ownerName: string;
  createdAt: string;
  createdBy: string | null;
  sections: RfpSection[];
  criteria: RfpCriterion[];
  questions: RfpQuestion[];
  signoffs: Signoff[];
  candidates: Candidate[];
  answers: RfpAnswer[];
  scores: RfpScore[];
  /** Worked out for the candidates that can be scored: shortlisted and issued. */
  results: CandidateResult[];
  draft: TextSuggestion<RfpDraft> | null;
  comparison: TextSuggestion<RfpComparison> | null;
  /** An answer was added or changed after the AI compared them. */
  comparisonOutdated: boolean;
  decision: { winnerCandidateId: string; winnerName: string; decidedOn: Day; rationale: string } | null;
  cancelReason: string | null;
}

/** A candidate the RFP has gone out to and that is still in the running: these are the ones answers and scores are about. */
export const inEvaluation = (c: Pick<Candidate, "list" | "issuedOn">) => c.list === "shortlist" && !!c.issuedOn;
export const ndaInPlace = (c: Pick<Candidate, "nda">) => c.nda === "in_place" || c.nda === "not_required";
export const openChangeRequests = (signoffs: Pick<Signoff, "outcome" | "resolvedOn" | "superseded">[]) =>
  signoffs.filter((s) => s.outcome === "changes_requested" && !s.resolvedOn && !s.superseded);
/** Q-3: approved needs at least one approval of the document as it stands and no change request still open. Returns why not, or null. */
export function approvalBlocker(signoffs: Pick<Signoff, "outcome" | "resolvedOn" | "superseded">[]): string | null {
  const open = openChangeRequests(signoffs).length;
  if (open) return `${open === 1 ? "A requested change is" : `${open} requested changes are`} still open. Mark ${open === 1 ? "it" : "them"} as dealt with first.`;
  if (!signoffs.some((s) => s.outcome === "approved" && !s.superseded))
    return signoffs.some((s) => s.outcome === "approved")
      ? "The document was changed after it was approved, so the earlier approval no longer counts. Record an approval of the document as it is now."
      : "No reviewer has approved the RFP yet. Record at least one approval first.";
  return null;
}

export type RfpTab = "overview" | "document" | "review" | "candidates" | "responses" | "scoring" | "decision";
export interface NextStep {
  title: string;
  text: string;
  /** Where on the RFP's page the step is done. */
  tab: RfpTab;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Q-11: what has to happen next on an RFP, in one sentence, and where. */
export function nextStep(r: RfpDetail, meId?: string): NextStep {
  const running = r.candidates.filter(inEvaluation);
  const shortlist = r.candidates.filter((c) => c.list === "shortlist");
  switch (r.stage) {
    case "drafting": {
      if (!r.sections.length && !r.questions.length)
        return {
          title: "Write the RFP",
          text: "Ask the AI for a first draft from the need, or start from the empty template. Everything can be changed afterwards.",
          tab: "document",
        };
      const blockers = reviewBlockers(r);
      return blockers.length
        ? { title: "Finish the draft", text: blockers.join(" "), tab: "document" }
        : { title: "Send it for review", text: "The draft has sections, weighted criteria and a question list. When it reads well, send it for review.", tab: "document" };
    }
    case "in_review": {
      const blocker = approvalBlocker(r.signoffs);
      return blocker
        ? { title: "Collect the sign-offs", text: `Send the Word or PDF export to the reviewers and record what each of them decided. ${blocker}`, tab: "review" }
        : { title: "Mark it as approved", text: "At least one reviewer approved and no requested change is open.", tab: "review" };
    }
    case "approved": {
      if (!shortlist.length) return { title: "Shortlist the candidates", text: "Put the vendors to invite on the shortlist, each with the reason.", tab: "candidates" };
      return {
        title: "Issue the RFP",
        text: `${count(shortlist.length, "candidate is", "candidates are")} on the shortlist. Download each one's RFP and answer sheet, send them, and record the day of issue.`,
        tab: "candidates",
      };
    }
    case "issued":
    case "evaluating": {
      const waiting = running.filter((c) => !c.responseReceivedOn);
      const toIssue = shortlist.filter((c) => !c.issuedOn);
      const cells = running.length * r.criteria.length;
      const mine = meId ? r.scores.filter((s) => s.evaluatorUserId === meId && running.some((c) => c.id === s.candidateId)).length : 0;
      // Once every candidate has an overall score and the reader has given all of theirs, the decision is next, whatever is still missing on paper.
      if (running.length && r.results.every((x) => x.overallHundredths != null) && (!meId || mine === cells))
        return { title: "Record the decision", text: "Every candidate has an overall score. Record the winner and the reasons.", tab: "decision" };
      if (r.stage === "issued" || (waiting.length && waiting.length === running.length))
        return {
          title: "Upload the answers",
          text: `${running.length - waiting.length} of ${count(running.length, "response")} received.${toIssue.length ? ` ${count(toIssue.length, "shortlisted candidate has", "shortlisted candidates have")} not been issued the RFP yet.` : ""} Upload each filled answer sheet as it comes back.`,
          tab: "responses",
        };
      return {
        title: "Score the candidates",
        text: `${waiting.length ? `${count(waiting.length, "response is", "responses are")} still to come. ` : ""}${meId ? `You have given ${mine} of ${cells} scores. ` : ""}Each team member scores each candidate on every criterion.`,
        tab: "scoring",
      };
    }
    case "decided":
      return { title: "Decided", text: `${r.decision?.winnerName ?? "The winner"} was chosen. The decision record holds the whole trail as one PDF.`, tab: "decision" };
    case "cancelled":
      return { title: "Cancelled", text: r.cancelReason ?? "This RFP was cancelled.", tab: "overview" };
  }
}

export type { Currency };
