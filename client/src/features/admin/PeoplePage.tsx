import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Page, UpdateUser, User } from "../../../../shared/types";
import { api, messageOf } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { useUrlState } from "../../lib/useUrlState";
import { DataTable, Pager, type Column } from "../../platform/DataTable";
import { History } from "../../platform/History";
import { Panel, SplitView } from "../../platform/SplitView";
import { useMe } from "../../platform/session";
import { EmptyState, ErrorState, Field, Loading, PageHeader, Pill, Segmented, Select, TextInput } from "../../platform/ui";

const columns: Column<User>[] = [
  { key: "name", header: "Person", sort: "email", cell: (u) => u.displayName ?? u.email, className: "w-[30%]" },
  { key: "email", header: "Email", cell: (u) => <span className="text-ink-2">{u.email}</span>, className: "w-[30%]" },
  { key: "role", header: "Role", sort: "role", cell: (u) => (u.role === "admin" ? "Admin" : "Member") },
  { key: "active", header: "Access", sort: "active", cell: (u) => <Pill tone={u.active ? "ok" : "warn"}>{u.active ? "Has access" : "Switched off"}</Pill> },
  { key: "createdAt", header: "First seen", sort: "createdAt", cell: (u) => <span className="num text-ink-2">{formatDate(u.createdAt)}</span> },
];

const PAGE_SIZE = 25;

export function PeoplePage() {
  const me = useMe();
  const qc = useQueryClient();
  const [url, setUrl] = useUrlState({ q: "", role: "", active: "", sort: "email", dir: "asc", page: "1", open: "" });
  const [search, setSearch] = useState(url.q);
  useEffect(() => {
    const t = setTimeout(() => search !== url.q && setUrl({ q: search, page: "1" }), 250);
    return () => clearTimeout(t);
  }, [search, url.q, setUrl]);

  const query = { q: url.q, role: url.role, active: url.active, sort: url.sort, dir: url.dir, page: url.page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: ["people", query], queryFn: () => api<Page<User>>("/admin/users", { query }), placeholderData: (prev) => prev });
  const open = list.data?.items.find((u) => u.id === url.open);

  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setProblem(null), [url.open]);
  const change = useMutation({
    mutationFn: (patch: UpdateUser) => api<User>(`/admin/users/${url.open}`, { method: "PATCH", body: patch }),
    onSuccess: async (u) => {
      setProblem(null);
      toast.success(`Saved changes for ${u.displayName ?? u.email}`);
      await qc.invalidateQueries();
    },
    onError: (e) => setProblem(messageOf(e)),
  });

  const filtered = !!(url.q || url.role || url.active);
  return (
    <>
      <PageHeader context={list.data ? `${list.data.total} ${list.data.total === 1 ? "person" : "people"}` : " "} title="People" />
      <p className="-mt-6 max-w-[62ch] text-ink-2">
        Colleagues appear here the first time they open the app. Admins can also manage people, settings and connections; everyone else is a member.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search" htmlFor="people-q">
          <TextInput id="people-q" type="search" placeholder="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        </Field>
        <Field label="Role" htmlFor="people-role">
          <Select id="people-role" value={url.role} onChange={(e) => setUrl({ role: e.target.value, page: "1" })}>
            <option value="">Any role</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </Select>
        </Field>
        <Field label="Access" htmlFor="people-active">
          <Select id="people-active" value={url.active} onChange={(e) => setUrl({ active: e.target.value, page: "1" })}>
            <option value="">Any</option>
            <option value="true">Has access</option>
            <option value="false">Switched off</option>
          </Select>
        </Field>
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState message={messageOf(list.error)} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={filtered ? "Nobody matches these filters" : "Nobody has signed in yet"}>
          {filtered ? "Clear the search or the filters to see everyone." : "People are added automatically the first time they open the app."}
        </EmptyState>
      ) : (
        <SplitView
          open={!!open}
          list={
            <>
              <DataTable
                label="People"
                rows={list.data.items}
                columns={columns}
                rowId={(u) => u.id}
                rowLabel={(u) => u.displayName ?? u.email}
                sort={url.sort}
                dir={url.dir}
                onSort={(sort, dir) => setUrl({ sort, dir, page: "1" })}
                onOpen={(u) => setUrl({ open: u.id })}
                selectedId={url.open}
                compact={!!open}
              />
              <Pager page={Number(url.page)} pageSize={PAGE_SIZE} total={list.data.total} onPage={(p) => setUrl({ page: String(p) })} />
            </>
          }
          panel={
            open && (
              <Panel context={open.email} title={open.displayName ?? open.email} onClose={() => setUrl({ open: "" })}>
                <div className="flex flex-wrap gap-x-10 gap-y-5">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12.5px] font-medium text-ink-2">Role</span>
                    <Segmented
                      label="Role"
                      value={open.role}
                      disabled={change.isPending}
                      onChange={(role) => change.mutate({ role })}
                      options={[
                        { value: "member", label: "Member" },
                        { value: "admin", label: "Admin" },
                      ]}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[12.5px] font-medium text-ink-2">Access</span>
                    <Segmented
                      label="Access"
                      value={open.active ? "on" : "off"}
                      disabled={change.isPending}
                      onChange={(v) => change.mutate({ active: v === "on" })}
                      options={[
                        { value: "on", label: "Has access" },
                        { value: "off", label: "Switched off" },
                      ]}
                    />
                  </div>
                </div>
                {open.id === me.id && <p className="text-[13px] text-ink-2">This is you.</p>}
                {problem && <ErrorState message={problem} />}
                <History entityType="user" entityId={open.id} />
              </Panel>
            )
          }
        />
      )}
    </>
  );
}
