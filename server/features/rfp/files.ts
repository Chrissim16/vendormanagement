import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
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
import { makePdf, type Pdf } from "../../platform/pdf";
import { cellText, loadWorkbook } from "../import/service";
import { budgetWords } from "./service";

const partWeight = (r: RfpDetail, p: Part) => (p === "written" ? r.writtenWeight : r.demoWeight);
const paragraphs = (text: string | null) =>
  (text ?? "")
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean);
const day = (d: Day | null) => (d ? formatDay(d) : "Not set");

/** The lines of the demand, for the copies that stay inside the company. */
const demandFacts = (r: RfpDetail): [string, string][] => [
  ["Sponsor", r.sponsor ?? "Not set"],
  ["Budget", budgetWords(r)],
  ["Demand approved on", day(r.demandApprovedOn)],
  ["Decision wanted by", day(r.targetDecisionDate)],
  ["Owner", r.ownerName],
];

/**
 * The RFP as a Word document (Q-3, Q-5). Without a candidate it is the copy for the
 * reviewers, with the demand at the top. For a candidate it is the document that goes
 * out: the sections, the criteria with their weights and the questions, and nothing internal.
 */
export async function rfpWord(r: RfpDetail, o: { candidate?: Candidate; today: Day }): Promise<Buffer> {
  const text = (t: string, opts: { bold?: boolean; italics?: boolean; color?: string } = {}) => new TextRun({ text: t, ...opts });
  const p = (t: string) => new Paragraph({ children: [text(t)], spacing: { after: 140 } });
  const cell = (t: string, width: number, bold = false, right = false) =>
    new TableCell({
      width: { size: width, type: WidthType.PERCENTAGE },
      children: [new Paragraph({ children: [text(t, { bold })], alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT })],
    });
  const body: (Paragraph | Table)[] = [
    new Paragraph({ text: r.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        text(
          o.candidate
            ? `Request for proposal · for ${o.candidate.vendorName}`
            : `Request for proposal · review copy of ${formatDay(o.today)} · ${rfpStageLabels[r.stage]} · internal`,
          { color: "555D70" },
        ),
      ],
      spacing: { after: 300 },
    }),
  ];
  if (!o.candidate) {
    body.push(new Paragraph({ text: "The demand (internal, not sent to vendors)", heading: HeadingLevel.HEADING_1 }));
    for (const line of paragraphs(r.need)) body.push(p(line));
    for (const [label, value] of demandFacts(r)) body.push(new Paragraph({ children: [text(`${label}: `, { bold: true }), text(value)] }));
  }
  for (const s of r.sections) {
    body.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }));
    const lines = paragraphs(s.body);
    if (lines.length) for (const line of lines) body.push(p(line));
    else body.push(new Paragraph({ children: [text("[Still to be written]", { italics: true })] }));
  }
  body.push(new Paragraph({ text: "Evaluation criteria", heading: HeadingLevel.HEADING_1 }));
  for (const part of parts) {
    const mine = r.criteria.filter((c) => c.part === part);
    if (!mine.length) continue;
    body.push(new Paragraph({ children: [text(`${partLabels[part]} · ${partWeight(r, part)}% of the overall score`, { bold: true })], spacing: { before: 200, after: 100 } }));
    body.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: [cell("Criterion", 75, true), cell("Weight", 25, true, true)] }),
          ...mine.map((c) => new TableRow({ children: [cell(c.name, 75), cell(`${c.weight}%`, 25, false, true)] })),
        ],
      }),
    );
  }
  body.push(new Paragraph({ text: "Questions", heading: HeadingLevel.HEADING_1 }));
  if (o.candidate) body.push(p("Please answer every question in the answer sheet (Excel) that comes with this document, in the Answer column, and return the sheet."));
  for (const c of r.criteria.filter((x) => x.part === "written")) {
    const mine = r.questions.filter((q) => q.criterionId === c.id);
    if (!mine.length) continue;
    body.push(new Paragraph({ text: c.name, heading: HeadingLevel.HEADING_2 }));
    for (const q of mine) body.push(new Paragraph({ children: [text(`${q.number}. `, { bold: true }), text(q.text)], spacing: { after: 100 } }));
  }
  const doc = new Document({
    creator: "Vendor Management",
    title: r.title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children: body }],
  });
  return Packer.toBuffer(doc);
}

function drawDocument(pdf: Pdf, r: RfpDetail) {
  for (const s of r.sections) {
    pdf.heading(s.heading);
    const lines = paragraphs(s.body);
    if (lines.length) for (const line of lines) pdf.paragraph(line);
    else pdf.paragraph("[Still to be written]", { muted: true });
  }
  pdf.heading("Evaluation criteria");
  for (const part of parts) {
    const mine = r.criteria.filter((c) => c.part === part);
    if (!mine.length) continue;
    pdf.paragraph(`${partLabels[part]} · ${partWeight(r, part)}% of the overall score`, { bold: true });
    pdf.table(
      [
        { header: "Criterion", width: 0.8 },
        { header: "Weight", width: 0.2, align: "right" },
      ],
      mine.map((c) => [c.name, `${c.weight}%`]),
    );
  }
  if (!r.criteria.length) pdf.paragraph("No criteria yet.", { muted: true });
  pdf.heading("Questions");
  if (!r.questions.length) pdf.paragraph("No questions yet.", { muted: true });
  for (const c of r.criteria.filter((x) => x.part === "written")) {
    const mine = r.questions.filter((q) => q.criterionId === c.id);
    if (!mine.length) continue;
    pdf.paragraph(c.name, { bold: true });
    for (const q of mine) pdf.paragraph(`${q.number}.  ${q.text}`);
  }
}

/** The review copy as a PDF (Q-3): the demand, then the document as it stands. */
export function rfpPdf(r: RfpDetail, today: Day): Promise<Buffer> {
  return makePdf({ title: r.title, footer: `${r.title} · RFP review copy of ${formatDay(today)} · internal` }, (pdf) => {
    pdf.title(`Request for proposal · review copy of ${formatDay(today)} · ${rfpStageLabels[r.stage]} · internal`, r.title);
    pdf.heading("The demand (internal, not sent to vendors)");
    for (const line of paragraphs(r.need)) pdf.paragraph(line);
    pdf.facts(demandFacts(r));
    drawDocument(pdf, r);
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
          signoffLabels[s.outcome],
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
