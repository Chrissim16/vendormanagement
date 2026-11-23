import { useState } from "react";
import { ownedKindLabels, ownedKinds, ownedSummary, type OwnedRecord } from "../../../../shared/handover";
import type { User } from "../../../../shared/types";
import { api, messageOf } from "../../lib/api";
import { personName, usePeople } from "../../lib/data";
import { Dialog } from "../../platform/Dialog";
import { FormFooter } from "../../platform/form";
import { Field, Segmented, Select } from "../../platform/ui";

type Mode = "all" | "each";
const keyOf = (r: OwnedRecord) => `${r.type}:${r.id}`;
const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * F-6: before a person who owns vendors, agreements or RFPs is switched off, each of those
 * gets a new owner, one person for everything or a person per record, in the same step.
 */
export function HandoverDialog({ user, records, onClose, onDone }: { user: User; records: OwnedRecord[]; onClose: () => void; onDone: (u: User) => void }) {
  const who = user.displayName ?? user.email;
  const people = (usePeople().data ?? []).filter((p) => p.id !== user.id);
  const [mode, setMode] = useState<Mode>("all");
  const [all, setAll] = useState("");
  const [each, setEach] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const chosen = records.map((r) => ({ type: r.type, id: r.id, ownerUserId: mode === "all" ? all : (each[keyOf(r)] ?? "") }));
    const open = chosen.filter((c) => !c.ownerUserId);
    if (open.length) {
      setMissing(new Set(open.map((c) => `${c.type}:${c.id}`)));
      setProblem(mode === "all" ? "Choose who takes everything over." : `Choose a new owner for ${open.length === 1 ? "the record" : `the ${open.length} records`} still without one.`);
      return;
    }
    setBusy(true);
    try {
      onDone(await api<User>(`/admin/users/${user.id}/switch-off`, { body: { records: chosen } }));
    } catch (err) {
      // Nothing was changed; what was chosen stays so it can be corrected.
      setProblem(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const options = (
    <>
      <option value="">Choose a person</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {personName(p)}
        </option>
      ))}
    </>
  );

  return (
    <Dialog title={`Hand over before switching off ${who}`} onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <p className="text-ink-2">
          {who} owns {ownedSummary(records)}. Choose who takes them over. {who} is switched off once nothing is left in their name, and each record&apos;s history shows the new
          owner.
        </p>
        <Segmented<Mode>
          label="Hand over"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setProblem(null);
            setMissing(new Set());
          }}
          options={[
            { value: "all", label: "All to one person" },
            { value: "each", label: "A person per record" },
          ]}
        />
        {mode === "all" && (
          <Field label="New owner of everything" htmlFor="handover-all" error={problem && missing.size ? "Choose a person." : undefined}>
            <Select id="handover-all" data-start value={all} onChange={(e) => setAll(e.target.value)} aria-invalid={!!(problem && missing.size) || undefined} className="w-72">
              {options}
            </Select>
          </Field>
        )}
        <div className="flex flex-col gap-5">
          {ownedKinds.map((k) => {
            const mine = records.filter((r) => r.type === k);
            if (!mine.length) return null;
            return (
              <section key={k} aria-labelledby={`handover-${k}`}>
                <h3 id={`handover-${k}`} className="font-semibold">
                  {capital(ownedKindLabels[k].many)}
                  <span className="ml-2 font-normal text-ink-2">{mine.length}</span>
                </h3>
                <ul aria-label={capital(ownedKindLabels[k].many)} className="mt-1 flex flex-col">
                  {mine.map((r) => {
                    const id = `handover-${r.type}-${r.id}`;
                    const bad = missing.has(keyOf(r));
                    return (
                      <li key={r.id} className="flex items-center gap-4 border-b border-line py-2.5 last:border-0">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{r.label}</span>
                          <span className="block truncate text-[13px] text-ink-2">{r.detail}</span>
                        </span>
                        {mode === "each" && (
                          <>
                            <label htmlFor={id} className="sr-only">
                              New owner of {r.label}
                            </label>
                            <Select
                              id={id}
                              value={each[keyOf(r)] ?? ""}
                              onChange={(e) => setEach((x) => ({ ...x, [keyOf(r)]: e.target.value }))}
                              aria-invalid={bad || undefined}
                              className="w-56 shrink-0"
                            >
                              {options}
                            </Select>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        <FormFooter problem={problem} busy={busy} submitLabel="Hand over and switch off" onCancel={onClose} />
      </form>
    </Dialog>
  );
}
