import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { addQuarter, formatScore, quarterName, quarterOf, type Scorecard, type ScorecardDetail } from "../../../../shared/scorecards";
import type { Page } from "../../../../shared/types";
import type { Vendor } from "../../../../shared/vendors";
import { api, messageOf } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { pageNumber, useUrlState } from "../../lib/useUrlState";
import { DataTable, Pager, type Column } from "../../platform/DataTable";
import { Dialog } from "../../platform/Dialog";
import { FormFooter, SelectField, useForm } from "../../platform/form";
import { useToday } from "../../platform/session";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, Pill, Segmented, TextInput } from "../../platform/ui";
import { PerformanceTabs } from "./parts";

const PAGE_SIZE = 50;

const columns: Column<Scorecard>[] = [
  { key: "vendor", header: "Vendor", sort: "vendor", cell: (c) => c.vendorName },
  { key: "quarter", header: "Quarter", sort: "quarter", fit: true, cell: (c) => <span className="num">{quarterName(c.quarter)}</span> },
  { key: "status", header: "Status", sort: "status", fit: true, cell: (c) => (c.status === "final" ? <Pill tone="ok">Final</Pill> : <Pill>Draft</Pill>) },
  {
    key: "overall",
    header: "Overall",
    fit: true,
    className: "text-right",
    cell: (c) =>
      c.status === "final" ? (
        <span className="num font-semibold">{formatScore(c.overallTenths)}</span>
      ) : (
        <span className="num text-ink-2">
          {c.scored} of {c.criteria} scored
        </span>
      ),
  },
  { key: "reviewer", header: "Reviewer", fit: true, cell: (c) => c.reviewerName },
  { key: "updated", header: "Last change", sort: "updated", fit: true, cell: (c) => <span className="num">{formatDate(c.updatedAt)}</span> },
];

