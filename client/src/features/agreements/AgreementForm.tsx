import { useQuery } from "@tanstack/react-query";
import {
  agreementStatuses,
  endReasons,
  kindLabels,
  kinds,
  pricingLabels,
  pricings,
  statusLabels,
  type Agreement,
  type AgreementDetail,
  type Kind,
} from "../../../../shared/agreements";
import { amountForInput, parseAmount } from "../../../../shared/money";
import { amountProblem, CurrencyOptions, shownMoney } from "../../platform/Money";
import type { Page } from "../../../../shared/types";
import type { Vendor } from "../../../../shared/vendors";
import { api } from "../../lib/api";
import { personName, usePeople } from "../../lib/data";
import { Dialog } from "../../platform/Dialog";
import { CheckField, FormFooter, Grid, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { useMe } from "../../platform/session";

const reasonLabels = { completed: "Completed", expired: "Expired", terminated: "Terminated", replaced: "Replaced by another agreement" } as const;
const AMOUNT = "Enter an amount like 12,500.00.";

/** Add or edit an agreement. Only the fields that belong to the chosen kind are shown (A-1). */
export function AgreementForm({
  agreement,
  vendorId,
  kind,
  onClose,
  onSaved,
}: {
  agreement?: AgreementDetail;
  vendorId?: string;
  /** For a new agreement: the kind to start with, when a link already says which is needed. */
  kind?: Kind;
  onClose: () => void;
  onSaved: (a: AgreementDetail) => void;
}) {
  const me = useMe();
  const people = usePeople();
  const a = agreement;
  const form = useForm(
    {
      vendorId: a?.vendorId ?? vendorId ?? "",
      kind: (a?.kind ?? kind ?? "") as Kind | "",
      title: a?.title ?? "",
      reference: a?.reference ?? "",
      status: a?.status ?? "draft",
      ownerUserId: a?.ownerUserId ?? me.id,
      currency: a?.currency ?? "EUR",
      signedOn: a?.signedOn ?? "",
      startDate: a?.startDate ?? "",
      endDate: a?.endDate ?? "",
      endReason: a?.endReason ?? "",
      notes: a?.notes ?? "",
      parentMsaId: a?.parentMsaId ?? "",
      pricing: a?.pricing ?? "",
      budget: amountForInput(a?.budgetMinor),
      annualValue: amountForInput(a?.annualValueMinor),
      noticePeriodDays: String(a?.noticePeriodDays ?? 90),
      autoRenews: a?.autoRenews ?? false,
      renewalTermMonths: String(a?.renewalTermMonths ?? 12),
    },
    (v) => {
      const { budget, annualValue, ...rest } = v;
      const body = {
        ...rest,
        endReason: v.endReason || null,
        parentMsaId: v.parentMsaId || null,
        pricing: v.pricing || null,
        budgetMinor: budget ? parseAmount(budget, v.currency) : null,
        annualValueMinor: annualValue ? parseAmount(annualValue, v.currency) : null,
        noticePeriodDays: v.noticePeriodDays === "" ? null : Number(v.noticePeriodDays),
        renewalTermMonths: v.renewalTermMonths === "" ? null : Number(v.renewalTermMonths),
      };
      return api<AgreementDetail>(a ? `/agreements/${a.id}` : "/agreements", { method: a ? "PATCH" : "POST", body });
    },
    {
      onSaved,
      check: (v) => ({
        vendorId: v.vendorId ? "" : "Choose a vendor.",
        kind: v.kind ? "" : "Choose what kind of agreement this is.",
        budget: v.budget ? amountProblem(v.budget, v.currency, AMOUNT) : "",
        annualValue: v.annualValue ? amountProblem(v.annualValue, v.currency, AMOUNT) : "",
        noticePeriodDays: /^\d*$/.test(v.noticePeriodDays) ? "" : "Enter a number of days.",
        renewalTermMonths: /^\d*$/.test(v.renewalTermMonths) ? "" : "Enter a number of months.",
      }),
    },
  );
  const { values: v, set } = form;
  // What the app understood from a typed amount, shown before saving so "1.234" is never a surprise.
  const reading = (typed: string) => {
    const minor = typed ? parseAmount(typed, v.currency) : null;
    return minor == null ? undefined : `Read as ${shownMoney(minor, v.currency)}`;
  };
  // Changing the kind empties the fields that belonged to the old kind, so nothing unseen is sent.
  const changeKind = (kind: Kind) =>
    form.patch({ kind, parentMsaId: "", pricing: "", budget: "", annualValue: "", startDate: "", endDate: "", noticePeriodDays: "90", renewalTermMonths: "12", autoRenews: false });
  // A person who no longer has access is not in the list, but must still show as the current owner.
  const owners = [...(people.data ?? [])];
  if (a && !owners.some((p) => p.id === a.ownerUserId)) owners.push({ id: a.ownerUserId, email: a.ownerName, displayName: `${a.ownerName} (no longer has access)` });
  // The server names the amount fields by what is stored; show its messages on the boxes people type in.
  const shown = {
    errors: { ...form.errors, budget: form.errors.budget || form.errors.budgetMinor || "", annualValue: form.errors.annualValue || form.errors.annualValueMinor || "" },
  };
  const vendors = useQuery({
    queryKey: ["vendors", "choices"],
    queryFn: () => api<Page<Vendor>>("/vendors", { query: { pageSize: 200, sort: "name" } }),
    enabled: !a && !vendorId,
  });
  const msas = useQuery({
    queryKey: ["agreements", { vendorId: v.vendorId, kind: "msa" }],
    queryFn: () => api<Page<Agreement>>("/agreements", { query: { vendorId: v.vendorId, kind: "msa", pageSize: 200 } }),
    enabled: v.kind === "sow" && !!v.vendorId,
  });
  const text = (
    name: "title" | "reference" | "signedOn" | "startDate" | "endDate" | "budget" | "annualValue" | "noticePeriodDays" | "renewalTermMonths",
    label: string,
    props: Record<string, unknown> = {},
  ) => (
    <TextField
      form={shown}
      name={name}
      label={label}
      value={v[name]}
      onChange={(e) => set(name, e.target.value, name === "budget" ? ["budgetMinor"] : name === "annualValue" ? ["annualValueMinor"] : [])}
      {...props}
    />
  );
  const currency = (
    <SelectField form={shown} name="currency" label="Currency" value={v.currency} onChange={(e) => set("currency", e.target.value as typeof v.currency)}>
      <CurrencyOptions value={v.currency} />
    </SelectField>
  );

  return (
    <Dialog title={a ? `Edit ${a.title}` : "Add agreement"} onClose={onClose} wide>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <Grid>
          {!a && !vendorId && (
            <SelectField form={shown} name="vendorId" label="Vendor" value={v.vendorId} onChange={(e) => form.patch({ vendorId: e.target.value, parentMsaId: "" })}>
              <option value="">Choose a vendor</option>
              {vendors.data?.items.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </SelectField>
          )}
          {!a && (
            <SelectField form={shown} name="kind" label="Kind" value={v.kind} onChange={(e) => changeKind(e.target.value as Kind)}>
              <option value="">Choose a kind</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {kindLabels[k]}
                </option>
              ))}
            </SelectField>
          )}
          {/* With the kind already chosen by a link, the title is the first thing left to fill. */}
          {text("title", "Title", { autoFocus: true, "data-start": !a && kind ? "" : undefined })}
          {text("reference", "Our reference (optional)")}
          <SelectField form={shown} name="ownerUserId" label="Owner" value={v.ownerUserId} onChange={(e) => set("ownerUserId", e.target.value)}>
            {owners.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </SelectField>
          <SelectField form={shown} name="status" label="Status" value={v.status} onChange={(e) => set("status", e.target.value as typeof v.status)}>
            {agreementStatuses.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s]}
              </option>
            ))}
          </SelectField>
          {text("signedOn", v.status === "active" ? "Signed on" : "Signed on (when signed)", { type: "date" })}
          {v.status === "ended" && (
            <SelectField form={shown} name="endReason" label="Why it ended" value={v.endReason} onChange={(e) => set("endReason", e.target.value as typeof v.endReason)}>
              <option value="">Choose a reason</option>
              {endReasons.map((r) => (
                <option key={r} value={r}>
                  {reasonLabels[r]}
                </option>
              ))}
            </SelectField>
          )}
        </Grid>

        {v.kind === "msa" && (
          <Grid>
            {text("startDate", "Start date (optional)", { type: "date" })}
            {v.status === "ended" ? (
              text("endDate", "Ended on", { type: "date" })
            ) : (
              <p className="self-end pb-2 text-[13px] text-ink-2">An MSA has no end date. It runs until someone ends it.</p>
            )}
          </Grid>
        )}
        {v.kind === "sow" && (
          <Grid>
            <SelectField form={shown} name="parentMsaId" label="Under MSA (optional)" value={v.parentMsaId} onChange={(e) => set("parentMsaId", e.target.value)}>
              <option value="">No MSA</option>
              {msas.data?.items.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </SelectField>
            <SelectField form={shown} name="pricing" label="Pricing" value={v.pricing} onChange={(e) => set("pricing", e.target.value as typeof v.pricing)}>
              <option value="">Choose</option>
              {pricings.map((p) => (
                <option key={p} value={p}>
                  {pricingLabels[p]}
                </option>
              ))}
            </SelectField>
            {text("budget", "Budget", { inputMode: "decimal", placeholder: "12,500.00", hint: reading(v.budget) })}
            {currency}
            {text("startDate", "Start date", { type: "date" })}
            {text("endDate", "End date", { type: "date" })}
          </Grid>
        )}
        {v.kind === "subscription" && (
          <>
            <Grid>
              {text("annualValue", "Annual value", { inputMode: "decimal", placeholder: "12,500.00", hint: reading(v.annualValue) })}
              {currency}
              {text("startDate", "Start date", { type: "date" })}
              {text("endDate", "Renewal date", { type: "date" })}
              {text("noticePeriodDays", "Notice period in days", { inputMode: "numeric" })}
              {text("renewalTermMonths", "Renewal term in months", { inputMode: "numeric" })}
            </Grid>
            <CheckField
              id="f-autoRenews"
              label="Renews automatically"
              hint="If nobody gives notice before the deadline, it renews for another term."
              checked={v.autoRenews}
              onChange={(x) => set("autoRenews", x)}
            />
          </>
        )}
        {(v.kind === "nda" || v.kind === "dpa") && <Grid>{text("endDate", "Valid until (optional)", { type: "date" })}</Grid>}

        <TextAreaField form={shown} name="notes" label="Notes (optional)" value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={a ? "Save changes" : "Add agreement"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
