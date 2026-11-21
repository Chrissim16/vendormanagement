import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AuditEntry, Page } from "../../../../shared/types";
import { api, messageOf } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { pageNumber, useUrlState } from "../../lib/useUrlState";
import { DataTable, Pager, type Column } from "../../platform/DataTable";
import { describeChanges } from "../../platform/History";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Select, TextInput } from "../../platform/ui";

const verbs: Record<string, string> = { create: "Added", update: "Changed", delete: "Removed", import: "Imported", revert: "Reverted" };
const columns: Column<AuditEntry>[] = [
  { key: "at", header: "When", cell: (e) => <span className="num">{formatDateTime(e.at)}</span>, className: "w-[18%]" },
  { key: "who", header: "Who", cell: (e) => e.userEmail, className: "w-[22%]" },
  { key: "what", header: "What", cell: (e) => `${verbs[e.action] ?? e.action} ${e.entityType}${e.summary ? ` ${e.summary}` : ""}`, className: "w-[28%]" },
  { key: "changes", header: "Details", cell: (e) => <span className="text-ink-2">{describeChanges(e) || "–"}</span> },
];
const PAGE_SIZE = 50;

export function AuditPage() {
  const [url, setUrl] = useUrlState({ user: "", entityType: "", from: "", to: "", page: "1" });
  const [who, setWho] = useState(url.user);
  useEffect(() => {
    const t = setTimeout(() => who !== url.user && setUrl({ user: who, page: "1" }), 250);
    return () => clearTimeout(t);
  }, [who, url.user, setUrl]);
  const query = { ...url, page: pageNumber(url.page), pageSize: PAGE_SIZE };
  const log = useQuery({ queryKey: ["audit", query], queryFn: () => api<Page<AuditEntry> & { entityTypes: string[] }>("/admin/audit", { query }), placeholderData: (p) => p });
  const filtered = !!(url.user || url.entityType || url.from || url.to);

  return (
    <>
      <PageHeader context={log.data ? `${log.data.total} ${log.data.total === 1 ? "entry" : "entries"}` : " "} title="Audit log" />
      <p className="-mt-6 max-w-[62ch] text-ink-2">Every change made in the app, newest first. Entries cannot be edited or removed.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Person" htmlFor="audit-user">
          <TextInput id="audit-user" type="search" placeholder="Email" value={who} onChange={(e) => setWho(e.target.value)} className="w-56" />
        </Field>
        <Field label="Record type" htmlFor="audit-type">
          <Select id="audit-type" value={url.entityType} onChange={(e) => setUrl({ entityType: e.target.value, page: "1" })}>
            <option value="">Any type</option>
            {log.data?.entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" htmlFor="audit-from">
          <TextInput id="audit-from" type="date" value={url.from} onChange={(e) => setUrl({ from: e.target.value, page: "1" })} />
        </Field>
        <Field label="To" htmlFor="audit-to">
          <TextInput id="audit-to" type="date" value={url.to} onChange={(e) => setUrl({ to: e.target.value, page: "1" })} />
        </Field>
      </div>
      {log.isPending ? (
        <Loading />
      ) : log.isError ? (
        <ErrorState message={messageOf(log.error)} onRetry={() => void log.refetch()} />
      ) : log.data.items.length === 0 ? (
        <EmptyState title={filtered ? "No entries match these filters" : "Nothing has been changed yet"}>
          {filtered ? "Widen the dates or clear the filters." : "Every time someone adds, changes or removes a record, it is listed here."}
        </EmptyState>
      ) : (
        <div>
          <DataTable label="Audit log" rows={log.data.items} columns={columns} rowId={(e) => e.id} rowLabel={(e) => e.summary ?? e.entityId} />
          <Pager page={pageNumber(url.page)} pageSize={PAGE_SIZE} total={log.data.total} onPage={(p) => setUrl({ page: String(p) })} />
        </div>
      )}
    </>
  );
}
