import { formatDay } from "../../../shared/dates";
import { formatMetric, formatTarget, metricInfo, metricKeys, monthName } from "../../../shared/performance";
import { formatScore, quarterName, type ScorecardDetail } from "../../../shared/scorecards";
import { makePdf } from "../../platform/pdf";

/**
 * The scorecard as the vendor receives it (P-6): scores, the comments written for the
 * vendor, and the measured figures. Internal notes, the supporting facts about budgets
 * and paperwork, and anything about the AI are left out: they are for the team only.
 */
export function scorecardPdf(card: ScorecardDetail, finalisedOn: string): Promise<Buffer> {
  const title = `${card.vendorName} scorecard ${quarterName(card.quarter)}`;
  return makePdf({ title, footer: `${card.vendorName} · Scorecard ${quarterName(card.quarter)} · finalised ${finalisedOn}` }, (pdf) => {
    pdf.title(`Vendor scorecard · ${quarterName(card.quarter)} · ${formatDay(card.periodStart)} to ${formatDay(card.periodEnd)}`, card.vendorName);
    pdf.facts([
      ["Overall score", `${formatScore(card.overallTenths)} out of 5`],
      // A reviewer known only by a work email address is not named on a document that leaves the company.
      ...(card.reviewerName.includes("@") ? [] : ([["Reviewed by", card.reviewerName]] as [string, string][])),
      ["Finalised", finalisedOn],
    ]);
    if (card.summary) {
      pdf.heading("Summary");
      pdf.paragraph(card.summary);
    }
    pdf.heading("Scores");
    const weights = card.lines.reduce((n, l) => n + l.weight, 0);
    pdf.table(
      [
        { header: "Criterion", width: 0.3 },
        { header: "Score", width: 0.1, align: "right" },
        { header: "Weight", width: 0.12, align: "right" },
        { header: "Comment", width: 0.48 },
      ],
      card.lines.map((l) => [l.name, `${l.score ?? "–"} / 5`, `${Math.round((l.weight * 100) / weights)}%`, l.vendorComment ?? ""]),
    );
    pdf.paragraph("Scores run from 1 (poor) to 5 (excellent). The overall score is the average of the scores, weighted as shown.", { muted: true });
    if (card.helpdesk?.length) {
      pdf.heading("Helpdesk figures");
      pdf.table(
        [
          { header: "Measure", width: 0.28 },
          ...card.helpdesk.map((m) => ({ header: monthName(m.month), width: 0.48 / card.helpdesk!.length, align: "right" as const })),
          { header: "Target", width: 0.24, align: "right" },
        ],
        metricKeys.map((k) => {
          const target = card.helpdesk![0]!.cells[k].targetTenths;
          return [
            `${metricInfo[k].label}: ${metricInfo[k].measures}`,
            ...card.helpdesk!.map((m) => `${formatMetric(k, m.cells[k].valueTenths)}${m.cells[k].verdict === "missed" ? " (missed)" : ""}`),
            target == null ? "none" : formatTarget(k, target),
          ];
        }),
      );
      pdf.paragraph("Figures are worked out from the helpdesk tickets in Jira. A dash means there was nothing to measure in that month.", { muted: true });
    }
  });
}
