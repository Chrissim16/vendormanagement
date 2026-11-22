import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { amountForInput, formatMoney, parseAmount } from "../../../../shared/money";
import { CurrencyOptions } from "../../platform/Money";
import { contentEditable, contentLocked, type RfpDetail, type RfpRow } from "../../../../shared/rfp";
import type { Page } from "../../../../shared/types";
import { api } from "../../lib/api";
import { personName, usePeople } from "../../lib/data";
import { formatDate } from "../../lib/format";
import { pageNumber, useUrlState } from "../../lib/useUrlState";
import { DataTable, Pager, type Column } from "../../platform/DataTable";
import { Dialog } from "../../platform/Dialog";
import { FormFooter, Grid, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { useMe, useToday } from "../../platform/session";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, Segmented, TextInput } from "../../platform/ui";
import { messageOf } from "../../lib/api";
import { StagePill } from "./parts";

const PAGE_SIZE = 50;

const columns: Column<RfpRow>[] = [
  { key: "title", header: "RFP", sort: "title", cell: (r) => r.title },
  { key: "stage", header: "Stage", sort: "stage", fit: true, cell: (r) => <StagePill stage={r.stage} /> },
  { key: "owner", header: "Owner", sort: "owner", fit: true, cell: (r) => r.ownerName },
  {
    key: "target",
    header: "Decision wanted by",
    sort: "target",
    fit: true,
    cell: (r) => (r.targetDecisionDate ? <span className="num">{formatDate(r.targetDecisionDate)}</span> : <span className="text-ink-2">Not set</span>),
  },
  {
    key: "candidates",
    header: "Candidates",
    fit: true,
    cell: (r) => (r.winnerName ? `Won by ${r.winnerName}` : <span className="num">{r.candidates === 0 ? "None yet" : r.candidates}</span>),
  },
  { key: "updated", header: "Last change", sort: "updated", fit: true, cell: (r) => <span className="num">{formatDate(r.updatedAt)}</span> },
];

const AMOUNT = "Enter an amount such as 12500 or 12,500.00.";
const PERCENT = "Enter a whole number from 0 to 100.";

