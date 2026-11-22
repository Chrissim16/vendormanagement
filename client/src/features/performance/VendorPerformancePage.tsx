import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  formatDuration,
  formatMetric,
  isMonth,
  metricInfo,
  metricKeys,
  monthName,
  monthShort,
  type MetricKey,
  type Month,
  type MonthMetrics,
  type TicketSet,
  type VendorPerformance,
} from "../../../../shared/performance";
import { api, ApiError, messageOf } from "../../lib/api";
import { useUrlState } from "../../lib/useUrlState";
import { History } from "../../platform/History";
import { useMe } from "../../platform/session";
import { Button, EmptyState, ErrorState, Loading, PageHeader, Pill } from "../../platform/ui";
import { NotFoundPage } from "../placeholders";
import { MonthProposal } from "../scorecards/MonthProposal";
import { BoardLinkForm, linkSavedMessage } from "./BoardLinkForm";
import { count, headlineSet, MissedPill, MonthSelect, monthTitle, plural, SyncButton, SyncStatus, ticketsHref, Verdict } from "./parts";
import { TargetsForm } from "./TargetsForm";

const link = "font-medium text-accent-ink underline-offset-2 hover:underline";

/** Twelve small bars, the chosen month in the accent. Decoration: the table of twelve months below holds the same figures. */
function Trend({ metric, months }: { metric: MetricKey; months: MonthMetrics[] }) {
  const values = months.map((m) => m.cells[metric].valueTenths);
  const info = metricInfo[metric];
  // Shares that should be high are drawn against 100%; figures that should be low against their own highest month, or they would all be slivers.
  const top = info.unit === "percent" && info.direction === "at_least" ? 1000 : info.unit === "rating" ? 50 : Math.max(...values.map((v) => v ?? 0), 10);
  return (
    <div aria-hidden className="flex h-[52px] items-end gap-[3px] border-b border-line-2">
      {months.map((m, i) => {
        const v = values[i];
        return (
          <motion.div
            key={m.month}
            title={`${monthName(m.month)}: ${formatMetric(metric, v ?? null)}`}
            className={`min-w-0 flex-1 origin-bottom rounded-t-[3px] ${i === months.length - 1 ? "bg-accent" : "bg-[var(--bar)]"}`}
            style={{ height: v == null ? 0 : `${Math.max((v / top) * 100, 3)}%` }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20, delay: i * 0.02 }}
          />
        );
      })}
    </div>
  );
}

/** One metric of the chosen month: the figure, its verdict, the counts behind it (each opens its tickets) and the trend. */
function MetricRow({ vendorId, metric, month, months }: { vendorId: string; metric: MetricKey; month: MonthMetrics; months: MonthMetrics[] }) {
  const c = month.counts;
  const cell = month.cells[metric];
  const to = (set: TicketSet, text: string) => (
    <Link to={ticketsHref(vendorId, set, month.month)} className={link}>
      {text}
    </Link>
  );
  const nothing = <span className="text-ink-2">Nothing to measure this month.</span>;
  const detail: Record<MetricKey, ReactNode> = {
    first_response: c.frMeasured ? (
      <>
        {to("fr_met", `${count(c.frMet)} answered in time`)}, {to("fr_missed", `${count(c.frMeasured - c.frMet)} late`)}, of {to("fr_measured", plural(c.frMeasured, "ticket"))}{" "}
        created. Half were answered within {formatDuration(c.frMedianMinutes)}.
      </>
    ) : (
      nothing
    ),
    first_line: c.resolved ? (
      <>
        {to("first_line", `${count(c.firstLine)} solved by the first line`)}, {to("escalated", `${count(c.resolved - c.firstLine)} escalated`)}, of{" "}
        {to("resolved", plural(c.resolved, "ticket"))} resolved.
      </>
    ) : (
      nothing
    ),
    sla_breaches: c.resolved ? (
      <>
        {to("breached", `${count(c.breached)} resolved late`)}, of {to("resolved", plural(c.resolved, "ticket"))} resolved.
      </>
    ) : (
      nothing
    ),
    backlog_age: c.backlog ? (
      <>
        {to("backlog", `${plural(c.backlog, "ticket")} open`)}. Half are older than {plural(c.backlogMedianDays ?? 0, "day")}.
      </>
    ) : (
      <span className="text-ink-2">{c.existed ? "No tickets open." : "Nothing to measure this month."}</span>
    ),
    csat: c.ratings ? <>From {to("rated", plural(c.ratings, "rating"))}.</> : <span className="text-ink-2">No ratings this month.</span>,
  };
  return (
    <li aria-label={metricInfo[metric].label} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_200px] items-center gap-x-8 gap-y-2 border-b border-line py-5">
      <div className="min-w-0">
        <h3 className="font-semibold">{metricInfo[metric].label}</h3>
        <p className="text-[13px] text-ink-2">{metricInfo[metric].measures}</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link
            to={ticketsHref(vendorId, headlineSet[metric], month.month)}
            aria-label={`${metricInfo[metric].label}: ${formatMetric(metric, cell.valueTenths)}. Open the tickets behind it`}
            className="num text-[26px] font-semibold leading-none tracking-[-0.02em] underline-offset-4 hover:underline"
          >
            {formatMetric(metric, cell.valueTenths)}
          </Link>
          <Verdict metric={metric} cell={cell} />
        </div>
        {cell.verdict === "missed" && <p className="text-[13px] font-medium text-[var(--crit-text)]">Target missed, a service credit may apply.</p>}
        <p className="text-[13px]">{detail[metric]}</p>
      </div>
      <Trend metric={metric} months={months} />
    </li>
  );
}