/** Choose a vendor and a quarter; the person who starts the scorecard is its reviewer. */
function StartScorecard({ vendorId, onClose, onStarted }: { vendorId: string; onClose: () => void; onStarted: (c: ScorecardDetail) => void }) {
  const today = useToday();
  const thisQuarter = quarterOf(today);
  const vendors = useQuery({
    queryKey: ["vendors", "scored"],
    queryFn: async () =>
      (await api<Page<Vendor>>("/vendors", { query: { status: "all", pageSize: 200, sort: "name" } })).items.filter((v) => v.scoringEnabled && v.status !== "offboarded"),
  });
  const form = useForm({ vendorId, quarter: addQuarter(thisQuarter, -1) }, (v) => api<ScorecardDetail>("/scorecards", { body: v }), {
    onSaved: onStarted,
    check: (v) => ({ vendorId: v.vendorId ? "" : "Choose a vendor." }),
  });
  return (
    <Dialog title="Start a scorecard" onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <p className="-mt-2 text-ink-2">
          A scorecard covers one vendor for one quarter. Criteria measured from Jira come with a suggestion from the AI's monthly proposals; you decide every score.
        </p>
        {vendors.isError && <ErrorState message={messageOf(vendors.error)} onRetry={() => void vendors.refetch()} />}
        <SelectField form={form} name="vendorId" label="Vendor" value={form.values.vendorId} onChange={(e) => form.set("vendorId", e.target.value)}>
          <option value="">{vendors.isPending ? "Loading vendors" : "Choose a vendor"}</option>
          {vendors.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </SelectField>
        <SelectField form={form} name="quarter" label="Quarter" value={form.values.quarter} onChange={(e) => form.set("quarter", e.target.value)}>
          {Array.from({ length: 8 }, (_, i) => addQuarter(thisQuarter, -i)).map((q) => (
            <option key={q} value={q}>
              {quarterName(q)}
              {q === thisQuarter ? " (still running, finalised after it ends)" : ""}
            </option>
          ))}
        </SelectField>
        <p className="text-[13px] text-ink-2">Vendors with scoring switched off are not listed: they have no scorecards.</p>
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Start scorecard" onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Every scorecard, newest quarter first (P-2 to P-5). */
export function ScorecardsPage() {
  const navigate = useNavigate();
  // `start` names a vendor to start a scorecard for straight away: the dashboard's "not started" rows lead here.
  const [url, setUrl] = useUrlState({ q: "", status: "all", vendorId: "", sort: "quarter", dir: "desc", page: "1", start: "" });
  const [starting, setStarting] = useState(!!url.start);
  const page = pageNumber(url.page);
  const query = { q: url.q, status: url.status === "all" ? undefined : url.status, vendorId: url.vendorId || undefined, sort: url.sort, dir: url.dir, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: ["scorecard", "list", query], queryFn: () => api<Page<Scorecard>>("/scorecards", { query }), placeholderData: (p) => p });
  const filtered = !!(url.q || url.status !== "all" || url.vendorId);
  const total = list.data?.total ?? 0;
  const start = (
    <Button variant="primary" onClick={() => setStarting(true)}>
      Start a scorecard
    </Button>
  );
  return (
    <>
      <PageHeader context={list.data ? `${total} ${total === 1 ? "scorecard" : "scorecards"}${filtered ? " with these filters" : ""}` : " "} title="Performance">
        <Link
          to="/performance/scorecards/criteria"
          className="inline-flex h-[38px] items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-semibold hover:bg-sunk"
        >
          Criteria
        </Link>
        {start}
      </PageHeader>
      <PerformanceTabs />

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Search by vendor" htmlFor="scorecard-search">
          <TextInput
            id="scorecard-search"
            type="search"
            value={url.q}
            placeholder="Vendor name"
            maxLength={200}
            onChange={(e) => setUrl({ q: e.target.value, page: "1" })}
            className="w-[260px]"
          />
        </Field>
        <Segmented
          label="Status"
          value={url.status}
          onChange={(status) => setUrl({ status, page: "1" })}
          options={[
            { value: "all", label: "All" },
            { value: "draft", label: "Draft" },
            { value: "final", label: "Final" },
          ]}
        />
        {url.vendorId && <Button onClick={() => setUrl({ vendorId: "", page: "1" })}>Show all vendors</Button>}
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState message={messageOf(list.error)} onRetry={() => void list.refetch()} />
      ) : total === 0 ? (
        filtered ? (
          <EmptyState title="No scorecards match" action={<Button onClick={() => setUrl({ q: "", status: "all", vendorId: "", page: "1" })}>Clear filters</Button>}>
            Nothing fits this search and these filters. A vendor's first scorecard is started with the button above.
          </EmptyState>
        ) : (
          <EmptyState title="No scorecards yet" action={start}>
            Each quarter a vendor gets a scorecard: a score from 1 to 5 on every criterion, a comment for the vendor and a note for the team. Once final it can be sent to the
            vendor as a PDF.
          </EmptyState>
        )
      ) : (
        <>
          <DataTable
            label="Scorecards"
            rows={list.data.items}
            columns={columns}
            rowId={(c) => c.id}
            rowLabel={(c) => `${c.vendorName} ${quarterName(c.quarter)}`}
            sort={url.sort}
            dir={url.dir}
            onSort={(sort, dir) => setUrl({ sort, dir, page: "1" })}
            onOpen={(c) => navigate(`/performance/scorecards/${c.id}`)}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setUrl({ page: String(p) }, { push: true })} />
        </>
      )}

      {starting && (
        <StartScorecard
          vendorId={url.start || url.vendorId}
          onClose={() => {
            setStarting(false);
            setUrl({ start: "" });
          }}
          onStarted={(c) => {
            toast.success(`Scorecard started for ${c.vendorName}`);
            navigate(`/performance/scorecards/${c.id}`);
          }}
        />
      )}
    </>
  );
}
