import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { metricInfo, metricKeys, type MetricKey } from "../../../../shared/performance";
import { checkCriterion, sourceLabels, type Criterion, type CriterionSource } from "../../../../shared/scorecards";
import { api, messageOf } from "../../lib/api";
import { DataTable, type Column } from "../../platform/DataTable";
import { Dialog } from "../../platform/Dialog";
import { CheckField, FormFooter, Grid, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { History } from "../../platform/History";
import { useMe } from "../../platform/session";
import { Button, ErrorState, Loading, PageHeader, Pill } from "../../platform/ui";

/** Add a criterion, or change its name, description, weight and whether it is in use (P-7). */
function CriterionForm({ criterion, onClose, onSaved }: { criterion: Criterion | null; onClose: () => void; onSaved: (c: Criterion) => void }) {
  const form = useForm(
    {
      name: criterion?.name ?? "",
      description: criterion?.description ?? "",
      weight: String(criterion?.weight ?? 20),
      source: (criterion?.source ?? "manual") as CriterionSource,
      metrics: (criterion?.metrics ?? []) as MetricKey[],
      active: criterion?.active ?? true,
    },
    (v) =>
      api<Criterion>(criterion ? `/admin/scorecard-criteria/${criterion.id}` : "/admin/scorecard-criteria", {
        method: criterion ? "PUT" : "POST",
        body: { ...v, weight: Number(v.weight), metrics: v.source === "measured" ? v.metrics : [] },
      }),
    {
      onSaved,
      check: (v) => ({
        name: v.name.trim() ? "" : "Give the criterion a name.",
        weight: /^\d{1,3}$/.test(v.weight.trim()) && Number(v.weight) >= 1 && Number(v.weight) <= 100 ? "" : "Enter a whole number from 1 to 100.",
        metrics: checkCriterion(v).metrics ?? "",
      }),
    },
  );
  const v = form.values;
  return (
    <Dialog title={criterion ? `Edit ${criterion.name}` : "Add a criterion"} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <p className="-mt-2 text-ink-2">Changes apply to draft scorecards and to new ones. Scorecards that are final keep the criteria and weights they were finalised with.</p>
        <TextField form={form} name="name" label="Name" value={v.name} maxLength={80} onChange={(e) => form.set("name", e.target.value)} />
        <TextAreaField form={form} name="description" label="What it looks at" value={v.description} maxLength={400} onChange={(e) => form.set("description", e.target.value)} />
        <Grid>
          <TextField
            form={form}
            name="weight"
            label="Weight, 1 to 100"
            inputMode="numeric"
            value={v.weight}
            onChange={(e) => form.set("weight", e.target.value)}
            hint="Compared with the other weights: 40 counts twice as much as 20."
          />
          <SelectField
            form={form}
            name="source"
            label="Scored by"
            value={v.source}
            disabled={!!criterion}
            onChange={(e) => form.patch({ source: e.target.value as CriterionSource, metrics: [] })}
          >
            <option value="manual">The reviewer</option>
            <option value="measured">Figures from Jira, with an AI suggestion</option>
          </SelectField>
        </Grid>
        {criterion && <p className="-mt-2 text-[13px] text-ink-2">How a criterion is scored cannot be changed afterwards. Switch this one off and add a new one instead.</p>}
        {v.source === "measured" && (
          <fieldset className="flex flex-col gap-2.5" aria-describedby={form.errors.metrics ? "f-metrics-error" : undefined}>
            <legend className="mb-2 text-[12.5px] font-medium text-ink-2">Helpdesk figures the AI judges it from</legend>
            {metricKeys.map((k) => (
              <CheckField
                key={k}
                id={`metric-${k}`}
                label={metricInfo[k].label}
                hint={metricInfo[k].measures}
                checked={v.metrics.includes(k)}
                onChange={(on) => form.set("metrics", on ? [...v.metrics, k] : v.metrics.filter((m) => m !== k))}
              />
            ))}
            {form.errors.metrics && (
              <p id="f-metrics-error" className="text-[12.5px] font-medium text-[var(--crit-text)]">
                {form.errors.metrics}
              </p>
            )}
          </fieldset>
        )}
        <CheckField
          id="criterion-active"
          label="In use"
          hint="Switched off, it no longer appears on draft and new scorecards. It can be switched on again."
          checked={v.active}
          onChange={(on) => form.set("active", on)}
        />
        {form.errors.active && <p className="-mt-3 text-[12.5px] font-medium text-[var(--crit-text)]">{form.errors.active}</p>}
        {form.errors.source && <p className="-mt-3 text-[12.5px] font-medium text-[var(--crit-text)]">{form.errors.source}</p>}
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={criterion ? "Save criterion" : "Add criterion"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** What vendors are scored on, and how much each criterion counts (P-7). Everyone can read it; an admin changes it. */
export function CriteriaPage() {
  const admin = useMe().role === "admin";
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Criterion | "new" | null>(null);
  const q = useQuery({ queryKey: ["scorecard", "criteria"], queryFn: () => api<Criterion[]>("/scorecard-criteria") });
  const total = q.data?.filter((c) => c.active).reduce((n, c) => n + c.weight, 0) ?? 0;
  const columns: Column<Criterion>[] = [
    { key: "name", header: "Criterion", className: "w-[22%]", cell: (c) => c.name },
    { key: "description", header: "What it looks at", cell: (c) => <span className="text-ink-2">{c.description ?? ""}</span> },
    {
      key: "source",
      header: "Scored by",
      className: "w-[24%] whitespace-normal",
      cell: (c) => (
        <span className="flex flex-col">
          <span>{sourceLabels[c.source]}</span>
          {c.metrics.length > 0 && <span className="text-[13px] text-ink-2">{c.metrics.map((k) => metricInfo[k].label).join(", ")}</span>}
        </span>
      ),
    },
    { key: "weight", header: "Weight", fit: true, className: "text-right", cell: (c) => <span className="num">{c.weight}</span> },
    {
      key: "share",
      header: "Share of overall",
      fit: true,
      className: "text-right",
      cell: (c) => <span className="num">{c.active && total ? `${Math.round((c.weight * 100) / total)}%` : "–"}</span>,
    },
    { key: "active", header: "In use", fit: true, cell: (c) => (c.active ? <Pill tone="ok">In use</Pill> : <Pill>Switched off</Pill>) },
  ];
  return (
    <>
      <PageHeader
        context={
          <>
            <Link to="/performance/scorecards" className="underline-offset-2 hover:underline">
              Scorecards
            </Link>
            {q.data ? ` · ${q.data.filter((c) => c.active).length} in use` : ""}
          </>
        }
        title="Scorecard criteria"
      >
        {admin && (
          <Button variant="primary" onClick={() => setEditing("new")}>
            Add a criterion
          </Button>
        )}
      </PageHeader>
      <p className="max-w-[72ch] text-ink-2">
        Every scorecard scores a vendor from 1 to 5 on each criterion in use. The overall score is their average, weighted as shown.
        {admin ? " Open a criterion to change it." : " Changing the criteria is done by an admin."}
      </p>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <DataTable label="Scorecard criteria" rows={q.data} columns={columns} rowId={(c) => c.id} rowLabel={(c) => c.name} onOpen={admin ? (c) => setEditing(c) : undefined} />
      )}
      {editing && (
        <CriterionForm
          criterion={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async (c) => {
            setEditing(null);
            toast.success(editing === "new" ? `${c.name} added` : `${c.name} saved`);
            await qc.invalidateQueries();
          }}
        />
      )}
      {q.data && admin && (
        <div className="flex max-w-[720px] flex-col gap-6">
          {q.data.map((c) => (
            <details key={c.id}>
              <summary className="cursor-pointer text-[13px] font-medium text-ink-2">History of {c.name}</summary>
              <div className="pt-3">
                <History entityType="criterion" entityId={c.id} />
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
