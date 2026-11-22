import ExcelJS from "exceljs";
import { formatDay, type Day } from "../../../shared/dates";
import {
  candidateListLabels,
  formatHundredths,
  inEvaluation,
  partLabels,
  parts,
  rfpStageLabels,
  signoffLabels,
  type Candidate,
  type Part,
  type RfpDetail,
  type SheetRow,
} from "../../../shared/rfp";
import { vendorStatusLabels } from "../../../shared/vendors";
import { AppError } from "../../platform/errors";
import { makePdf } from "../../platform/pdf";
import { cellText, loadWorkbook } from "../import/service";
import { parseBlocks } from "../../../shared/richtext";
import { budgetWords } from "./service";
import { BodyWriter } from "./word/body";
import { openTemplate } from "./word/template";

const partWeight = (r: Pick<RfpDetail, "writtenWeight" | "demoWeight">, p: Part) => (p === "written" ? r.writtenWeight : r.demoWeight);
const paragraphs = (text: string | null) =>
  (text ?? "")
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean);
const day = (d: Day | null) => (d ? formatDay(d) : "Not set");

/** The lines of the demand, for the copies that stay inside the company. */
const demandFacts = (r: WordContent): [string, string][] => [
  ["Sponsor", r.sponsor ?? "Not set"],
  ["Budget", budgetWords(r)],
  ["Demand approved on", day(r.demandApprovedOn)],
  ["Decision wanted by", day(r.targetDecisionDate)],
  ["Owner", r.ownerName],
];

/** What a Word copy of an RFP is made from: the RFP as it stands, or as it stood when a review round was made (Q-13). */
export type WordContent = Pick<
  RfpDetail,
  | "title"
  | "need"
  | "budgetMinor"
  | "currency"
  | "sponsor"
  | "demandApprovedOn"
  | "targetDecisionDate"
  | "ownerName"
  | "writtenWeight"
  | "demoWeight"
  | "sections"
  | "criteria"
  | "questions"
>;

/** The names of the custom properties that say which RFP and version a review copy is (Q-13). */
export const REVIEW_PROPS = { rfp: "Vendor Management RFP", version: "Vendor Management review version" } as const;

/**
 * The RFP as a Word document (Q-3, Q-5, Q-14), made from the template in force. Without a
 * candidate it is the review copy for one review round, with the demand after the cover
 * page and the RFP and version written into the file, so a returned copy can be recognised.
 * For a candidate it is the document that goes out: the sections, the criteria with their
 * weights and the questions, and nothing internal.
 */
export async function rfpWord(
  r: WordContent,
  o: { template: Buffer; today: Day; version: number | null; candidate?: Pick<Candidate, "vendorName">; review?: { rfpId: string } },
): Promise<Buffer> {
  const t = await openTemplate(o.template);
  const w = new BodyWriter(t.styles);
  const muted = (text: string) => ({ text, color: "555D70" });
  if (!o.candidate) {
    w.paragraph([muted(`Review copy${o.version ? `, version ${o.version}` : ""}. For internal use: the demand below is not sent to vendors.`)], { after: 240 });
    w.heading(1, [{ text: "The demand (internal, not sent to vendors)" }]);
    for (const line of paragraphs(r.need)) w.paragraph([{ text: line }]);
    for (const [label, value] of demandFacts(r)) w.paragraph([{ text: `${label}: `, bold: true }, { text: value }], { after: 40 });
  } else w.paragraph([muted(`Request for proposal for ${o.candidate.vendorName}`)], { after: 240 });
  for (const s of r.sections) {
    w.heading(1, [{ text: s.heading }]);
    const blocks = parseBlocks(s.body);
    if (blocks.length) w.blocks(blocks);
    else w.paragraph([{ text: "[Still to be written]", italic: true }]);
  }
  w.heading(1, [{ text: "Evaluation criteria" }]);
  for (const part of parts) {
    const mine = r.criteria.filter((c) => c.part === part);
    if (!mine.length) continue;
    w.paragraph([{ text: `${partLabels[part]} · ${partWeight(r, part)}% of the overall score`, bold: true }], { keepNext: true });
    w.table([[[{ text: "Criterion" }], [{ text: "Weight" }]], ...mine.map((c) => [[{ text: c.name }], [{ text: `${c.weight}%` }]])], { widths: [0.75, 0.25], alignRight: [1] });
  }
  w.heading(1, [{ text: "Questions" }]);
  if (o.candidate) w.paragraph([{ text: "Please answer every question in the answer sheet (Excel) that comes with this document, in the Answer column, and return the sheet." }]);
  for (const c of r.criteria.filter((x) => x.part === "written")) {
    const mine = r.questions.filter((q) => q.criterionId === c.id);
    if (!mine.length) continue;
    w.heading(2, [{ text: c.name }]);
    for (const q of mine) w.paragraph([{ text: `${q.number}. `, bold: true }, { text: q.text }], { after: 100 });
  }
  return t.finish(w, {
    title: r.title,
    marks: { title: r.title, date: formatDay(o.today), version: o.version ? `Version ${o.version}` : "" },
    properties: o.review ? { [REVIEW_PROPS.rfp]: o.review.rfpId, [REVIEW_PROPS.version]: String(o.version ?? "") } : undefined,
  });
}