/** Q-1: the approved demand. The same form changes it later. */
export function DemandForm({ rfp, onClose, onSaved }: { rfp?: RfpDetail; onClose: () => void; onSaved: (r: RfpDetail) => void }) {
  const me = useMe();
  const today = useToday();
  const people = usePeople();
  const weightsLocked = !!rfp && !contentEditable(rfp.stage);
  const form = useForm(
    {
      title: rfp?.title ?? "",
      need: rfp?.need ?? "",
      budget: amountForInput(rfp?.budgetMinor),
      currency: rfp?.currency ?? "EUR",
      sponsor: rfp?.sponsor ?? "",
      demandApprovedOn: rfp?.demandApprovedOn ?? "",
      targetDecisionDate: rfp?.targetDecisionDate ?? "",
      ownerUserId: rfp?.ownerUserId ?? me.id,
      writtenWeight: String(rfp?.writtenWeight ?? 70),
      demoWeight: String(rfp?.demoWeight ?? 30),
    },
    (v) => {
      const { budget, writtenWeight, demoWeight, ...rest } = v;
      const body = {
        ...rest,
        budgetMinor: budget ? parseAmount(budget, v.currency) : null,
        ...(weightsLocked ? {} : { writtenWeight: Number(writtenWeight), demoWeight: Number(demoWeight) }),
      };
      return api<RfpDetail>(rfp ? `/rfps/${rfp.id}` : "/rfps", { method: rfp ? "PATCH" : "POST", body });
    },
    {
      onSaved,
      check: (v) => {
        const pct = (s: string) => /^\d{1,3}$/.test(s) && Number(s) <= 100;
        const sum = Number(v.writtenWeight) + Number(v.demoWeight);
        return {
          title: v.title.trim() ? "" : "Give the RFP a title.",
          need: v.need.trim() ? "" : "Describe what is needed.",
          budget: v.budget && parseAmount(v.budget, v.currency) == null ? AMOUNT : "",
          demandApprovedOn: v.demandApprovedOn && v.demandApprovedOn > today && v.demandApprovedOn !== rfp?.demandApprovedOn ? "The approval date cannot be in the future." : "",
          writtenWeight: pct(v.writtenWeight) ? "" : PERCENT,
          demoWeight: !pct(v.demoWeight) ? PERCENT : pct(v.writtenWeight) && sum !== 100 ? `The two parts must add up to 100. They now add up to ${sum}.` : "",
        };
      },
    },
  );
  const { values: v, set } = form;
  const minor = v.budget ? parseAmount(v.budget, v.currency) : null;
  // A person who no longer has access is not in the list, but must still show as the current owner.
  const owners = [...(people.data ?? [])];
  if (rfp && !owners.some((p) => p.id === rfp.ownerUserId)) owners.push({ id: rfp.ownerUserId, email: rfp.ownerName, displayName: rfp.ownerName });
  return (
    <Dialog title={rfp ? "Change the demand" : "New RFP"} onClose={onClose} wide>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        {!rfp && <p className="-mt-2 text-ink-2">Record the demand as it was approved. The RFP starts in drafting; sections, criteria and questions come next.</p>}
        <TextField
          form={form}
          name="title"
          label="Title"
          value={v.title}
          maxLength={200}
          onChange={(e) => set("title", e.target.value)}
          placeholder="What is being bought, in a few words"
        />
        <TextAreaField
          form={form}
          name="need"
          label="The need"
          rows={5}
          value={v.need}
          maxLength={5000}
          onChange={(e) => set("need", e.target.value)}
          placeholder="What is needed and why. The AI drafts the RFP from this."
        />
        <Grid>
          <TextField
            form={form}
            name="budget"
            label="Budget"
            inputMode="decimal"
            value={v.budget}
            onChange={(e) => set("budget", e.target.value, ["budgetMinor"])}
            hint={minor == null ? "Stays inside the team; it is never put in the RFP." : `Read as ${formatMoney(minor, v.currency)}`}
          />
          <SelectField form={form} name="currency" label="Currency" value={v.currency} onChange={(e) => set("currency", e.target.value)}>
            <CurrencyOptions value={v.currency} />
          </SelectField>
          <TextField form={form} name="sponsor" label="Sponsor" value={v.sponsor} maxLength={200} onChange={(e) => set("sponsor", e.target.value)} placeholder="Who asked for it" />
          <SelectField form={form} name="ownerUserId" label="Owner" value={v.ownerUserId} onChange={(e) => set("ownerUserId", e.target.value)}>
            {owners.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </SelectField>
          <TextField
            form={form}
            name="demandApprovedOn"
            label="Demand approved on"
            type="date"
            max={today}
            value={v.demandApprovedOn}
            onChange={(e) => set("demandApprovedOn", e.target.value)}
          />
          <TextField
            form={form}
            name="targetDecisionDate"
            label="Decision wanted by"
            type="date"
            value={v.targetDecisionDate}
            onChange={(e) => set("targetDecisionDate", e.target.value)}
          />
          {!weightsLocked && (
            <>
              <TextField
                form={form}
                name="writtenWeight"
                label="Written answers count for (%)"
                inputMode="numeric"
                value={v.writtenWeight}
                onChange={(e) => set("writtenWeight", e.target.value)}
              />
              <TextField
                form={form}
                name="demoWeight"
                label="Demo and interview count for (%)"
                inputMode="numeric"
                value={v.demoWeight}
                onChange={(e) => set("demoWeight", e.target.value)}
                hint="Together 100. Set this to 0 when there is no demo."
              />
            </>
          )}
        </Grid>
        {weightsLocked && (
          <p className="text-[13px] text-ink-2">
            Written answers count for {rfp.writtenWeight}% and demo and interview for {rfp.demoWeight}%.{" "}
            {contentLocked(rfp.stage) ? "That is fixed now that the RFP has been issued." : "To change that, take the RFP back to drafting first; it then needs approving again."}
          </p>
        )}
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={rfp ? "Save demand" : "Create RFP"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Q-11: every RFP with its stage, owner and target date. */
export function RfpsPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useUrlState({ q: "", stage: "open", sort: "target", dir: "asc", page: "1" });
  const [adding, setAdding] = useState(false);
  const page = pageNumber(url.page);
  const query = { q: url.q, stage: url.stage === "all" ? undefined : url.stage, sort: url.sort, dir: url.dir, page, pageSize: PAGE_SIZE };
  const list = useQuery({ queryKey: ["rfps", query], queryFn: () => api<Page<RfpRow>>("/rfps", { query }), placeholderData: (p) => p });
  const filtered = !!url.q || url.stage !== "open";
  const total = list.data?.total ?? 0;
  const add = (
    <Button variant="primary" onClick={() => setAdding(true)}>
      New RFP
    </Button>
  );
  const what = url.stage === "open" ? "running " : "";
  return (
    <>
      <PageHeader context={list.data ? `${total} ${what}${total === 1 ? "RFP" : "RFPs"}${url.q ? " matching the search" : ""}` : " "} title="RFPs">
        {add}
      </PageHeader>

      <div className="flex flex-wrap items-end gap-4">
        <Field label="Search by title" htmlFor="rfp-search">
          <TextInput
            id="rfp-search"
            type="search"
            value={url.q}
            placeholder="RFP title"
            maxLength={200}
            onChange={(e) => setUrl({ q: e.target.value, page: "1" })}
            className="w-[260px]"
          />
        </Field>
        <Segmented
          label="Show"
          value={url.stage}
          onChange={(stage) => setUrl({ stage, page: "1" })}
          options={[
            { value: "open", label: "Running" },
            { value: "decided", label: "Decided" },
            { value: "cancelled", label: "Cancelled" },
            { value: "all", label: "All" },
          ]}
        />
      </div>

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <ErrorState message={messageOf(list.error)} onRetry={() => void list.refetch()} />
      ) : total === 0 ? (
        filtered ? (
          <EmptyState title="No RFPs match" action={<Button onClick={() => setUrl({ q: "", stage: "open", page: "1" })}>Clear filters</Button>}>
            Nothing fits this search and this choice. Running RFPs are shown when the filters are cleared.
          </EmptyState>
        ) : (
          <EmptyState title="No RFP is running" action={add}>
            An RFP is followed here from the approved demand through drafting, review, candidates, answers and scoring to the decision. Start with the demand: what is needed, the
            budget, the sponsor and when a decision is wanted.
          </EmptyState>
        )
      ) : (
        <>
          <DataTable
            label="RFPs"
            rows={list.data.items}
            columns={columns}
            rowId={(r) => r.id}
            rowLabel={(r) => r.title}
            sort={url.sort}
            dir={url.dir}
            onSort={(sort, dir) => setUrl({ sort, dir, page: "1" })}
            onOpen={(r) => navigate(`/rfps/${r.id}`)}
          />
          <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={(p) => setUrl({ page: String(p) }, { push: true })} />
        </>
      )}

      {adding && (
        <DemandForm
          onClose={() => setAdding(false)}
          onSaved={(r) => {
            toast.success("RFP created");
            navigate(`/rfps/${r.id}`);
          }}
        />
      )}
    </>
  );
}
