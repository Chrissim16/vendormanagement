import { vendorStatuses, vendorStatusLabels, vendorTypeLabels, vendorTypes, type VendorDetail } from "../../../../shared/vendors";
import { api } from "../../lib/api";
import { personName, usePeople } from "../../lib/data";
import { Dialog } from "../../platform/Dialog";
import { CheckField, FormFooter, Grid, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { useMe } from "../../platform/session";

export function VendorForm({ vendor, onClose, onSaved }: { vendor?: VendorDetail; onClose: () => void; onSaved: (v: VendorDetail) => void }) {
  const me = useMe();
  const people = usePeople();
  const form = useForm(
    {
      name: vendor?.name ?? "",
      legalName: vendor?.legalName ?? "",
      type: vendor?.type ?? "",
      status: vendor?.status ?? "active",
      ownerUserId: vendor?.ownerUserId ?? me.id,
      website: vendor?.website ?? "",
      country: vendor?.country ?? "",
      description: vendor?.description ?? "",
      notes: vendor?.notes ?? "",
      scoringEnabled: vendor?.scoringEnabled ?? true,
      ndaRequired: vendor?.ndaRequired ?? true,
      dpaRequired: vendor?.dpaRequired ?? true,
    },
    (v) => api<VendorDetail>(vendor ? `/vendors/${vendor.id}` : "/vendors", { method: vendor ? "PATCH" : "POST", body: { ...v, type: v.type || undefined } }),
    { onSaved },
  );
  const { values: v, set } = form;
  return (
    <Dialog title={vendor ? `Edit ${vendor.name}` : "Add vendor"} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <Grid>
          <TextField form={form} name="name" label="Name" value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          <TextField form={form} name="legalName" label="Legal name (optional)" value={v.legalName} onChange={(e) => set("legalName", e.target.value)} />
          <SelectField form={form} name="type" label="Type" value={v.type} onChange={(e) => set("type", e.target.value)}>
            <option value="">Choose a type</option>
            {vendorTypes.map((t) => (
              <option key={t} value={t}>
                {vendorTypeLabels[t]}
              </option>
            ))}
          </SelectField>
          <SelectField form={form} name="status" label="Status" value={v.status} onChange={(e) => set("status", e.target.value as typeof v.status)}>
            {vendorStatuses.map((s) => (
              <option key={s} value={s}>
                {vendorStatusLabels[s]}
              </option>
            ))}
          </SelectField>
          <SelectField form={form} name="ownerUserId" label="Owner" value={v.ownerUserId} onChange={(e) => set("ownerUserId", e.target.value)}>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </SelectField>
          <TextField form={form} name="country" label="Country code (optional)" placeholder="NL" maxLength={2} value={v.country} onChange={(e) => set("country", e.target.value)} />
        </Grid>
        <TextField form={form} name="website" label="Website (optional)" placeholder="https://" value={v.website} onChange={(e) => set("website", e.target.value)} />
        <TextAreaField form={form} name="description" label="What they do for us (optional)" value={v.description} onChange={(e) => set("description", e.target.value)} />
        <div className="flex flex-col gap-3 rounded-2xl bg-sunk px-5 py-4">
          <CheckField id="f-ndaRequired" label="An NDA is required" hint="Warn when no NDA is in place." checked={v.ndaRequired} onChange={(x) => set("ndaRequired", x)} />
          <CheckField
            id="f-dpaRequired"
            label="A data processing agreement is required"
            hint="Switch off for vendors that never handle personal data."
            checked={v.dpaRequired}
            onChange={(x) => set("dpaRequired", x)}
          />
          <CheckField
            id="f-scoringEnabled"
            label="Score this vendor"
            hint="Switch off for vendors such as research firms."
            checked={v.scoringEnabled}
            onChange={(x) => set("scoringEnabled", x)}
          />
        </div>
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={vendor ? "Save changes" : "Add vendor"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
