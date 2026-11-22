import { vendorStatuses, vendorStatusLabels, vendorTypeLabels, vendorTypes, type VendorDetail } from "../../../../shared/vendors";
import { api } from "../../lib/api";
import { personName, usePeople } from "../../lib/data";
import { Dialog } from "../../platform/Dialog";
import { CheckField, FormFooter, Grid, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { useMe } from "../../platform/session";
import { RolesField, rolesError } from "./ContactRoles";

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
      addressLine1: vendor?.addressLine1 ?? "",
      addressLine2: vendor?.addressLine2 ?? "",
      postalCode: vendor?.postalCode ?? "",
      city: vendor?.city ?? "",
      country: vendor?.country ?? "",
      vatNumber: vendor?.vatNumber ?? "",
      description: vendor?.description ?? "",
      notes: vendor?.notes ?? "",
      scoringEnabled: vendor?.scoringEnabled ?? true,
      ndaRequired: vendor?.ndaRequired ?? true,
      dpaRequired: vendor?.dpaRequired ?? true,
      contactName: "",
      contactRoles: [] as string[],
      contactEmail: "",
      contactPhone: "",
    },
    ({ contactName, contactRoles, contactEmail, contactPhone, ...v }) =>
      api<VendorDetail>(vendor ? `/vendors/${vendor.id}` : "/vendors", {
        method: vendor ? "PATCH" : "POST",
        body: { ...v, type: v.type || undefined, ...(vendor ? {} : { mainContact: { name: contactName, roles: contactRoles, email: contactEmail, phone: contactPhone } }) },
      }),
    { onSaved },
  );
  const { values: v, set } = form;
  const owners = [...(people.data ?? [])];
  if (vendor && !owners.some((p) => p.id === vendor.ownerUserId))
    owners.push({ id: vendor.ownerUserId, email: vendor.ownerName, displayName: `${vendor.ownerName} (no longer has access)` });
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
            {owners.map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </SelectField>
          <TextField form={form} name="vatNumber" label="VAT or tax number (optional)" placeholder="NL123456789B01" value={v.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} />
        </Grid>
        <TextField form={form} name="website" label="Website (optional)" placeholder="https://" value={v.website} onChange={(e) => set("website", e.target.value)} />
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-[13px] font-semibold">Address (optional)</legend>
          <TextField form={form} name="addressLine1" label="Street and number" autoComplete="off" value={v.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
          <TextField form={form} name="addressLine2" label="Second street line" autoComplete="off" value={v.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] gap-x-4 gap-y-4">
            <TextField form={form} name="postalCode" label="Postal code" autoComplete="off" value={v.postalCode} onChange={(e) => set("postalCode", e.target.value)} />
            <TextField form={form} name="city" label="City" autoComplete="off" value={v.city} onChange={(e) => set("city", e.target.value)} />
            <TextField form={form} name="country" label="Country code" placeholder="NL" maxLength={2} value={v.country} onChange={(e) => set("country", e.target.value)} />
          </div>
        </fieldset>
        {!vendor && (
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-1 text-[13px] font-semibold">Main contact (optional)</legend>
            <p className="-mt-1 text-[13px] text-ink-2">Leave empty to add contacts later. When a name is given, this person becomes the vendor's primary contact.</p>
            <Grid>
              <TextField form={form} name="mainContact.name" label="Contact name" autoComplete="off" value={v.contactName} onChange={(e) => set("contactName", e.target.value, ["mainContact.name"])} />
              <TextField
                form={form}
                name="mainContact.email"
                label="Contact email"
                type="email"
                autoComplete="off"
                value={v.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value, ["mainContact.email"])}
              />
              <TextField form={form} name="mainContact.phone" label="Contact phone" autoComplete="off" value={v.contactPhone} onChange={(e) => set("contactPhone", e.target.value, ["mainContact.phone"])} />
            </Grid>
            <RolesField id="f-mainContact.roles" chosen={v.contactRoles} onChange={(next) => set("contactRoles", next, ["mainContact.roles"])} error={rolesError(form.errors, "mainContact.roles")} />
          </fieldset>
        )}
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
