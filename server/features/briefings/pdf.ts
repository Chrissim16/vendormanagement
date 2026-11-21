import { agreementName, statusLabels } from "../../../shared/agreements";
import { formatDay } from "../../../shared/dates";
import { formatMoney } from "../../../shared/money";
import { metricTrendWords, pointsOf, trendWords, type Briefing } from "../../../shared/overview";
import { formatMetric, formatTarget, metricInfo, metricKeys, monthName, monthShort } from "../../../shared/performance";
import { formatScore, paperworkWords, quarterName } from "../../../shared/scorecards";
import { vendorStatusLabels, vendorTypeLabels } from "../../../shared/vendors";
import { makePdf } from "../../platform/pdf";

const when = (daysLeft: number) =>
  daysLeft < 0 ? `${-daysLeft} ${daysLeft === -1 ? "day" : "days"} ago` : daysLeft === 0 ? "today" : `in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`;

/**
 * A vendor briefing as a PDF (B-1), for the team's own use. The facts are the ones the
 * briefing was prepared with; the summary and talking points are the text a person saved.
 */
export function briefingPdf(b: Briefing): Promise<Buffer> {
  const f = b.facts;
  const title = `${f.vendor.name} briefing ${formatDay(f.asAt)}`;
  return makePdf({ title, footer: `${f.vendor.name} · Briefing · facts as at ${formatDay(f.asAt)} · internal` }, (pdf) => {
    pdf.title(`Vendor briefing · facts as at ${formatDay(f.asAt)} · for internal use`, f.vendor.name);
    pdf.facts([
      ["Vendor", `${vendorTypeLabels[f.vendor.type]} · ${vendorStatusLabels[f.vendor.status]} · owner ${f.vendor.ownerName}`],
      ["Paperwork", `NDA ${paperworkWords[f.vendor.nda]} · data processing agreement ${paperworkWords[f.vendor.dpa]}`],
      ...(f.score
        ? ([
            [
              "Latest scorecard",
              `${formatScore(f.score.overallTenths)} out of 5 for ${quarterName(f.score.quarter)}` +
                (f.score.previousTenths == null ? "" : ` (${trendWords[f.score.trend]}${f.score.trend === "same" ? "" : ` from ${formatScore(f.score.previousTenths)}`})`),
            ],
          ] as [string, string][])
        : []),
      [
        "Invoiced, last 12 months",
        [f.spend.total.EUR ? formatMoney(f.spend.total.EUR, "EUR") : null, f.spend.total.GBP ? formatMoney(f.spend.total.GBP, "GBP") : null].filter(Boolean).join(" and ") ||
          "Nothing",
      ],
    ]);

    if (b.summary) {
      pdf.heading("Summary");
      pdf.paragraph(b.summary);
    }
    const points = pointsOf(b.talkingPoints);
    if (points.length) {
      pdf.heading("Talking points");
      for (const p of points) pdf.paragraph(`•  ${p}`);
    }

    pdf.heading("Warnings and risk flags");
    if (f.flags.length) for (const w of f.flags) pdf.paragraph(`${w.label} · ${w.title}. ${w.detail}`);
    else pdf.paragraph("None.", { muted: true });

    pdf.heading("Agreements");
    if (f.agreements.length)
      pdf.table(
        [
          { header: "Agreement", width: 0.42 },
          { header: "Status", width: 0.2 },
          { header: "Ends or renews", width: 0.18 },
          { header: "Value", width: 0.2, align: "right" },
        ],
        f.agreements.map((a) => [
          agreementName(a.kind, a.title),
          statusLabels[a.status],
          a.endDate ? formatDay(a.endDate) : "–",
          a.valueMinor == null ? "–" : formatMoney(a.valueMinor, a.currency),
        ]),
      );
    else pdf.paragraph("No agreement is running or being prepared.", { muted: true });

    pdf.heading("Upcoming dates");
    if (f.dates.length)
      pdf.table(
        [
          { header: "Date", width: 0.2 },
          { header: "When", width: 0.18 },
          { header: "What", width: 0.62 },
        ],
        f.dates.map((d) => [formatDay(d.date), when(d.daysLeft), d.what]),
      );
    else pdf.paragraph("Nothing is dated in the coming six months.", { muted: true });

    pdf.heading("Spend against budget");
    if (f.budgets.length)
      pdf.table(
        [
          { header: "SOW", width: 0.4 },
          { header: "Budget", width: 0.2, align: "right" },
          { header: "Invoiced", width: 0.2, align: "right" },
          { header: "Used", width: 0.2, align: "right" },
        ],
        f.budgets.map((s) => [
          s.title,
          formatMoney(s.budget.budgetMinor ?? 0, s.currency),
          formatMoney(s.budget.invoicedMinor, s.currency),
          `${s.budget.usedPct ?? "–"}%${s.budget.state === "over" ? " (over budget)" : s.budget.state === "warn" ? " (close)" : ""}`,
        ]),
      );
    else pdf.paragraph("No active SOW with a budget.", { muted: true });

    pdf.heading("Helpdesk performance");
    if (f.performance) {
      const months = f.performance.months;
      pdf.table(
        [
          { header: "Measure", width: 0.24 },
          ...months.map((m) => ({ header: `${monthShort(m.month)} ${m.month.slice(0, 4)}`, width: 0.33 / months.length, align: "right" as const })),
          { header: "Target", width: 0.2, align: "right" },
          { header: "Latest month", width: 0.23, align: "right" },
        ],
        metricKeys.map((k) => {
          const target = months.at(-1)?.cells[k].targetTenths;
          return [
            metricInfo[k].label,
            ...months.map((m) => `${formatMetric(k, m.cells[k].valueTenths)}${m.cells[k].verdict === "missed" ? " (missed)" : ""}`),
            target == null ? "none" : formatTarget(k, target),
            metricTrendWords[f.performance!.trends[k]].replace(" than the month before", "").replace(" as the month before", "") || "–",
          ];
        }),
      );
      pdf.paragraph(
        f.missed.length
          ? `Targets missed: ${f.missed.map((m) => `${metricInfo[m.metric].label} in ${monthName(m.month)} (${formatMetric(m.metric, m.valueTenths)} against ${formatTarget(m.metric, m.targetTenths)})`).join("; ")}.`
          : "No target was missed in these months.",
        { muted: !f.missed.length },
      );
    } else pdf.paragraph(f.vendor.scoringEnabled ? "This vendor has no Jira board, so there are no helpdesk figures." : "This vendor is not scored.", { muted: true });

    pdf.heading("Open milestones and change requests");
    if (f.milestones.length)
      pdf.table(
        [
          { header: "Milestone", width: 0.4 },
          { header: "SOW", width: 0.3 },
          { header: "Due", width: 0.15 },
          { header: "", width: 0.15, align: "right" },
        ],
        f.milestones.map((m) => [m.title, m.sowTitle, formatDay(m.dueDate), m.daysLate > 0 ? `${m.daysLate} ${m.daysLate === 1 ? "day" : "days"} late` : ""]),
      );
    else pdf.paragraph("No open milestones.", { muted: true });
    for (const c of f.changeRequests)
      pdf.paragraph(
        `Change request waiting for a decision: ${c.title} (${c.sowTitle}), asked for on ${formatDay(c.requestedOn)}` +
          `${c.budgetChangeMinor ? `, budget ${c.budgetChangeMinor > 0 ? "+" : "-"} ${formatMoney(Math.abs(c.budgetChangeMinor), c.currency)}` : ""}${c.newEndDate ? `, new end date ${formatDay(c.newEndDate)}` : ""}.`,
      );
    if (!f.changeRequests.length) pdf.paragraph("No change request is waiting for a decision.", { muted: true });

    const s = b.suggestion;
    if ((b.summary || points.length) && s && (s.status === "accepted" || s.status === "edited"))
      pdf.paragraph(`The summary and talking points were drafted by the AI and ${s.status === "edited" ? "changed" : "accepted"} by ${s.reviewedBy ?? "a team member"}.`, {
        muted: true,
      });
  });
}
