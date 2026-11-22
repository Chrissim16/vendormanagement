import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { agreementName } from "../../../../shared/agreements";
import { formatDay } from "../../../../shared/dates";
import { formatMoney, isMixed, moneyLine } from "../../../../shared/money";
import { REPORT_ENDING_DAYS, type ManagementReport } from "../../../../shared/overview";
import { addMonth, formatMetric, formatTarget, isMonth, metricInfo, monthName, monthOf } from "../../../../shared/performance";
import { formatScore, quarterName } from "../../../../shared/scorecards";
import { api, messageOf } from "../../lib/api";
import { burst } from "../../lib/burst";
import { useUrlState } from "../../lib/useUrlState";
import { TextAreaField, useForm } from "../../platform/form";
import { ConvertedNote, wholeAmounts } from "../../platform/Money";
import { useToday } from "../../platform/session";
import { Button, ErrorState, Loading, PageHeader, Pill } from "../../platform/ui";
import { MonthSelect } from "../performance/parts";
import { AiTextPanel, budgetPill, Figures, linkClass, Nothing, Section, TrendWords } from "./parts";

/** The summary as it will be printed: typed by hand or taken over from the AI, and saved with its own button (X-3). */
function SummaryForm({ report, month, onSaved }: { report: ManagementReport; month: string; onSaved: (r: ManagementReport) => void }) {
  const form = useForm({ summary: report.summary ?? "" }, (v) => api<ManagementReport>("/report", { method: "PUT", query: { month }, body: v }), {
    onSaved: (r) => {
      toast.success("Summary saved");
      onSaved(r);
    },
    check: (v) => ({ summary: v.summary.trim().length > 1500 ? "The summary is at most 1,500 characters." : "" }),
  });
  // When the saved text changes underneath (the AI's text was taken over), show that text.
  const { patch } = form;
  useEffect(() => patch({ summary: report.summary ?? "" }), [report.summary]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = form.values.summary.trim() !== (report.summary ?? "");
  const outdated = report.summaryOutdated;
  const canSave = changed || outdated;
  return (
    <form
      onSubmit={(e) => {
        // Nothing to save: the button is only dimmed, so it must not send an empty change either.
        if (!canSave) return e.preventDefault();
        void form.submit(e);
      }}
      noValidate
      className="flex flex-col gap-3"
    >
      <TextAreaField
        form={form}
        name="summary"
        label="Summary printed at the top of the report"
        rows={5}
        value={form.values.summary}
        onChange={(e) => form.set("summary", e.target.value)}
        placeholder="A few sentences on what matters this month. Leave empty for a report without a summary."
      />
      {form.problem && <ErrorState message={form.problem} />}
      {outdated && (
        <p role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-sunk px-5 py-3.5">
          <Pill tone="warn">Figures changed</Pill>
          <span className="min-w-0 flex-1">
            This month's figures have changed since the summary was saved, so it may quote amounts that are no longer right. Read it against the figures below, correct it if
            needed, and save it again. Until then the PDF says under the summary that the figures have changed.
          </span>
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" aria-disabled={form.busy || !canSave || undefined} className={!canSave ? "opacity-50" : undefined}>
          {form.busy ? "Saving" : outdated && !changed ? "Summary still holds" : "Save summary"}
        </Button>
        <p className="text-[13px] text-ink-2">
          {changed
            ? "Not saved yet. The PDF prints the saved summary."
            : report.summary
              ? "Saved. This is what the PDF prints."
              : "No summary yet: the PDF starts with the figures."}
        </p>
      </div>
    </form>
  );
}

/** The monthly management report (D-2): the month's figures on screen, a summary to write or take from the AI, and the PDF. */
export function ReportPage() {
  const qc = useQueryClient();
  const today = useToday();
  const current = monthOf(today);
  const [url, setUrl] = useUrlState({ month: "" });
  const month = isMonth(url.month) && url.month <= current && url.month >= addMonth(current, -23) ? url.month : addMonth(current, -1);
  const key = ["report", month];
  const q = useQuery({ queryKey: key, queryFn: () => api<ManagementReport>("/report", { query: { month } }) });
  const set = (r: ManagementReport) => qc.setQueryData(key, r);
  const ask = useMutation({ mutationFn: () => api<ManagementReport>("/report/suggestion", { method: "POST", query: { month } }), onSuccess: set });
  const review = useMutation({
    mutationFn: (v: { action: "accept" | "reject"; at: DOMRect | null }) =>
      api<ManagementReport>("/report/suggestion/review", { query: { month }, body: { action: v.action, suggestionId: q.data!.suggestion!.id } }),
    onSuccess: (r, v) => {
      if (v.action === "accept") burst(v.at, 9);
      toast.success(v.action === "accept" ? "The AI's summary is now the report's summary" : "AI summary rejected");
      set(r);
    },
    onError: async (e) => {
      toast.error(messageOf(e));
      // Someone else may have asked the AI again: show what is there now.
      await q.refetch();
    },
  });
  const r = q.data;
  const d = r?.data;
  const money = (minor: number, currency = "EUR") => formatMoney(minor, currency);
  return (
    <>
      <PageHeader
        context={d ? `For the IT management team · figures as at ${formatDay(d.asAt)}${d.running ? ", the month is still running" : ""}` : "For the IT management team"}
        title={`Monthly report, ${monthName(month)}`}
      >
        <MonthSelect id="report-month" value={month} current={current} onChange={(m) => setUrl({ month: m === addMonth(current, -1) ? "" : m }, { push: true })} />
        <a
          href={`/api/report/pdf?month=${month}`}
          download
          className="inline-flex h-[38px] items-center rounded-full bg-primary px-[18px] text-[13.5px] font-semibold text-primary-on transition duration-200 hover:-translate-y-px hover:shadow-[0_6px_18px_rgba(0,119,200,.3)] active:scale-[.96]"
        >
          Download PDF
        </a>
      </PageHeader>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Section title="Summary">
            <AiTextPanel
              title="AI summary"
              suggestion={r!.suggestion}
              from="this month's figures"
              intro="The AI can write a first version of the summary from the figures below. It becomes the report's summary only when you choose to use it, and you can change it afterwards."
              onAsk={() => ask.mutate()}
              asking={ask.isPending}
              askProblem={ask.isError ? messageOf(ask.error) : null}
              onReview={(action, at) => review.mutate({ action, at })}
              reviewing={review.isPending}
              note={
                r!.suggestion?.status === "accepted" || r!.suggestion?.status === "edited"
                  ? "Taken over into the summary below, where it can still be changed."
                  : "Nothing here is printed until you use it; the summary below is what the PDF prints."
              }
            >
              <p className="max-w-[78ch]">{r!.suggestion?.output.summary}</p>
            </AiTextPanel>
            <SummaryForm key={month} report={r!} month={month} onSaved={set} />
          </Section>

          <Section
            title="Spend against budgets"
            more={
              <Link to="/money" className={`text-[13.5px] ${linkClass}`}>
                Open spend
              </Link>
            }
          >
            <div className="text-ink-2">
              <p className="num">
                {!Object.keys(d!.spend.total.amounts).length
                  ? `Nothing was invoiced in ${monthName(month)}.`
                  : `Invoiced in ${monthName(month)}: ${money(d!.spend.total.eurMinor)}` +
                    (isMixed(d!.spend.total.amounts) ? ` in euros, converted (${wholeAmounts(moneyLine(d!.spend.total.amounts))}).` : ".")}
              </p>
              <ConvertedNote rates={d!.spend.rates} />
            </div>
            {d!.sows.length === 0 ? (
              <Nothing>No SOW with a budget ran in this month. A SOW appears here once it is active and has a budget.</Nothing>
            ) : (
              <Figures
                label="SOW budgets"
                head={["Vendor and SOW", "Budget", `Invoiced by ${formatDay(d!.asAt)}`, "Used", ""]}
                align={[undefined, "right", "right", "right"]}
                rows={d!.sows.map((s) => [
                  <Link key="t" to={`/agreements/${s.agreementId}`} className={linkClass}>
                    {s.vendorName} · {s.title}
                  </Link>,
                  money(s.budget.budgetMinor ?? 0, s.currency),
                  money(s.budget.invoicedMinor, s.currency),
                  s.budget.usedPct == null ? "–" : `${s.budget.usedPct}%`,
                  budgetPill(s.budget),
                ])}
              />
            )}
          </Section>

          <Section title={`Agreements ending within ${REPORT_ENDING_DAYS} days`}>
            {d!.ending.length === 0 ? (
              <Nothing>
                No active agreement ends between {formatDay(d!.asAt)} and {REPORT_ENDING_DAYS} days later.
              </Nothing>
            ) : (
              <Figures
                label="Agreements ending"
                head={["Vendor and agreement", "Ends", "", "Notice by"]}
                rows={d!.ending.map((e) => [
                  <Link key="t" to={`/agreements/${e.agreementId}`} className={linkClass}>
                    {e.vendorName} · {agreementName(e.kind, e.title)}
                  </Link>,
                  formatDay(e.endDate),
                  <span key="d" className="text-ink-2">
                    {e.daysLeft === 0 ? "on that day" : `${e.daysLeft} ${e.daysLeft === 1 ? "day" : "days"} after ${formatDay(d!.asAt)}`}
                  </span>,
                  e.noticeDeadline ? formatDay(e.noticeDeadline) : "–",
                ])}
              />
            )}
          </Section>

          <div className="grid grid-cols-2 gap-14">
            <Section title="Vendor scores">
              {d!.scores.length === 0 ? (
                <Nothing>No scorecard had been finalised by {formatDay(d!.asAt)}. Final scorecards appear here with their trend.</Nothing>
              ) : (
                <Figures
                  label="Vendor scores"
                  head={["Vendor", "Quarter", "Score", "Trend"]}
                  align={[undefined, undefined, "right", "right"]}
                  rows={d!.scores.map((s) => [
                    <Link key="t" to={`/performance/scorecards/${s.scorecardId}`} className={linkClass}>
                      {s.vendorName}
                    </Link>,
                    quarterName(s.quarter),
                    `${formatScore(s.overallTenths)} / 5`,
                    <TrendWords key="w" trend={s.trend} before={s.previousTenths == null ? null : formatScore(s.previousTenths)} />,
                  ])}
                />
              )}
            </Section>
            <Section title="Missed helpdesk targets">
              {d!.missed.length === 0 ? (
                <Nothing>
                  {d!.measuredVendors
                    ? `Every target was met in ${monthName(month)} by the ${d!.measuredVendors === 1 ? "helpdesk vendor" : `${d!.measuredVendors} helpdesk vendors`} measured.`
                    : `There are no helpdesk figures for ${monthName(month)}. They come from the Jira boards linked under Performance.`}
                </Nothing>
              ) : (
                <Figures
                  label="Missed helpdesk targets"
                  head={["Vendor", "Measure", monthName(month), "Target"]}
                  align={[undefined, undefined, "right", "right"]}
                  rows={d!.missed.map((m) => [
                    <Link key="t" to={`/performance/${m.vendorId}?month=${month}`} className={linkClass}>
                      {m.vendorName}
                    </Link>,
                    metricInfo[m.metric].label,
                    <span key="v" className="font-semibold text-[var(--crit-text)]">
                      {formatMetric(m.metric, m.valueTenths)}
                    </span>,
                    formatTarget(m.metric, m.targetTenths),
                  ])}
                />
              )}
            </Section>
          </div>

          <Section title="Open RFPs">
            {d!.rfps.length === 0 ? (
              <Nothing>No RFP is open. A running RFP is listed here with its stage; a new one is started under RFPs.</Nothing>
            ) : (
              <Figures
                label="Open RFPs"
                head={["RFP", "Stage"]}
                rows={d!.rfps.map((x) => [
                  <Link key="t" to={`/rfps/${x.id}`} className={`underline ${linkClass}`}>
                    {x.title}
                  </Link>,
                  <Pill key="s">{x.stage}</Pill>,
                ])}
              />
            )}
          </Section>
        </>
      )}
    </>
  );
}
