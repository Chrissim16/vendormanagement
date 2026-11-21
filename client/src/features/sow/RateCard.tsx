import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { formatDay } from "../../../../shared/dates";
import { currencies, formatMoney, parseAmount, type Currency } from "../../../../shared/money";
import type { Invoice, RateLine } from "../../../../shared/sow";
import type { Page } from "../../../../shared/types";
import { api, messageOf } from "../../lib/api";
import { Dialog } from "../../platform/Dialog";
import { FormFooter, Grid, SelectField, TextField, useForm } from "../../platform/form";
import { useToday } from "../../platform/session";
import { Button, ConfirmButton, ErrorState, Loading, Pill } from "../../platform/ui";

function RateForm({ vendorId, roles, onClose, onSaved }: { vendorId: string; roles: string[]; onClose: () => void; onSaved: () => void }) {
  const today = useToday();
  const form = useForm(
    { role: "", rate: "", currency: "EUR" as Currency, validFrom: today },
    ({ rate, ...v }) => api<RateLine[]>(`/vendors/${vendorId}/rate-card`, { body: { ...v, dayRateMinor: parseAmount(rate) } }),
    { onSaved, check: (v) => ({ rate: parseAmount(v.rate) == null ? "Enter a day rate like 1,250.00." : "" }) },
  );
  const { values: v, set } = form;
  const shown = { errors: { ...form.errors, rate: form.errors.rate || form.errors.dayRateMinor || "" } };
  const minor = v.rate ? parseAmount(v.rate) : null;
  return (
    <Dialog title="Add day rate" onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <TextField form={shown} name="role" label="Role" list="rate-roles" placeholder="Lead architect" value={v.role} onChange={(e) => set("role", e.target.value)} autoFocus />
        <datalist id="rate-roles">
          {roles.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <Grid>
          <TextField
            form={shown}
            name="rate"
            label="Rate per day"
            inputMode="decimal"
            placeholder="1,250.00"
            value={v.rate}
            onChange={(e) => set("rate", e.target.value, ["dayRateMinor"])}
            hint={minor == null ? undefined : `Read as ${formatMoney(minor, v.currency)} a day`}
          />
          <SelectField form={shown} name="currency" label="Currency" value={v.currency} onChange={(e) => set("currency", e.target.value as Currency)}>
            {currencies.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
          <TextField form={shown} name="validFrom" label="Applies from" type="date" value={v.validFrom} onChange={(e) => set("validFrom", e.target.value)} />
        </Grid>
        <p className="text-[13px] text-ink-2">To change a rate, add the new rate with the date it starts. The old one stays on record.</p>
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Add rate" onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** The Money tab of a vendor's panel: what has been invoiced, and the day rates per role (M-3). */
export function VendorMoney({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const card = useQuery({ queryKey: ["rate-card", vendorId], queryFn: () => api<RateLine[]>(`/vendors/${vendorId}/rate-card`) });
  const invoices = useQuery({
    queryKey: ["invoices", { vendorId, summary: true }],
    queryFn: () => api<Page<Invoice> & { sums: Record<Currency, number> }>("/invoices", { query: { vendorId, pageSize: 1 } }),
  });
  const remove = useMutation({
    mutationFn: (l: RateLine) => api(`/rate-card/${l.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Rate removed");
      await qc.invalidateQueries();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const sums = invoices.data?.sums;
  const lines = card.data ?? [];
  const roles = [...new Set(lines.map((l) => l.role))];
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">Invoiced so far</h3>
        {!invoices.data ? (
          <Loading rows={1} />
        ) : invoices.data.total === 0 ? (
          <p className="text-ink-2">No invoices have been keyed in for {vendorName} yet.</p>
        ) : (
          <p className="num">
            <span className="text-[22px] font-semibold tracking-[-0.02em]">
              {[sums!.EUR ? formatMoney(sums!.EUR, "EUR") : "", sums!.GBP ? formatMoney(sums!.GBP, "GBP") : ""].filter(Boolean).join(" and ")}
            </span>{" "}
            <span className="text-ink-2">
              across {invoices.data.total} {invoices.data.total === 1 ? "invoice" : "invoices"}.
            </span>{" "}
            <Link to={`/money/invoices?vendorId=${vendorId}`} className="font-semibold text-accent-ink underline-offset-2 hover:underline">
              See them
            </Link>
          </p>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h3 className="flex-1 text-base font-semibold">Day rates</h3>
          <Button onClick={() => setAdding(true)}>Add day rate</Button>
        </div>
        {card.isPending ? (
          <Loading rows={2} />
        ) : card.isError ? (
          <ErrorState message={messageOf(card.error)} />
        ) : lines.length === 0 ? (
          <p className="text-ink-2">No day rates yet. Add a rate per role, and consultants on this vendor's SOWs can be given that role.</p>
        ) : (
          <ul aria-label="Day rates" className="flex flex-col">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 border-b border-line py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{l.role}</span>
                  <span className="num block text-[13px] text-ink-2">From {formatDay(l.validFrom)}</span>
                </span>
                {l.current && <Pill tone="brand">In force</Pill>}
                <span className="num">{formatMoney(l.dayRateMinor, l.currency)} a day</span>
                <ConfirmButton
                  className="h-8 px-3.5 text-[12.5px]"
                  disabled={remove.isPending}
                  onConfirm={() => remove.mutate(l)}
                  label={`Remove the ${l.role} rate from ${formatDay(l.validFrom)}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {adding && (
        <RateForm
          vendorId={vendorId}
          roles={roles}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            toast.success("Rate added");
            await qc.invalidateQueries();
          }}
        />
      )}
    </>
  );
}
