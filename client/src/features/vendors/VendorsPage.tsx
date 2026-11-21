import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Page } from "../../../../shared/types";
import { vendorStatuses, vendorStatusLabels, vendorTypeLabels, vendorTypes, type Vendor } from "../../../../shared/vendors";
import { api, messageOf } from "../../lib/api";
import { personName, usePeople } from "../../lib/data";
import { pageNumber, useUrlState } from "../../lib/useUrlState";
import { DataTable, Pager, type Column } from "../../platform/DataTable";
import { SplitView } from "../../platform/SplitView";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, Pill, Select, TextInput } from "../../platform/ui";
import { VendorForm } from "./VendorForm";
import { VendorPanel, vendorTone } from "./VendorPanel";

const columns: Column<Vendor>[] = [
  { key: "name", header: "Vendor", sort: "name", cell: (v) => v.name, className: "w-[28%]" },
  { key: "type", fit: true, header: "Type", sort: "type", cell: (v) => <span className="text-ink-2">{vendorTypeLabels[v.type]}</span> },
  { key: "owner", fit: true, header: "Owner", sort: "owner", cell: (v) => <span className="text-ink-2">{v.ownerName}</span> },
  { key: "agreements", fit: true, header: "Active agreements", cell: (v) => <span className="num">{v.activeAgreements}</span> },
  {
    key: "warnings",
    fit: true,
    header: "Needs attention",
    cell: (v) => (v.warnings ? <Pill tone="warn">{v.warnings === 1 ? "1 warning" : `${v.warnings} warnings`}</Pill> : <span className="text-ink-3">Nothing</span>),
  },
  { key: "status", fit: true, header: "Status", sort: "status", cell: (v) => <Pill tone={vendorTone(v.status)}>{vendorStatusLabels[v.status]}</Pill> },
];
const PAGE_SIZE = 25;

export function VendorsPage() {
  const qc = useQueryClient();
  const people = usePeople();
  const [url, setUrl] = useUrlState({ q: "", type: "", status: "", owner: "", sort: "name", dir: "asc", page: "1", open: "" });
  const [search, setSearch] = useState(url.q);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => search !== url.q && setUrl({ q: search, page: "1" }), 250);
    return () => clearTimeout(t);
  }, [search, url.q, setUrl]);
  const page = pageNumber(url.page);
  const query = { q: url.q, type: url.type, status: url.status, owner: url.owner, sort: url.sort, dir: url.dir, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: ["vendors", query], queryFn: () => api<Page<Vendor>>("/vendors", { query }), placeholderData: (p) => p });
  const filtered = !!(url.q || url.type || url.status || url.owner);
  const total = list.data?.total;

  return (
    <>
      <PageHeader
        context={total === undefined || list.isPlaceholderData ? " " : `${total} ${total === 1 ? "vendor" : "vendors"}${url.status ? "" : ", not counting offboarded ones"}`}
        title="Vendors"
      >
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add vendor
        </Button>
      </PageHeader>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" htmlFor="vendors-q">
          <TextInput id="vendors-q" type="search" placeholder="Vendor name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-60" />
        </Field>
        <Field label="Type" htmlFor="vendors-type">
          <Select id="vendors-type" value={url.type} onChange={(e) => setUrl({ type: e.target.value, page: "1" })}>
            <option value="">Any type</option>
            {vendorTypes.map((t) => (
              <option key={t} value={t}>
                {vendorTypeLabels[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor="vendors-status">
          <Select id="vendors-status" value={url.status} onChange={(e) => setUrl({ status: e.target.value, page: "1" })}>
            <option value="">All but offboarded</option>
            {vendorStatuses.map((s) => (
              <option key={s} value={s}>
                {vendorStatusLabels[s]}
              </option>
            ))}
            <option value="all">Everything</option>
          </Select>
        </Field>
        <Field label="Owner" htmlFor="vendors-owner">
          <Select id="vendors-owner" value={url.owner} onChange={(e) => setUrl({ owner: e.target.value, page: "1" })}>
            <option value="">Anyone</option>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState message={messageOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 && !url.open ? (
        <EmptyState
          title={filtered ? "No vendors match these filters" : "No vendors yet"}
          action={
            !filtered && (
              <Button variant="primary" onClick={() => setAdding(true)}>
                Add the first vendor
              </Button>
            )
          }
        >
          {filtered
            ? "Clear the search or the filters to see every vendor."
            : "Every software vendor, consultancy and advisory firm the team works with belongs here, each with its owner, contacts and paperwork."}
        </EmptyState>
      ) : (
        <SplitView
          open={!!url.open}
          list={
            <>
              <DataTable
                label="Vendors"
                rows={list.data.items}
                columns={columns}
                rowId={(v) => v.id}
                rowLabel={(v) => v.name}
                sort={url.sort}
                dir={url.dir}
                onSort={(sort, dir) => setUrl({ sort, dir, page: "1" })}
                onOpen={(v) => setUrl({ open: v.id }, { push: !url.open })}
                selectedId={url.open}
                compact={!!url.open}
              />
              <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setUrl({ page: String(p) })} />
            </>
          }
          panel={url.open && <VendorPanel key={url.open} id={url.open} onClose={() => setUrl({ open: "" })} />}
        />
      )}
      {adding && (
        <VendorForm
          onClose={() => setAdding(false)}
          onSaved={async (v) => {
            setAdding(false);
            toast.success(`Added ${v.name}`);
            await qc.invalidateQueries();
            setUrl({ open: v.id }, { push: true });
          }}
        />
      )}
    </>
  );
}
