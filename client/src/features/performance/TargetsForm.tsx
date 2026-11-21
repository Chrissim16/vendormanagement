import { formatMetric, metricInfo, metricKeys, parseTarget, type MetricKey, type Targets } from "../../../../shared/performance";
import { api } from "../../lib/api";
import { Dialog } from "../../platform/Dialog";
import { FormFooter, TextField, useForm } from "../../platform/form";

const units: Record<MetricKey, string> = {
  first_response: "% answered in time, at least",
  first_line: "% solved by the first line, at least",
  sla_breaches: "% resolved late, at most",
  backlog_age: "days the oldest open ticket may be, at most",
  csat: "average rating out of 5, at least",
};
const examples: Record<MetricKey, string> = { first_response: "95", first_line: "65", sla_breaches: "5", backlog_age: "30", csat: "4.0" };
const typed = (key: MetricKey, tenths: number | null) => (tenths == null ? "" : formatMetric(key, tenths).replace(/[^\d.]/g, ""));

/** The targets from a vendor's contract, one per metric (J-4). An empty box means no target. */
export function TargetsForm({
  vendorId,
  vendorName,
  targets,
  onClose,
  onSaved,
}: {
  vendorId: string;
  vendorName: string;
  targets: Targets;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useForm(
    Object.fromEntries(metricKeys.map((k) => [k, typed(k, targets[k])])) as Record<MetricKey, string>,
    (v) => api<Targets>(`/performance/vendors/${vendorId}/targets`, { method: "PUT", body: Object.fromEntries(metricKeys.map((k) => [k, parseTarget(k, v[k]) ?? null])) }),
    {
      onSaved,
      check: (v) =>
        Object.fromEntries(
          metricKeys.map((k) => [
            k,
            parseTarget(k, v[k]) === null ? `Enter a number up to ${metricInfo[k].max}, with at most one decimal, such as ${examples[k]}. Leave empty for no target.` : "",
          ]),
        ),
    },
  );
  return (
    <Dialog title={`Targets for ${vendorName}`} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <p className="-mt-2 text-ink-2">Take these from the contract. Each month is then marked met or missed. Leave a box empty where the contract sets no target.</p>
        {metricKeys.map((k, i) => (
          <TextField
            key={k}
            form={form}
            name={k}
            label={`${metricInfo[k].label}: ${units[k]}`}
            inputMode="decimal"
            placeholder={examples[k]}
            value={form.values[k]}
            onChange={(e) => form.set(k, e.target.value)}
            autoFocus={i === 0}
            className="max-w-[160px]"
          />
        ))}
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Save targets" onCancel={onClose} />
      </form>
    </Dialog>
  );
}