const HEADERS = ["No.", "Criterion", "Question", "Answer"] as const;

/** Q-5: the question list as an Excel sheet for one candidate to fill in and send back. */
export async function answerSheet(r: RfpDetail, candidate: Candidate): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Answers");
  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([`Answer sheet for ${candidate.vendorName}`]);
  ws.addRow(["Type your answer to each question in the Answer column and send this file back. Please do not change the numbers or the questions."]).font = {
    italic: true,
    color: { argb: "FF555D70" },
  };
  ws.addRow([]);
  ws.addRow([...HEADERS]).font = { bold: true };
  const names = new Map(r.criteria.map((c) => [c.id, c.name]));
  for (const q of r.questions) ws.addRow([q.number, names.get(q.criterionId) ?? "", q.text, ""]);
  [8, 28, 70, 80].forEach((width, i) => (ws.getColumn(i + 1).width = width));
  ws.eachRow((row, n) => {
    if (n > 5) row.alignment = { wrapText: true, vertical: "top" };
  });
  ws.views = [{ state: "frozen", ySplit: 5 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Reads a filled answer sheet (Q-6): finds the header row, wherever the vendor left it,
 * and returns every row under it that has a number, a question or an answer.
 */
export async function readAnswerSheet(data: Buffer): Promise<SheetRow[]> {
  const wb = await loadWorkbook(data, {
    tooLarge: "That workbook is too large to be an answer sheet. Upload the sheet the candidate filled in; other material can be attached as a document.",
    unreadable: "That file could not be read as an Excel workbook. Upload the answer sheet the candidate filled in, as .xlsx.",
  });
  const notASheet = () =>
    new AppError(
      400,
      "not_an_answer_sheet",
      'That workbook is not the answer sheet: no row with the headings "No." and "Answer" was found. Upload the sheet the candidate filled in, or type the answers in below.',
    );
  const ws = wb.getWorksheet("Answers") ?? wb.worksheets[0];
  if (!ws) throw notASheet();
  const cells = (n: number) => Array.from(ws.getRow(n).values as unknown[], cellText);
  let header = 0;
  let at = { number: -1, question: -1, answer: -1 };
  for (let n = 1; n <= Math.min(ws.rowCount, 50) && !header; n++) {
    const row = cells(n).map((c) => c.toLowerCase().replace(/[.:]/g, "").trim());
    const answer = row.findIndex((c) => c === "answer" || c === "answers");
    const number = row.findIndex((c) => ["no", "nr", "number", "#"].includes(c));
    if (answer >= 0 && number >= 0) {
      header = n;
      at = { number, answer, question: row.findIndex((c) => c === "question" || c === "questions") };
    }
  }
  if (!header) throw notASheet();
  const out: SheetRow[] = [];
  for (let n = header + 1; n <= ws.rowCount; n++) {
    const row = cells(n);
    const r = { row: n, number: row[at.number] ?? "", question: at.question >= 0 ? (row[at.question] ?? "") : "", answer: row[at.answer] ?? "" };
    if (r.number || r.question || r.answer) out.push(r);
  }
  return out;
}

const people = (r: RfpDetail) => [...new Map(r.scores.map((s) => [s.evaluatorUserId, s.evaluatorName])).entries()];

/**
 * Q-10: the whole trail of an RFP as one PDF: the demand, the sign-offs, the candidates
 * with the reason for each, the scores per evaluator with what they add up to, and the decision.
 */
export function decisionRecordPdf(r: RfpDetail, today: Day): Promise<Buffer> {
  const name = new Map(r.candidates.map((c) => [c.id, c.vendorName]));
  const running = r.candidates.filter(inEvaluation);
  return makePdf({ title: `${r.title} decision record`, footer: `${r.title} · Decision record · made ${formatDay(today)} · internal` }, (pdf) => {
    pdf.title(`RFP decision record · ${rfpStageLabels[r.stage]} · made ${formatDay(today)} · for internal use`, r.title);

    pdf.heading("Decision");
    if (r.decision) {
      pdf.facts([
        ["Winner", r.decision.winnerName],
        ["Decided on", formatDay(r.decision.decidedOn)],
      ]);
      pdf.paragraph("Reasons", { bold: true });
      for (const line of paragraphs(r.decision.rationale)) pdf.paragraph(line);
    } else if (r.stage === "cancelled") pdf.paragraph(`This RFP was cancelled. ${r.cancelReason ?? ""}`.trim());
    else pdf.paragraph("No decision has been recorded yet. This is the trail so far.", { muted: true });

    pdf.heading("Demand");
    for (const line of paragraphs(r.need)) pdf.paragraph(line);
    pdf.facts(demandFacts(r));

    pdf.heading("Review and sign-offs");
    if (r.signoffs.length)
      pdf.table(
        [
          { header: "Reviewer", width: 0.28 },
          { header: "Outcome", width: 0.2 },
          { header: "Date", width: 0.14 },
          { header: "Comment", width: 0.38 },
        ],
        r.signoffs.map((s) => [
          `${s.reviewerName}${s.reviewerRole ? `, ${s.reviewerRole}` : ""}`,
          s.superseded && s.outcome === "approved" ? "Approved an earlier version" : signoffLabels[s.outcome],
          formatDay(s.onDate),
          [s.comment, s.outcome === "changes_requested" ? (s.resolvedOn ? `Dealt with on ${formatDay(s.resolvedOn)}.` : "Still open.") : null].filter(Boolean).join(" ") || "–",
        ]),
      );
    else pdf.paragraph("No sign-off was recorded.", { muted: true });

    pdf.heading("Candidates");
    if (r.candidates.length)
      pdf.table(
        [
          { header: "Candidate", width: 0.24 },
          { header: "List", width: 0.12 },
          { header: "Reason", width: 0.34 },
          { header: "Issued", width: 0.15 },
          { header: "Response", width: 0.15 },
        ],
        r.candidates.map((c) => [
          `${c.vendorName} (${vendorStatusLabels[c.vendorStatus].toLowerCase()})`,
          candidateListLabels[c.list],
          c.reason,
          c.issuedOn ? `${formatDay(c.issuedOn)}${c.ndaWarningAcknowledgedBy ? " (without an NDA in place)" : ""}` : "–",
          c.responseReceivedOn ? formatDay(c.responseReceivedOn) : "–",
        ]),
      );
    else pdf.paragraph("No candidate was recorded.", { muted: true });
    for (const c of r.candidates.filter((x) => x.ndaWarningAcknowledgedBy))
      pdf.paragraph(`${c.vendorName} was issued the RFP without an NDA in place; the warning was acknowledged by ${c.ndaWarningAcknowledgedBy}.`, { muted: true });

    pdf.heading("Scores");
    pdf.paragraph(
      `Each criterion is scored from 1 to 5 by each evaluator; a candidate's score on a criterion is the average. Written answers count for ${r.writtenWeight}% and demo and interview for ${r.demoWeight}% of the overall score.`,
      { muted: true },
    );
    if (running.length && r.results.length) {
      const ranked = [...r.results].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (name.get(a.candidateId) ?? "").localeCompare(name.get(b.candidateId) ?? ""));
      pdf.table(
        [
          { header: "Rank", width: 0.1 },
          { header: "Candidate", width: 0.36 },
          { header: "Written", width: 0.18, align: "right" },
          { header: "Demo", width: 0.18, align: "right" },
          { header: "Overall", width: 0.18, align: "right" },
        ],
        ranked.map((x) => [
          x.rank == null ? "–" : String(x.rank),
          name.get(x.candidateId) ?? "",
          formatHundredths(x.written.hundredths),
          formatHundredths(x.demo.hundredths),
          formatHundredths(x.overallHundredths),
        ]),
      );
      const evaluators = people(r);
      for (const c of running) {
        const result = r.results.find((x) => x.candidateId === c.id);
        pdf.paragraph(c.vendorName, { bold: true });
        const share = 0.46 / Math.max(evaluators.length, 1);
        pdf.table(
          [
            { header: "Criterion", width: 0.3 },
            { header: "Weight", width: 0.12, align: "right" },
            ...evaluators.map(([, n]) => ({ header: n, width: share, align: "right" as const })),
            { header: "Average", width: 0.12, align: "right" },
          ],
          r.criteria.map((k) => [
            `${k.name} (${k.part === "written" ? "written" : "demo"})`,
            `${k.weight}%`,
            ...evaluators.map(([id]) => {
              const s = r.scores.find((x) => x.candidateId === c.id && x.criterionId === k.id && x.evaluatorUserId === id);
              return s ? String(s.score) : "–";
            }),
            formatHundredths(result?.criteria.find((x) => x.criterionId === k.id)?.averageHundredths),
          ]),
        );
        for (const s of r.scores.filter((x) => x.candidateId === c.id && x.comment))
          pdf.paragraph(`${s.evaluatorName} on ${r.criteria.find((k) => k.id === s.criterionId)?.name ?? "a criterion"}: ${s.comment}`, { muted: true });
      }
    } else pdf.paragraph("No candidate was scored.", { muted: true });
  });
}
