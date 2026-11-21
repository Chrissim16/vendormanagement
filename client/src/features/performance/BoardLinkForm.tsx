import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { splitValues, type BoardLink, type EscalationMethod, type JiraBoardChoice, type LinkTest, type SyncOutcome } from "../../../../shared/performance";
import { api, messageOf } from "../../lib/api";
import { Dialog } from "../../platform/Dialog";
import { CheckField, FormFooter, Grid, SelectField, TextField, useForm } from "../../platform/form";
import { Button, ErrorState, Pill } from "../../platform/ui";

interface Values extends Record<string, unknown> {
  vendorId: string;
  projectKey: string;
  escalationMethod: EscalationMethod;
  l1Values: string;
  l2Values: string;
  l3Values: string;
  active: boolean;
}

export interface LinkSaved {
  link: BoardLink;
  sync: SyncOutcome | null;
}

/**
 * Links a vendor to its Jira board and says how escalation shows on it (J-1). Admins only.
 * With `vendors`, the vendor is chosen in the dialog; otherwise it is the one given.
 */
export function BoardLinkForm({
  vendor,
  vendors,
  link,
  onClose,
  onSaved,
}: {
  vendor?: { id: string; name: string };
  vendors?: { id: string; name: string }[];
  link?: BoardLink | null;
  onClose: () => void;
  onSaved: (saved: LinkSaved, vendorName: string) => void;
}) {
  const boards = useQuery({ queryKey: ["jira-boards"], queryFn: () => api<JiraBoardChoice[]>("/admin/jira/boards"), retry: false });
  const [test, setTest] = useState<LinkTest | null>(null);
  const [testing, setTesting] = useState(false);
  const body = (v: Values) => ({
    projectKey: v.projectKey,
    escalationMethod: v.escalationMethod,
    l1Values: splitValues(v.l1Values),
    l2Values: splitValues(v.l2Values),
    l3Values: splitValues(v.l3Values),
    active: v.active,
  });
  const names = new Map([...(vendors ?? []), ...(vendor ? [vendor] : [])].map((x) => [x.id, x.name]));
  const form = useForm<Values, { saved: LinkSaved; vendorId: string }>(
    {
      vendorId: vendor?.id ?? "",
      projectKey: link?.projectKey ?? "",
      escalationMethod: link?.escalationMethod ?? "status",
      l1Values: link?.l1Values.join(", ") ?? "",
      l2Values: link?.l2Values.join(", ") ?? "",
      l3Values: link?.l3Values.join(", ") ?? "",
      active: link?.active ?? true,
    },
    async (v) => ({ saved: await api<LinkSaved>(`/admin/vendors/${v.vendorId}/jira-link`, { method: "PUT", body: body(v) }), vendorId: v.vendorId }),
    {
      onSaved: ({ saved, vendorId }) => onSaved(saved, names.get(vendorId) ?? "the vendor"),
      check: (v) => ({ vendorId: v.vendorId ? "" : "Choose a vendor.", projectKey: v.projectKey ? "" : "Choose a board." }),
    },
  );
  const { values: v } = form;
  /** Any change makes an earlier test result stale. */
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setTest(null);
    form.set(key, value);
  };
  const runTest = async () => {
    setTesting(true);
    try {
      setTest(await api<LinkTest>("/admin/jira/test", { body: body(v) }));
    } catch (e) {
      setTest({ ok: false, message: messageOf(e), warnings: [], statuses: [], labels: [] });
    } finally {
      setTesting(false);
    }
  };
  const what = v.escalationMethod === "status" ? "Statuses" : "Labels";
  const one = v.escalationMethod === "status" ? "status" : "label";
  const found = test?.ok ? (v.escalationMethod === "status" ? test.statuses : test.labels) : [];

  return (
    <Dialog title={link ? `Jira board of ${vendor?.name ?? "the vendor"}` : "Link a Jira board"} onClose={onClose} wide>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        {boards.isError && <ErrorState message={messageOf(boards.error)} onRetry={() => void boards.refetch()} />}
        <Grid>
          {vendors && (
            <SelectField form={form} name="vendorId" label="Vendor" value={v.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
              <option value="">Choose a vendor</option>
              {vendors.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField form={form} name="projectKey" label="Jira board" value={v.projectKey} onChange={(e) => set("projectKey", e.target.value)}>
            <option value="">{boards.isPending ? "Loading boards" : "Choose a board"}</option>
            {/* The board already linked stays choosable even if Jira can no longer list it. */}
            {link && !boards.data?.some((b) => b.key === link.projectKey) && <option value={link.projectKey}>{`${link.projectKey} · ${link.projectName ?? ""}`}</option>}
            {boards.data?.map((b) => {
              const taken = b.linkedTo !== null && b.key !== link?.projectKey;
              return (
                <option key={b.key} value={b.key} disabled={taken}>
                  {`${b.key} · ${b.name}${taken ? ` · linked to ${b.linkedTo}` : ""}`}
                </option>
              );
            })}
          </SelectField>
          <SelectField
            form={form}
            name="escalationMethod"
            label="A ticket's support level shows in"
            value={v.escalationMethod}
            onChange={(e) => set("escalationMethod", e.target.value as EscalationMethod)}
          >
            <option value="status">Its status</option>
            <option value="label">A label on the ticket</option>
          </SelectField>
        </Grid>
        <div className="flex flex-col gap-4">
          <p className="text-ink-2">
            Say which {what.toLowerCase()} mean each level, separated by commas. A ticket counts at the highest level it ever reached; one that never carried a level 2 or 3 {one}{" "}
            was solved by the first line.
          </p>
          <TextField
            form={form}
            name="l1Values"
            label={`${what} that mean level 1, the first line (optional)`}
            value={v.l1Values}
            onChange={(e) => set("l1Values", e.target.value)}
          />
          <TextField form={form} name="l2Values" label={`${what} that mean level 2, the second line`} value={v.l2Values} onChange={(e) => set("l2Values", e.target.value)} />
          <TextField form={form} name="l3Values" label={`${what} that mean level 3, the third line`} value={v.l3Values} onChange={(e) => set("l3Values", e.target.value)} />
        </div>
        {link && (
          <CheckField
            id="f-active"
            label="Fetch this board's tickets"
            hint="Switch off to stop fetching without losing the tickets and figures already here."
            checked={v.active}
            onChange={(x) => set("active", x)}
          />
        )}
        <div className="flex flex-col gap-3 rounded-2xl bg-sunk px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => void runTest()} aria-disabled={testing || !v.projectKey || undefined} className="bg-surface">
              {testing ? "Testing" : "Test link"}
            </Button>
            <div role="status" className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
              {!test && <span className="text-ink-2">{v.projectKey ? "Checks the board and the values above without saving anything." : "Choose a board first."}</span>}
              {test && (
                <Pill tone={!test.ok ? "bad" : test.warnings.length ? "warn" : "ok"}>{!test.ok ? "Not working" : test.warnings.length ? "Working, with remarks" : "Working"}</Pill>
              )}
              {test && <span className="min-w-0">{test.message}</span>}
            </div>
          </div>
          {test?.ok && (
            <>
              {test.warnings.length > 0 && (
                <ul aria-label="Remarks" className="flex list-disc flex-col gap-1 pl-5">
                  {test.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <p className="text-[13px] text-ink-2">
                {found.length
                  ? `${what} on this board: ${found.join(", ")}.`
                  : v.escalationMethod === "label"
                    ? "No labels were found on this board's recent tickets."
                    : "No statuses were found."}
              </p>
            </>
          )}
        </div>
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={link ? "Save changes" : "Link board"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** What to tell the admin after saving a link. */
export function linkSavedMessage(saved: LinkSaved, vendorName: string): { ok: boolean; text: string } {
  if (saved.sync && !saved.sync.ok) return { ok: false, text: `Linked ${vendorName}, but the tickets could not be fetched. ${saved.sync.message ?? ""}` };
  if (saved.sync) return { ok: true, text: `Linked ${vendorName} to ${saved.link.projectKey}: ${saved.sync.updated.toLocaleString("en-GB")} tickets fetched` };
  return { ok: true, text: `Saved the Jira board of ${vendorName}` };
}
