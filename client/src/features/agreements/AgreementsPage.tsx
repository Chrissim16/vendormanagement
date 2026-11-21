import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { agreementStatuses, kindLabels, kinds, kindShort, statusLabels, type Agreement } from "../../../../shared/agreements";
import { isDay } from "../../../../shared/dates";
import { formatMoney } from "../../../../shared/money";
import type { Page } from "../../../../shared/types";
import type { Vendor } from "../../../../shared/vendors";
import { api, messageOf, queryString } from "../../lib/api";
import { personName, usePeople } from "../../lib/data";
import { pageNumber, useUrlState } from "../../lib/useUrlState";
import { DataTable, Pager, type Column } from "../../platform/DataTable";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, Pill, Select, TextInput } from "../../platform/ui";
import { AgreementForm } from "./AgreementForm";
import { agreementTone, day } from "./display";

/** The two views of agreements: everything, and what needs a renewal decision. */
export function AgreementTabs() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `-mb-px border-b-2 py-2.5 font-medium transition-colors ${isActive ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink"}`;
  return (
    <nav aria-label="Agreement views" className="-mt-4 flex gap-6 border-b border-line">
      <NavLink to="/agreements" end className={cls}>
        All agreements
      </NavLink>
      <NavLink to="/agreements/renewals" className={cls}>
        Renewals
      </NavLink>
    </nav>
  );
}

const columns: Column<Agreement>[] = [
  { key: "title", header: "Agreement", sort: "title", cell: (a) => a.title, className: "w-[24%]" },
  { key: "vendor", header: "Vendor", sort: "vendor", cell: (a) => <span className="text-ink-2">{a.vendorName}</span>, className: "w-[17%]" },
  { key: "kind", fit: true, header: "Kind", sort: "kind", cell: (a) => <Pill tone={a.kind === "sow" ? "brand" : "none"}>{kindShort[a.kind]}</Pill> },
  { key: "status", fit: true, header: "Status", sort: "status", cell: (a) => <Pill tone={agreementTone(a.status)}>{statusLabels[a.status]}</Pill> },
  { key: "endDate", fit: true, header: "End date", sort: "endDate", cell: (a) => <span className="num text-ink-2">{day(a.endDate)}</span> },
  { key: "owner", fit: true, header: "Owner", sort: "owner", cell: (a) => <span className="text-ink-2">{a.ownerName}</span> },
  {
    key: "value",
    fit: true,
    header: "Value or budget",
    sort: "value",
    cell: (a) => <span className="num">{(a.budgetMinor ?? a.annualValueMinor) == null ? "–" : formatMoney((a.budgetMinor ?? a.annualValueMinor)!, a.currency)}</span>,
    className: "text-right",
  },
];
const PAGE_SIZE = 25;

export function AgreementsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const people = usePeople();
  const [url, setUrl] = useUrlState({ q: "", kind: "", vendorId: "", status: "", owner: "", endsFrom: "", endsTo: "", sort: "title", dir: "asc", page: "1" });
  const [search, setSearch] = useState(url.q);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => search !== url.q && setUrl({ q: search, page: "1" }), 250);
    return () => clearTimeout(t);
  }, [search, url.q, setUrl]);
  const page = pageNumber(url.page);
  // A date still being typed is not sent, so the list never shows an error for half a date.
  const ends = { endsFrom: isDay(url.endsFrom) ? url.endsFrom : "", endsTo: isDay(url.endsTo) ? url.endsTo : "" };
  const filters = { q: url.q, kind: url.kind, vendorId: url.vendorId, status: url.status, owner: url.owner, ...ends, sort: url.sort, dir: url.dir };
  const list = useQuery({
    queryKey: ["agreements", filters, page],
    queryFn: () => api<Page<Agreement>>("/agreements", { query: { ...filters, page, pageSize: PAGE_SIZE } }),
    placeholderData: (p) => p,
  });
  const vendors = useQuery({ queryKey: ["vendors", "choices-all"], queryFn: () => api<Page<Vendor>>("/vendors", { query: { pageSize: 200, sort: "name", status: "all" } }) });
  const filtered = !!(url.q || url.kind || url.vendorId || url.status || url.owner || url.endsFrom || url.endsTo);
  const total = list.data?.total;

  return (
    <>
      <PageHeader context={total === undefined ? " " : `${total} ${total === 1 ? "agreement" : "agreements"}`} title="Agreements">
        {/* A plain link, so the browser downloads the file the server builds from the same filters. */}
        <a
          href={`/api/agreements/export.csv${queryString(filters)}`}
          download
          className="inline-flex h-[38px] items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-semibold transition hover:bg-sunk active:scale-[.96]"
        >
          Export CSV
        </a>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add agreement
        </Button>
      </PageHeader>
      <AgreementTabs />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" htmlFor="agreements-q">
          <TextInput id="agreements-q" type="search" placeholder="Title, reference or vendor" value={search} onChange={(e) => setSearch(e.target.value)} className="w-60" />
        </Field>
        <Field label="Kind" htmlFor="agreements-kind">
          <Select id="agreements-kind" value={url.kind} onChange={(e) => setUrl({ kind: e.target.value, page: "1" })}>
            <option value="">Any kind</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {kindLabels[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor" htmlFor="agreements-vendor">
          <Select id="agreements-vendor" value={url.vendorId} onChange={(e) => setUrl({ vendorId: e.target.value, page: "1" })} className="max-w-[200px]">
            <option value="">Any vendor</option>
            {vendors.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="agreements-status">
          <Select id="agreements-status" value={url.status} onChange={(e) => setUrl({ status: e.target.value, page: "1" })}>
            <option value="">Any status</option>
            {agreementStatuses.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Owner" htmlFor="agreements-owner">
          <Select id="agreements-owner" value={url.owner} onChange={(e) => setUrl({ owner: e.target.value, page: "1" })}>
            <option value="">Anyone</option>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ends from" htmlFor="agreements-ends-from">
          <TextInput id="agreements-ends-from" type="date" value={url.endsFrom} onChange={(e) => setUrl({ endsFrom: e.target.value, page: "1" })} />
        </Field>
        <Field label="Ends to" htmlFor="agreements-ends-to">
          <TextInput id="agreements-ends-to" type="date" value={url.endsTo} onChange={(e) => setUrl({ endsTo: e.target.value, page: "1" })} />
        </Field>
      </div>
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState message={messageOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          title={filtered ? "No agreements match these filters" : "No agreements yet"}
          action={
            !filtered && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add the first agreement
              </Button>
            )
          }
        >
          {filtered
            ? "Clear the search or the filters to see every agreement."
            : "MSAs, SOWs, subscriptions, NDAs and data processing agreements belong here, with their dates, values and renewal deadlines."}
        </EmptyState>
      ) : (
        <div>
          <DataTable
            label="Agreements"
            rows={list.data.items}
            columns={columns}
            rowId={(a) => a.id}
            rowLabel={(a) => `${a.title}, ${a.vendorName}`}
            sort={url.sort}
            dir={url.dir}
            onSort={(sort, dir) => setUrl({ sort, dir, page: "1" })}
            onOpen={(a) => navigate(`/agreements/${a.id}`)}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setUrl({ page: String(p) })} />
        </div>
      )}
      {adding && (
        <AgreementForm
          onClose={() => setAdding(false)}
          onSaved={async (a) => {
            setAdding(false);
            toast.success(`Added ${a.title}`);
            await qc.invalidateQueries();
            navigate(`/agreements/${a.id}`);
          }}
        />
      )}
    </>
  );
}
