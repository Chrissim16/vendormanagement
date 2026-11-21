import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { isMonth, metricKeys, monthName, type OverviewRow, type PerformanceOverview } from "../../../../shared/performance";
import { api, messageOf, queryString } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { useUrlState } from "../../lib/useUrlState";
import { DataTable, type Column } from "../../platform/DataTable";
import { useMe } from "../../platform/session";
import { Button, EmptyState, ErrorState, Loading, PageHeader } from "../../platform/ui";
import { BoardLinkForm, linkSavedMessage } from "./BoardLinkForm";
import { everyWords, metricLabel, MetricFigure, MissedPill, MonthSelect, monthTitle, plural, SyncButton, SyncStatus } from "./parts";

const columns: Column<OverviewRow>[] = [
  { key: "vendor", header: "Vendor", sort: "vendor", cell: (r) => r.vendorName, className: "min-w-[150px]" },
  ...metricKeys.map((k): Column<OverviewRow> => ({
    key: k,
    header: metricLabel(k),
    sort: k,
    fit: true,
    className: "align-top",
    cell: (r) => <MetricFigure metric={k} cell={r.metrics.cells[k]} />,
  })),
  {
    key: "missed",
    header: "Targets",
    sort: "missed",
    fit: true,
    className: "align-top",
    cell: (r) => <MissedPill short missed={r.metrics.missed} anyTarget={metricKeys.some((k) => r.metrics.cells[k].targetTenths != null)} />,
  },
];

/** Every scored vendor's month against its targets (J-5), and the state of the Jira sync (J-2). */
export function PerformancePage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useUrlState({ month: "", sort: "missed", dir: "desc" });
  const [linking, setLinking] = useState(false);
  const month = isMonth(url.month) ? url.month : undefined;
  const q = useQuery({
    queryKey: ["performance", month ?? "", url.sort, url.dir],
    queryFn: () => api<PerformanceOverview>("/performance", { query: { month, sort: url.sort, dir: url.dir } }),
    placeholderData: (p) => p,
  });
  const o = q.data;
  const admin = me.role === "admin";
  const failed = o?.rows.filter((r) => r.link.active && r.link.lastSyncOk === false) ?? [];
  const missed = o?.rows.filter((r) => r.metrics.missed > 0).length ?? 0;
  const fetched = o?.rows
    .map((r) => r.link.lastSyncedAt)
    .filter((x): x is string => !!x)
    .sort();

  return (
    <>
      <PageHeader
        context={
          !o
            ? " "
            : `${monthTitle(o.month, o.currentMonth)} · ${plural(o.rows.length, "vendor")} with a Jira board${o.rows.length ? ` · ${missed === 0 ? "no targets missed" : `${plural(missed, "vendor")} missed a target`}` : ""}`
        }
        title="Performance"
      >
        {o && o.rows.length > 0 && <SyncButton />}
        {admin && o && (
          <Button variant="primary" onClick={() => setLinking(true)}>
            Link a board
          </Button>
        )}
      </PageHeader>

      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : o!.rows.length === 0 ? (
        <EmptyState
          title="No helpdesk boards linked yet"
          action={
            admin ? (
              <Button variant="primary" onClick={() => setLinking(true)}>
                Link the first board
              </Button>
            ) : undefined
          }
        >
          Once a vendor is linked to its Jira board, its tickets are fetched and this page shows first response, first-line closure, SLA breaches, backlog age and satisfaction for
          each month, against the targets from the contract.{admin ? "" : " Linking a board is done by an admin."}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <MonthSelect id="perf-month" value={o!.month} current={o!.currentMonth} onChange={(m) => setUrl({ month: m === o!.currentMonth ? "" : m }, { push: true })} />
            <p className="min-w-0 flex-1 pb-2 text-ink-2">
              Tickets are fetched from Jira {everyWords(o!.syncEveryMinutes)}
              {fetched?.length ? "." : ". Nothing has been fetched yet."}
            </p>
          </div>
          {failed.map((r) => (
            <div key={r.vendorId} aria-label={`Sync of ${r.vendorName}`} role="group" className="flex flex-col gap-1.5">
              <p className="font-semibold">{r.vendorName}</p>
              <SyncStatus link={r.link} />
            </div>
          ))}
          <DataTable
            label={`Performance in ${monthName(o!.month)}`}
            rows={o!.rows}
            columns={columns}
            rowId={(r) => r.vendorId}
            rowLabel={(r) => r.vendorName}
            sort={url.sort}
            dir={url.dir}
            onSort={(sort, dir) => setUrl({ sort, dir })}
            onOpen={(r) => navigate(`/performance/${r.vendorId}${queryString({ month })}`)}
          />
          <ul aria-label="Jira sync per board" className="flex flex-col gap-1 text-[13px] text-ink-2">
            {o!.rows.map((r) => (
              <li key={r.vendorId} className="num">
                <span className="font-medium text-ink">{r.vendorName}</span> · board {r.link.projectKey} ·{" "}
                {!r.link.active
                  ? "sync switched off"
                  : r.link.lastSyncOk === false
                    ? "last sync failed, see above"
                    : r.link.lastSyncedAt
                      ? `last fetched ${formatDateTime(r.link.lastSyncedAt)}, ${plural(r.link.lastSyncUpdated ?? 0, "ticket")} updated`
                      : "not fetched yet"}
              </li>
            ))}
          </ul>
        </>
      )}

      {o && o.unlinked.length > 0 && o.rows.length > 0 && (
        <p className="rounded-2xl bg-sunk px-5 py-3.5 text-[13px] text-ink-2">
          Scored vendors without a Jira board: {o.unlinked.map((u) => u.name).join(", ")}. They are scored by hand
          {admin ? ", or use Link a board if they run a helpdesk for us" : ""}.
        </p>
      )}

      {linking && o && (
        <BoardLinkForm
          vendors={o.unlinked}
          onClose={() => setLinking(false)}
          onSaved={async (saved, name) => {
            setLinking(false);
            const m = linkSavedMessage(saved, name);
            (m.ok ? toast.success : toast.error)(m.text);
            await qc.invalidateQueries();
          }}
        />
      )}
    </>
  );
}
