import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type { ContactRole } from "../../../../shared/vendors";
import { api, messageOf } from "../../lib/api";
import { useContactRoles } from "../../lib/data";
import { ChoicePicker } from "../../platform/ChoicePicker";
import { Dialog } from "../../platform/Dialog";
import { FormFooter, TextField, useForm } from "../../platform/form";
import { History } from "../../platform/History";
import { Button, ConfirmButton, ErrorState, Loading } from "../../platform/ui";

/** The roles box of a contact form: chosen from the shared list, or a new one typed in (V-7). */
export function RolesField({ id, chosen, onChange, error }: { id: string; chosen: string[]; onChange: (next: string[]) => void; error?: string }) {
  const roles = useContactRoles();
  return (
    <ChoicePicker
      id={id}
      label="Roles (optional)"
      noun="role"
      options={(roles.data ?? []).map((r) => r.name)}
      chosen={chosen}
      onChange={onChange}
      allowNew
      error={error}
    />
  );
}

/** The keys of every role problem (the box, or one role in it), so changing the roles clears them all. */
export const roleErrorKeys = (errors: Record<string, string>, prefix = "roles") => Object.keys(errors).filter((k) => k === prefix || k.startsWith(`${prefix}.`));

/** A problem with any one role, shown under the roles box. */
export const rolesError = (errors: Record<string, string>, prefix = "roles") => Object.entries(errors).find(([k, v]) => v && (k === prefix || k.startsWith(`${prefix}.`)))?.[1];

function RenameForm({ role, onClose }: { role: ContactRole; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm({ name: role.name }, (v) => api<ContactRole[]>(`/contact-roles/${role.id}`, { method: "PATCH", body: v }), {
    onSaved: async () => {
      onClose();
      toast.success("Role renamed");
      await qc.invalidateQueries();
    },
  });
  return (
    <Dialog title={`Rename ${role.name}`} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <p className="-mt-2 text-ink-2">
          {role.contacts === 0 ? "No contact holds this role yet." : `The ${role.contacts === 1 ? "contact" : `${role.contacts} contacts`} holding it will show the new name.`}
        </p>
        <TextField form={form} name="name" label="Name" maxLength={200} value={form.values.name} onChange={(e) => form.set("name", e.target.value)} autoFocus />
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Rename" onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Admin: the shared list of contact roles, to rename or remove (V-7). Members add roles while filling in a contact. */
export function ContactRolesSection() {
  const qc = useQueryClient();
  const roles = useContactRoles();
  const [renaming, setRenaming] = useState<ContactRole | null>(null);
  const remove = useMutation({
    mutationFn: (r: ContactRole) => api<ContactRole[]>(`/contact-roles/${r.id}`, { method: "DELETE" }),
    onSuccess: async (_x, r) => {
      toast.success(`Removed ${r.name}`);
      await qc.invalidateQueries();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <section aria-labelledby="contact-roles" className="flex max-w-[560px] flex-col gap-4">
      <div>
        <h2 id="contact-roles" className="text-base font-semibold">
          Contact roles
        </h2>
        <p className="mt-1 text-ink-2">
          The roles a vendor's contacts can have, A to Z. Anyone can add one while filling in a contact. A role that a contact still holds cannot be removed.
        </p>
      </div>
      {roles.isPending ? (
        <Loading rows={3} />
      ) : roles.isError ? (
        <ErrorState message={messageOf(roles.error)} onRetry={() => void roles.refetch()} />
      ) : (
        <ul aria-label="Contact roles" className="flex flex-col">
          {roles.data.map((r) => (
            <li key={r.id} className="flex items-center gap-3 border-b border-line py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{r.name}</span>
                <span className="block text-[13px] text-ink-2">{r.contacts === 0 ? "Not in use" : r.contacts === 1 ? "1 contact" : `${r.contacts} contacts`}</span>
              </span>
              <Button className="h-8 px-3.5 text-[12.5px]" onClick={() => setRenaming(r)} aria-label={`Rename ${r.name}`}>
                Rename
              </Button>
              <ConfirmButton className="h-8 px-3.5 text-[12.5px]" label={`Remove ${r.name}`} onConfirm={() => remove.mutate(r)} />
            </li>
          ))}
        </ul>
      )}
      <History entityType="contact_roles" entityId="list" limit={5} />
      {renaming && <RenameForm role={renaming} onClose={() => setRenaming(null)} />}
    </section>
  );
}
