import { kindShort } from "../../../shared/agreements";
import { formatDay } from "../../../shared/dates";
import { formatMoney } from "../../../shared/money";
import { REPORT_ENDING_DAYS, trendWords, type ManagementReport } from "../../../shared/overview";
import { formatMetric, formatTarget, metricInfo, monthName } from "../../../shared/performance";
import { formatScore, quarterName } from "../../../shared/scorecards";
import { formatRate } from "../../../shared/sow";
import { makePdf } from "../../platform/pdf";

/** The most rows each table of the report takes to begin with. */
export const REPORT_ROWS = { sows: 10, ending: 8, scores: 10, missed: 8, rfps: 5 };
type Rows = typeof REPORT_ROWS;
/** The report is one to two pages (D-2). */
const MAX_PAGES = 2;

const more = (shown: number, all: number, what: string) => (all > shown ? `And ${all - shown} more ${what}, listed in the app.` : null);

/**
 * The monthly management report (D-2): one to two pages for the IT management team.
 * Every figure is worked out by the app; the summary is the text a person saved.
 */
export async function reportPdf(report: ManagementReport, generatedOn: string): Promise<Buffer> {
  // When there is more than fits on two pages, the tables are cut shorter (each says how much it leaves out) until it does.
  for (const share of [1, 0.7, 0.5, 0.3]) {
    const rows = Object.fromEntries(Object.entries(REPORT_ROWS).map(([k, n]) => [k, Math.max(2, Math.round(n * share))])) as Rows;
    let pages = 0;
    const file = await draw(report, generatedOn, rows, (n) => (pages = n));
    if (pages <= MAX_PAGES) return file;
  }
  return draw(report, generatedOn, { sows: 1, ending: 1, scores: 1, missed: 1, rfps: 1 }, () => {});
}

function draw(report: ManagementReport, generatedOn: string, rows: Rows, pages: (count: number) => void): Promise<Buffer> {
  const d = report.data;
  const title = `Vendor management report ${monthName(d.month)}`;
  return makePdf({ title, footer: `${title} · figures as at ${formatDay(d.asAt)} · made ${generatedOn}` }, (pdf) => {
    pdf.title(`Monthly management report · figures as at ${formatDay(d.asAt)}${d.running ? " (month still running)" : ""}`, `Vendors, ${monthName(d.month)}`);
    if (report.summary) pdf.paragraph(report.summary);

    pdf.heading("Spend against budgets");
    const t = d.spend.total;
    pdf.paragraph(
      t.eurMinor === 0
        ? `Nothing was invoiced in ${monthName(d.month)}.`
        : `Invoiced in ${monthName(d.month)}: ${formatMoney(t.eurMinor, "EUR")}` +
            (t.GBP > 0 ? ` in euros (${formatMoney(t.EUR, "EUR")} plus ${formatMoney(t.GBP, "GBP")} converted at ${formatRate(d.spend.gbpToEurE4)}).` : "."),
    );
    if (d.sows.length) {
      pdf.table(
        [
          { header: "Vendor and SOW", width: 0.4 },
          { header: "Budget", width: 0.19, align: "right" },
          { header: "Invoiced", width: 0.19, align: "right" },
          { header: "Used", width: 0.22, align: "right" },
        ],
        d.sows
          .slice(0, rows.sows)
          .map((s) => [
            `${s.vendorName} · ${s.title}`,
            formatMoney(s.budget.budgetMinor ?? 0, s.currency),
            formatMoney(s.budget.invoicedMinor, s.currency),
            `${s.budget.usedPct ?? "–"}%${s.budget.state === "over" ? " (over budget)" : s.budget.state === "warn" ? " (close)" : ""}`,
          ]),
      );
      const rest = more(rows.sows, d.sows.length, "SOWs");
      if (rest) pdf.paragraph(rest, { muted: true });
    } else pdf.paragraph("No SOW with a budget ran in this month.", { muted: true });

    pdf.heading(`Agreements ending within ${REPORT_ENDING_DAYS} days`);
    if (d.ending.length) {
      pdf.table(
        [
          { header: "Vendor and agreement", width: 0.5 },
          { header: "Ends", width: 0.25 },
          { header: "Notice by", width: 0.25 },
        ],
        d.ending.slice(0, rows.ending).map((e) => [`${e.vendorName} · ${kindShort[e.kind]} ${e.title}`, formatDay(e.endDate), e.noticeDeadline ? formatDay(e.noticeDeadline) : "–"]),
      );
      const rest = more(rows.ending, d.ending.length, "agreements");
      if (rest) pdf.paragraph(rest, { muted: true });
    } else pdf.paragraph(`No agreement ends between ${formatDay(d.asAt)} and ${REPORT_ENDING_DAYS} days later.`, { muted: true });

    pdf.heading("Vendor scores");
    if (d.scores.length) {
      pdf.table(
        [
          { header: "Vendor", width: 0.4 },
          { header: "Quarter", width: 0.2 },
          { header: "Score", width: 0.15, align: "right" },
          { header: "Trend", width: 0.25, align: "right" },
        ],
        d.scores
          .slice(0, rows.scores)
          .map((s) => [
            s.vendorName,
            quarterName(s.quarter),
            `${formatScore(s.overallTenths)} / 5`,
            s.previousTenths == null ? trendWords[s.trend] : `${trendWords[s.trend]}${s.trend === "same" ? "" : ` from ${formatScore(s.previousTenths)}`}`,
          ]),
      );
      const rest = more(rows.scores, d.scores.length, "vendors");
      if (rest) pdf.paragraph(rest, { muted: true });
    } else pdf.paragraph("No scorecard had been finalised by this date.", { muted: true });

    pdf.heading("Missed helpdesk targets");
    if (d.missed.length) {
      pdf.table(
        [
          { header: "Vendor", width: 0.34 },
          { header: "Measure", width: 0.26 },
          { header: monthName(d.month), width: 0.16, align: "right" },
          { header: "Target", width: 0.24, align: "right" },
        ],
        d.missed.slice(0, rows.missed).map((m) => [m.vendorName, metricInfo[m.metric].label, formatMetric(m.metric, m.valueTenths), formatTarget(m.metric, m.targetTenths)]),
      );
      const rest = more(rows.missed, d.missed.length, "missed targets");
      if (rest) pdf.paragraph(rest, { muted: true });
    } else
      pdf.paragraph(d.measuredVendors ? `Every target was met by the ${d.measuredVendors === 1 ? "helpdesk vendor" : `${d.measuredVendors} helpdesk vendors`} measured.` : "No helpdesk figures for this month.", {
        muted: true,
      });

    pdf.heading("Open RFPs");
    if (d.rfps.length) {
      pdf.table(
        [
          { header: "RFP", width: 0.65 },
          { header: "Stage", width: 0.35 },
        ],
        d.rfps.slice(0, rows.rfps).map((r) => [r.title, r.stage]),
      );
    } else pdf.paragraph("No RFP is open.", { muted: true });
  }, pages);
}
