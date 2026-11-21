import { useQuery } from "@tanstack/react-query";
import type { Agreement } from "../../../../shared/agreements";
import { amountForInput, formatMoney, parseAmount, type Currency } from "../../../../shared/money";
import type { Invoice, SowDelivery } from "../../../../shared/sow";
import type { Page } from "../../../../shared/types";
import { api } from "../../lib/api";
import { Dialog } from "../../platform/Dialog";
import { FormFooter, Grid, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { useToday } from "../../platform/session";

/**
 * Key in an invoice (M-4). Opened from a SOW or subscription the agreement is fixed;
 * opened from the invoice list you choose it. The currency is the agreement's.
 */
export function InvoiceForm({
  invoice,
  agreement,
  onClose,
  onSaved,
}: {
  invoice?: Invoice;
  agreement?: { id: string; title: string; kind: string; currency: Currency };
  onClose: () => void;
  onSaved: (i: Invoice) => void;
}) {
  const today = useToday();
  const form = useForm(
    {
      agreementId: invoice?.agreementId ?? agreement?.id ?? "",
      milestoneId: invoice?.milestoneId ?? "",
      invoiceNumber: invoice?.invoiceNumber ?? "",
      invoiceDate: invoice?.invoiceDate ?? today,
      amount: amountForInput(invoice?.amountMinor),
      description: invoice?.description ?? "",
    },
    ({ amount, ...v }) =>
      api<Invoice>(invoice ? `/invoices/${invoice.id}` : "/invoices", {
        method: invoice ? "PATCH" : "POST",
        body: { ...v, milestoneId: v.milestoneId || null, amountMinor: parseAmount(amount) },
      }),
    {
      onSaved,
      check: (v) => ({
        agreementId: v.agreementId ? "" : "Choose the SOW or subscription this invoice is for.",
        amount: parseAmount(v.amount) == null ? "Enter an amount like 12,500.00." : "",
      }),
    },
  );
  const { values: v, set } = form;
  const choose = !invoice && !agreement;
  const sows = useQuery({
    queryKey: ["agreements", "choices", "sow"],
    queryFn: () => api<Page<Agreement>>("/agreements", { query: { kind: "sow", pageSize: 200, sort: "vendor" } }),
    enabled: choose,
  });
  const subs = useQuery({
    queryKey: ["agreements", "choices", "subscription"],
    queryFn: () => api<Page<Agreement>>("/agreements", { query: { kind: "subscription", pageSize: 200, sort: "vendor" } }),
    enabled: choose,
  });
  const options = [...(sows.data?.items ?? []), ...(subs.data?.items ?? [])].filter((a) => a.status !== "ended");
  const chosen = options.find((a) => a.id === v.agreementId);
  const kind = agreement?.kind ?? chosen?.kind ?? (invoice && invoice.agreementId === v.agreementId ? invoice.agreementKind : undefined);
  const currency: Currency = agreement?.currency ?? chosen?.currency ?? invoice?.currency ?? "EUR";
  const delivery = useQuery({
    queryKey: ["delivery", v.agreementId],
    queryFn: () => api<SowDelivery>(`/agreements/${v.agreementId}/delivery`),
    enabled: !!v.agreementId && kind === "sow",
    retry: false,
  });
  const milestones = (delivery.data?.milestones ?? []).filter((m) => m.status !== "cancelled" || m.id === invoice?.milestoneId);
  const shown = { errors: { ...form.errors, amount: form.errors.amount || form.errors.amountMinor || "" } };
  const minor = v.amount ? parseAmount(v.amount) : null;

  return (
    <Dialog title={invoice ? `Edit invoice ${invoice.invoiceNumber}` : "Add invoice"} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        {choose ? (
          <SelectField
            form={shown}
            name="agreementId"
            label="SOW or subscription"
            value={v.agreementId}
            onChange={(e) => form.patch({ agreementId: e.target.value, milestoneId: "" })}
          >
            <option value="">Choose what this invoice is for</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.vendorName} · {a.title}
              </option>
            ))}
          </SelectField>
        ) : (
          <p className="text-ink-2">For {agreement?.title ?? `${invoice?.vendorName} · ${invoice?.agreementTitle}`}.</p>
        )}
        <Grid>
          <TextField form={shown} name="invoiceNumber" label="Invoice number" value={v.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} autoFocus={!choose} />
          <TextField form={shown} name="invoiceDate" label="Invoice date" type="date" value={v.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} />
          <TextField
            form={shown}
            name="amount"
            label={`Amount in ${currency}`}
            inputMode="decimal"
            placeholder="12,500.00"
            value={v.amount}
            onChange={(e) => set("amount", e.target.value, ["amountMinor"])}
            hint={minor == null ? undefined : `Read as ${formatMoney(minor, currency)}`}
          />
          {milestones.length > 0 && (
            <SelectField form={shown} name="milestoneId" label="For milestone (optional)" value={v.milestoneId} onChange={(e) => set("milestoneId", e.target.value)}>
              <option value="">No milestone</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </SelectField>
          )}
        </Grid>
        <TextAreaField form={shown} name="description" label="Description (optional)" rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} />
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={invoice ? "Save changes" : "Add invoice"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