/** One vendor's helpdesk performance: the chosen month, twelve months of trend, targets and the Jira board (J-1 to J-4). */
export function VendorPerformancePage() {
  const { vendorId = "" } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const [url, setUrl] = useUrlState({ month: "" });
  const [dialog, setDialog] = useState<null | "targets" | "link">(null);
  const month = isMonth(url.month) ? url.month : undefined;
  const q = useQuery({
    queryKey: ["performance", "vendor", vendorId, month ?? ""],
    queryFn: () => api<VendorPerformance>(`/performance/vendors/${vendorId}`, { query: { month } }),
    placeholderData: (p, prev) => (prev?.queryKey[2] === vendorId ? p : undefined),
    retry: false,
  });
  if (q.isError && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400)) return <NotFoundPage />;
  const p = q.data;
  const admin = me.role === "admin";
  const chosen = p?.months.at(-1);
  const setMonth = (m: Month) => setUrl({ month: m === p?.currentMonth ? "" : m }, { push: true });
  const done = async () => {
    setDialog(null);
    await qc.invalidateQueries();
  };
  const back = (
    <Link to="/performance" className="underline-offset-2 hover:underline">
      Performance
    </Link>
  );

  return (
    <>
      <PageHeader
        context={
          <>
            {back}
            {p?.link ? ` · Jira board ${p.link.projectKey}${p.link.projectName ? ` · ${p.link.projectName}` : ""}` : ""}
          </>
        }
        title={p?.vendor.name ?? " "}
      >
        {p?.vendor.scoringEnabled && (
          <Link
            to={`/performance/scorecards?vendorId=${vendorId}`}
            className="inline-flex h-[38px] items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-semibold hover:bg-sunk"
          >
            Scorecards
          </Link>
        )}
        {p?.link && <SyncButton vendorId={vendorId} disabled={!p.link.active} />}
        {p?.vendor.scoringEnabled && admin && <Button onClick={() => setDialog("link")}>{p.link ? "Edit board link" : "Link a board"}</Button>}
        {p?.vendor.scoringEnabled && (
          <Button variant="primary" onClick={() => setDialog("targets")}>
            Set targets
          </Button>
        )}
      </PageHeader>

      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : !p!.vendor.scoringEnabled ? (
        <EmptyState title="This vendor is not scored">
          Scoring is switched off for {p!.vendor.name}, so it has no performance figures and no scorecards. Switch scoring on in the vendor's details if it should be measured.
        </EmptyState>
      ) : !p!.link || !chosen ? (
        <EmptyState
          title="No Jira board linked"
          action={
            admin ? (
              <Button variant="primary" onClick={() => setDialog("link")}>
                Link a board
              </Button>
            ) : undefined
          }
        >
          {p!.vendor.name} has no Jira board yet, so there are no helpdesk figures. Linking one fetches its tickets and fills this page with first response, first-line closure, SLA
          breaches, backlog age and satisfaction per month.{admin ? "" : " Linking a board is done by an admin."}
        </EmptyState>
      ) : (
        <>
          <SyncStatus link={p!.link} />
          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-end gap-4">
              <MonthSelect id="vendor-month" value={chosen.month} current={p!.currentMonth} onChange={setMonth} />
              <span className="flex-1" />
              <span className="pb-2">
                <MissedPill metrics={chosen} />
              </span>
            </div>
            <h2 className="sr-only">{monthTitle(chosen.month, p!.currentMonth)}</h2>
            {p!.link.tickets === 0 ? (
              <EmptyState title="No tickets on this board yet">
                The board is linked, but no tickets have been fetched from it. Press Sync now, or check that the board holds tickets.
              </EmptyState>
            ) : (
              <ul aria-label={`Metrics for ${monthName(chosen.month)}`} className="flex flex-col border-t border-line">
                {metricKeys.map((k) => (
                  <MetricRow key={k} vendorId={vendorId} metric={k} month={chosen} months={p!.months} />
                ))}
              </ul>
            )}
          </section>

          {p!.link.tickets > 0 && <MonthProposal vendorId={vendorId} month={chosen.month} />}

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">Twelve months</h2>
            <table aria-label="Twelve months of metrics" className="w-full border-collapse text-left">
              <thead>
                <tr className="text-[12.5px] text-ink-3">
                  <th scope="col" className="py-2 font-medium">
                    Month
                  </th>
                  {metricKeys.map((k) => (
                    <th key={k} scope="col" className="py-2 text-right font-medium">
                      {metricInfo[k].label}
                    </th>
                  ))}
                  <th scope="col" className="py-2 pl-6 font-medium">
                    Targets
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...p!.months].reverse().map((m) => (
                  <tr key={m.month} className="border-t border-line">
                    <th scope="row" className="py-2.5 font-normal">
                      <Link
                        to={`/performance/${vendorId}?month=${m.month}`}
                        aria-current={m.month === chosen.month ? "true" : undefined}
                        className={m.month === chosen.month ? "font-semibold" : link}
                      >
                        {monthShort(m.month)} {m.month.slice(0, 4)}
                      </Link>
                    </th>
                    {metricKeys.map((k) => (
                      <td key={k} className="py-2.5 text-right">
                        {m.cells[k].verdict === "missed" ? (
                          <span className="font-semibold text-[var(--crit-text)]">
                            {formatMetric(k, m.cells[k].valueTenths)}
                            <span className="sr-only"> (target missed)</span>
                          </span>
                        ) : (
                          formatMetric(k, m.cells[k].valueTenths)
                        )}
                      </td>
                    ))}
                    <td className="py-2.5 pl-6 text-ink-2">{m.missed ? `${m.missed} missed` : metricKeys.some((k) => m.cells[k].verdict === "met") ? "Met" : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[13px] text-ink-2">A figure in red missed its target for that month. Targets are applied to every month shown, as they stand today.</p>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">How this board is read</h2>
            <dl className="grid grid-cols-[220px_minmax(0,1fr)] gap-x-4 gap-y-2.5">
              <dt className="text-ink-2">Support level shows in</dt>
              <dd>{p!.link.escalationMethod === "status" ? "The ticket's status" : "A label on the ticket"}</dd>
              {(["l1Values", "l2Values", "l3Values"] as const).map((f, i) => (
                <div key={f} className="contents">
                  <dt className="text-ink-2">Level {i + 1}</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {p!.link![f].length ? (
                      p!.link![f].map((v) => <Pill key={v}>{v}</Pill>)
                    ) : (
                      <span className="text-ink-2">{i === 0 ? "Everything not listed for level 2 or 3" : "Nothing listed"}</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}

      {p && (
        <div className="max-w-[720px]">
          <History entityType="vendor" entityId={vendorId} limit={5} />
        </div>
      )}

      {dialog === "targets" && p && (
        <TargetsForm
          vendorId={vendorId}
          vendorName={p.vendor.name}
          targets={p.targets}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            toast.success("Targets saved");
            await done();
          }}
        />
      )}
      {dialog === "link" && p && (
        <BoardLinkForm
          vendor={p.vendor}
          link={p.link}
          onClose={() => setDialog(null)}
          onSaved={async (saved, name) => {
            const m = linkSavedMessage(saved, name);
            (m.ok ? toast.success : toast.error)(m.text);
            await done();
          }}
        />
      )}
    </>
  );
}
