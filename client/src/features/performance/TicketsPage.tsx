import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isMonth, monthName, ticketSetLabels, ticketSets, type Month, type Ticket, type TicketSet } from "../../../../shared/performance";
import type { Page } from "../../../../shared/types";
import { api, ApiError, messageOf, queryString } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { pageNumber, useUrlState } from "../../lib/useUrlState";
import { DataTable, Pager, type Column } from "../../platform/DataTable";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Pill, TextInput } from "../../platform/ui";
import { NotFoundPage } from "../placeholders";
import { plural } from "./parts";

const levels = ["", "First line", "Second line", "Third line"];
const sla = (breached: boolean | null) => (breached == null ? <span className="text-ink-2">–</span> : breached ? <Pill tone="bad">Late</Pill> : <Pill tone="ok">In time</Pill>);
const columns: Column<Ticket>[] = [
  {
    key: "key",
    header: "Ticket",
    sort: "key",
    fit: true,
    cell: (t) =>
      t.url ? (
        <a href={t.url} target="_blank" rel="noreferrer noopener" className="font-semibold text-accent-ink underline-offset-2 hover:underline">
          {t.key}
        </a>
      ) : (
        <span className="font-semibold">{t.key}</span>
      ),
  },
  { key: "summary", header: "Summary", sort: "summary", className: "min-w-[220px]", cell: (t) => <span title={t.summary ?? undefined}>{t.summary ?? "–"}</span> },
  { key: "status", header: "Status", sort: "status", fit: true, cell: (t) => <span className="text-ink-2">{t.status ?? "–"}</span> },
  {
    key: "created",
    header: "Created",
    sort: "created",
    fit: true,
    cell: (t) => (
      <span className="text-ink-2" title={formatDateTime(t.createdAt)}>
        {formatDate(t.createdAt)}
      </span>
    ),
  },
  {
    key: "resolved",
    header: "Resolved",
    sort: "resolved",
    fit: true,
    cell: (t) => (
      <span className="text-ink-2" title={t.resolvedAt ? formatDateTime(t.resolvedAt) : undefined}>
        {t.resolvedAt ? formatDate(t.resolvedAt) : "Open"}
      </span>
    ),
  },
  { key: "level", header: "Went up to", sort: "level", fit: true, cell: (t) => <span className="text-ink-2">{levels[t.highestLevel]}</span> },
  { key: "response", header: "First response", fit: true, cell: (t) => sla(t.firstResponseBreached) },
  { key: "resolution", header: "Resolution", fit: true, cell: (t) => sla(t.resolutionBreached) },
  { key: "csat", header: "Rating", sort: "csat", fit: true, className: "text-right", cell: (t) => (t.csat == null ? <span className="text-ink-2">–</span> : `${t.csat} of 5`) },
];
const PAGE_SIZE = 25;
type TicketPage = Page<Ticket> & { month: Month; vendorName: string };

/** The tickets behind one figure of one month (J-3). */
export function TicketsPage() {
  const { vendorId = "" } = useParams();
  const [url, setUrl] = useUrlState({ set: "", month: "", q: "", sort: "", dir: "", page: "1" });
  const set = (ticketSets as readonly string[]).includes(url.set) ? (url.set as TicketSet) : null;
  // The backlog reads best oldest first; everything else newest first.
  const sort = url.sort || "created";
  const dir = url.dir || (set === "backlog" ? "asc" : "desc");
  const [search, setSearch] = useState(url.q);
  useEffect(() => {
    const t = setTimeout(() => search !== url.q && setUrl({ q: search, page: "1" }), 250);
    return () => clearTimeout(t);
  }, [search, url.q, setUrl]);
  const page = pageNumber(url.page);
  const month = isMonth(url.month) ? url.month : undefined;
  const q = useQuery({
    queryKey: ["performance", "tickets", vendorId, set, month ?? "", url.q, sort, dir, page],
    queryFn: () => api<TicketPage>(`/performance/vendors/${vendorId}/tickets`, { query: { set, month, q: url.q, sort, dir, page, pageSize: PAGE_SIZE } }),
    enabled: !!set,
    placeholderData: (p) => p,
    retry: false,
  });
  if (!set || (q.isError && q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400))) return <NotFoundPage />;
  const d = q.data;
  const back = `/performance/${vendorId}${queryString({ month })}`;

  return (
    <>
      <PageHeader
        context={
          <>
            <Link to="/performance" className="underline-offset-2 hover:underline">
              Performance
            </Link>
            {" · "}
            <Link to={back} className="underline-offset-2 hover:underline">
              {d?.vendorName ?? "Vendor"}
            </Link>
            {d ? ` · ${monthName(d.month)}` : ""}
          </>
        }
        title={ticketSetLabels[set]}
      />
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Search these tickets" htmlFor="ticket-search">
          <TextInput id="ticket-search" type="search" placeholder="Key, summary or status" value={search} onChange={(e) => setSearch(e.target.value)} className="w-[280px]" />
        </Field>
        <p role="status" className="num pb-2 text-ink-2">
          {d && !q.isPlaceholderData ? plural(d.total, "ticket") : " "}
        </p>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : d!.total === 0 ? (
        url.q ? (
          <EmptyState title="No tickets match">Nothing behind this figure matches “{url.q}”. Clear the search to see them all.</EmptyState>
        ) : (
          <EmptyState
            title="No tickets behind this figure"
            action={
              <Link to={back} className="font-semibold text-accent-ink underline-offset-2 hover:underline">
                Back to {d!.vendorName}
              </Link>
            }
          >
            In {monthName(d!.month)} there were none of these. Tickets appear here as they are fetched from the vendor's Jira board.
          </EmptyState>
        )
      ) : (
        <>
          <DataTable
            label={ticketSetLabels[set]}
            rows={d!.items}
            columns={columns}
            rowId={(t) => t.id}
            rowLabel={(t) => t.key}
            sort={sort}
            dir={dir}
            onSort={(s, dr) => setUrl({ sort: s, dir: dr, page: "1" })}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={d!.total} onPage={(n) => setUrl({ page: String(n) })} />
        </>
      )}
    </>
  );
}
