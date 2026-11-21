import { decisions, nextTermEnd, type Agreement, type AgreementDetail, type Decision } from "../../../../shared/agreements";
import { formatDay } from "../../../../shared/dates";
import { api } from "../../lib/api";
import { Dialog } from "../../platform/Dialog";
import { CheckField, FormFooter, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";

const labels: Record<Decision, string> = { renew: "Renew", renegotiate: "Renegotiate", terminate: "Terminate" };

/** Records what was decided about a subscription's renewal (A-6). `today` comes from the server's calendar. */
export function DecisionDialog({ agreement: a, today, onClose, onSaved }: { agreement: Agreement; today: string; onClose: () => void; onSaved: (a: AgreementDetail) => void }) {
  const form = useForm(
    { decision: "renew" as Decision, decidedOn: today, notes: "", rollForward: true },
    (v) => api<AgreementDetail>(`/agreements/${a.id}/decisions`, { body: { ...v, rollForward: v.decision === "renew" && v.rollForward } }),
    { onSaved },
  );
  const { values: v, set } = form;
  return (
    <Dialog title={`Renewal decision for ${a.title}`} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <p className="text-ink-2">
          {a.vendorName}. The current term ends on {formatDay(a.endDate!)}.
        </p>
        <SelectField form={form} name="decision" label="Decision" value={v.decision} onChange={(e) => set("decision", e.target.value as Decision)} autoFocus>
          {decisions.map((d) => (
            <option key={d} value={d}>
              {labels[d]}
            </option>
          ))}
        </SelectField>
        <TextField form={form} name="decidedOn" label="Decided on" type="date" value={v.decidedOn} onChange={(e) => set("decidedOn", e.target.value)} />
        {v.decision === "renew" && (
          <CheckField
            id="f-rollForward"
            label={`Move the renewal date to ${formatDay(nextTermEnd(a.endDate!, a.renewalTermMonths))}`}
            hint={`That is the next term of ${a.renewalTermMonths ?? 12} months.`}
            checked={v.rollForward}
            onChange={(x) => set("rollForward", x)}
          />
        )}
        <TextAreaField form={form} name="notes" label="Notes (optional)" value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Record decision" onCancel={onClose} />
      </form>
    </Dialog>
  );
}
