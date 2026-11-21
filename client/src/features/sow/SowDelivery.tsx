import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { AgreementDetail } from "../../../../shared/agreements";
import { formatDay } from "../../../../shared/dates";
import { amountForInput, formatMoney, parseAmount, type Currency } from "../../../../shared/money";
import type { ChangeRequest, Consultant, Milestone, SowDelivery as Delivery } from "../../../../shared/sow";
import { api, messageOf } from "../../lib/api";
import { Dialog } from "../../platform/Dialog";
import { FormFooter, Grid, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { useToday } from "../../platform/session";
import { Button, ConfirmButton, ErrorState, Loading, Pill } from "../../platform/ui";

const AMOUNT = "Enter an amount like 12,500.00.";
const small = "h-8 px-3.5 text-[12.5px]";
const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="flex min-w-0 flex-col gap-3">
    <div className="flex items-center gap-3">
      <h2 className="flex-1 text-base font-semibold">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);
const signed = (minor: number, currency: Currency) => `${minor < 0 ? "−" : "+"} ${formatMoney(Math.abs(minor), currency)}`;

/** Budget against invoiced, as a meter and three figures (M-5). */
function Budget({ d }: { d: Delivery }) {
  const b = d.budget;
  const pct = b.budgetMinor && b.budgetMinor > 0 ? Math.min(100, (b.invoicedMinor / b.budgetMinor) * 100) : 0;
  const money = (minor: number | null) => (minor == null ? "–" : formatMoney(minor, b.currency));
  const figures: [string, string, string?][] = [
    ["Budget", money(b.budgetMinor), b.originalMinor != null && b.originalMinor !== b.budgetMinor ? `${money(b.originalMinor)} originally` : undefined],
    ["Invoiced", money(b.invoicedMinor)],
    [b.state === "over" ? "Over budget by" : "Remaining", b.remainingMinor == null ? "–" : money(Math.abs(b.remainingMinor))],
  ];
  return (
    <section aria-label="Budget" className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <div
          role="img"
          aria-label={b.usedPct == null ? "No budget to compare with" : `${b.usedPct}% of the budget has been invoiced`}
          className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--line)]"
        >
          <motion.div
            className={clsx("h-full rounded-full", b.state === "over" ? "bg-crit" : b.state === "warn" ? "bg-warn" : "bg-accent")}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1], delay: 0.12 }}
          />
        </div>
        {b.usedPct != null && <span className="num font-semibold">{b.usedPct}% invoiced</span>}
        {b.state === "over" && <Pill tone="bad">Over budget</Pill>}
        {b.state === "warn" && <Pill tone="warn">Close to budget</Pill>}
      </div>
      <dl className="grid grid-cols-3 gap-8">
        {figures.map(([label, value, note]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[13.5px] font-medium text-ink-2">{label}</dt>
            <dd className="num mt-2 truncate text-[26px] font-semibold leading-tight tracking-[-0.02em]">{value}</dd>
            {note && <dd className="num mt-1 text-[12.5px] text-ink-3">{note}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

function MilestoneForm({ sow, milestone: m, onClose, onSaved }: { sow: AgreementDetail; milestone?: Milestone; onClose: () => void; onSaved: () => void }) {
  const fixed = sow.pricing === "fixed";
  const form = useForm(
    { title: m?.title ?? "", dueDate: m?.dueDate ?? "", amount: amountForInput(m?.amountMinor), status: m?.status ?? "open", deliveredOn: m?.deliveredOn ?? "" },
    ({ amount, ...v }) =>
      api(m ? `/milestones/${m.id}` : `/agreements/${sow.id}/milestones`, {
        method: m ? "PATCH" : "POST",
        body: { ...v, deliveredOn: v.status === "delivered" ? v.deliveredOn || null : null, amountMinor: fixed && amount ? parseAmount(amount) : null },
      }),
    { onSaved, check: (v) => ({ amount: fixed && v.amount && parseAmount(v.amount) == null ? AMOUNT : "" }) },
  );
  const { values: v, set } = form;
  const shown = { errors: { ...form.errors, amount: form.errors.amount || form.errors.amountMinor || "" } };
  const minor = v.amount ? parseAmount(v.amount) : null;
  return (
    <Dialog title={m ? `Edit ${m.title}` : "Add milestone"} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <TextField form={shown} name="title" label="Milestone" value={v.title} onChange={(e) => set("title", e.target.value)} autoFocus />
        <Grid>
          <TextField form={shown} name="dueDate" label="Due date" type="date" value={v.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
          {fixed && (
            <TextField
              form={shown}
              name="amount"
              label={`Payment in ${sow.currency} (optional)`}
              inputMode="decimal"
              placeholder="12,500.00"
              value={v.amount}
              onChange={(e) => set("amount", e.target.value, ["amountMinor"])}
              hint={minor == null ? undefined : `Read as ${formatMoney(minor, sow.currency)}`}
            />
          )}
          <SelectField form={shown} name="status" label="Status" value={v.status} onChange={(e) => set("status", e.target.value as typeof v.status)}>
            <option value="open">Open</option>
            <option value="delivered">Delivered</option>
            <option value="cancelled">Cancelled</option>
          </SelectField>
          {v.status === "delivered" && (
            <TextField
              form={shown}
              name="deliveredOn"
              label="Delivered on (empty means today)"
              type="date"
              value={v.deliveredOn}
              onChange={(e) => set("deliveredOn", e.target.value)}
            />
          )}
        </Grid>
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={m ? "Save changes" : "Add milestone"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function ChangeForm({ sow, change: c, onClose, onSaved }: { sow: AgreementDetail; change?: ChangeRequest; onClose: () => void; onSaved: () => void }) {
  const today = useToday();
  const start = c?.budgetChangeMinor ?? null;
  const form = useForm(
    {
      title: c?.title ?? "",
      description: c?.description ?? "",
      requestedOn: c?.requestedOn ?? today,
      direction: start != null && start < 0 ? "less" : "more",
      amount: start == null ? "" : amountForInput(Math.abs(start)),
      newEndDate: c?.newEndDate ?? "",
    },
    ({ amount, direction, ...v }) =>
      api(c ? `/change-requests/${c.id}` : `/agreements/${sow.id}/change-requests`, {
        method: c ? "PATCH" : "POST",
        body: { ...v, newEndDate: v.newEndDate || null, budgetChangeMinor: amount ? (parseAmount(amount) ?? 0) * (direction === "less" ? -1 : 1) : null },
      }),
    { onSaved, check: (v) => ({ amount: v.amount && parseAmount(v.amount) == null ? AMOUNT : "" }) },
  );
  const { values: v, set } = form;
  const shown = { errors: { ...form.errors, amount: form.errors.amount || form.errors.budgetChangeMinor || "" } };
  const minor = v.amount ? parseAmount(v.amount) : null;
  return (
    <Dialog title={c ? `Edit ${c.title}` : "Add change request"} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <TextField form={shown} name="title" label="What changes" value={v.title} onChange={(e) => set("title", e.target.value)} autoFocus />
        <Grid>
          <SelectField form={shown} name="direction" label="Budget goes" value={v.direction} onChange={(e) => set("direction", e.target.value)}>
            <option value="more">Up</option>
            <option value="less">Down</option>
          </SelectField>
          <TextField
            form={shown}
            name="amount"
            label={`By, in ${sow.currency} (optional)`}
            inputMode="decimal"
            placeholder="12,500.00"
            value={v.amount}
            onChange={(e) => set("amount", e.target.value, ["budgetChangeMinor"])}
            hint={minor == null ? undefined : `Read as ${signed(minor * (v.direction === "less" ? -1 : 1), sow.currency)}`}
          />
          <TextField form={shown} name="newEndDate" label="New end date (optional)" type="date" value={v.newEndDate} onChange={(e) => set("newEndDate", e.target.value)} />
          <TextField form={shown} name="requestedOn" label="Requested on" type="date" value={v.requestedOn} onChange={(e) => set("requestedOn", e.target.value)} />
        </Grid>
        <TextAreaField form={shown} name="description" label="Why (optional)" rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} />
        <p className="text-[13px] text-ink-2">Nothing changes on the SOW until the request is approved.</p>
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={c ? "Save changes" : "Add change request"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function ConsultantForm({
  sow,
  roles,
  consultant: c,
  onClose,
  onSaved,
}: {
  sow: AgreementDetail;
  roles: string[];
  consultant?: Consultant;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useForm(
    { name: c?.name ?? "", role: c?.role ?? "", fromDate: c?.fromDate ?? "", toDate: c?.toDate ?? "" },
    (v) => api(c ? `/consultants/${c.id}` : `/agreements/${sow.id}/consultants`, { method: c ? "PATCH" : "POST", body: v }),
    { onSaved },
  );
  const { values: v, set } = form;
  return (
    <Dialog title={c ? `Edit ${c.name}` : "Add consultant"} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <Grid>
          <TextField form={form} name="name" label="Name" value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          <SelectField form={form} name="role" label="Role on the rate card" value={v.role} onChange={(e) => set("role", e.target.value)}>
            <option value="">Choose a role</option>
            {roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </SelectField>
          <TextField form={form} name="fromDate" label="From (optional)" type="date" value={v.fromDate} onChange={(e) => set("fromDate", e.target.value)} />
          <TextField form={form} name="toDate" label="Until (optional)" type="date" value={v.toDate} onChange={(e) => set("toDate", e.target.value)} />
        </Grid>
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={c ? "Save changes" : "Add consultant"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

type Open = null | "milestone" | "change" | "consultant" | { milestone: Milestone } | { change: ChangeRequest } | { consultant: Consultant };

/** Everything that happens on a SOW after it is signed: budget, milestones, changes and consultants (M-1 to M-5). */
export function SowDelivery({ agreement: a }: { agreement: AgreementDetail }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<Open>(null);
  const q = useQuery({ queryKey: ["delivery", a.id], queryFn: () => api<Delivery>(`/agreements/${a.id}/delivery`) });
  const done = async (message: string) => {
    setOpen(null);
    toast.success(message);
    await qc.invalidateQueries();
  };
  const act = useMutation({
    mutationFn: ({ path, method = "POST", body }: { path: string; method?: string; body?: unknown; message: string }) => api(path, { method, body }),
    onSuccess: (_r, v) => done(v.message),
    onError: (e) => toast.error(messageOf(e)),
  });
  if (q.isPending) return <Loading rows={3} />;
  if (q.isError) return <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const fixed = a.pricing === "fixed";
  const changed = d.budget.originalMinor !== d.budget.budgetMinor || d.endDateOriginal !== a.endDate;

  return (
    <>
      <Budget d={d} />
      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-14">
        <Section title="Milestones" action={<Button onClick={() => setOpen("milestone")}>Add milestone</Button>}>
          {d.milestones.length === 0 ? (
            <p className="text-ink-2">No milestones yet. Add what the vendor has promised and when{fixed ? ", with the payment that goes with it" : ""}.</p>
          ) : (
            <ul aria-label="Milestones" className="flex flex-col">
              {d.milestones.map((m) => (
                <li key={m.id} className={clsx("flex items-center gap-3 border-b border-line py-3.5", m.status === "cancelled" && "text-ink-3")}>
                  <span
                    aria-hidden
                    className={clsx(
                      "h-2.5 w-2.5 shrink-0 rounded-full border-2",
                      m.status === "cancelled" ? "border-line-2" : m.late ? "border-crit bg-crit" : m.status === "delivered" ? "border-accent bg-accent" : "border-line-2",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={clsx("block truncate font-semibold", m.status === "cancelled" && "line-through")}>{m.title}</span>
                    <span className="num block text-[13px] text-ink-2">
                      {m.status === "delivered"
                        ? `Delivered ${formatDay(m.deliveredOn!)}, due ${formatDay(m.dueDate)}`
                        : m.status === "cancelled"
                          ? "Cancelled"
                          : `Due ${formatDay(m.dueDate)}`}
                      {m.invoicedMinor > 0 &&
                        (m.invoicedMinor === m.amountMinor
                          ? " · invoiced in full"
                          : m.amountMinor != null && m.invoicedMinor > m.amountMinor
                            ? ` · ${formatMoney(m.invoicedMinor, a.currency)} invoiced, more than its amount`
                            : ` · ${formatMoney(m.invoicedMinor, a.currency)} invoiced`)}
                    </span>
                  </span>
                  {m.late && <Pill tone="bad">{m.daysLate === 1 ? "1 day late" : `${m.daysLate} days late`}</Pill>}
                  {m.amountMinor != null && <span className="num">{formatMoney(m.amountMinor, a.currency)}</span>}
                  {m.status === "open" && (
                    <Button
                      className={small}
                      disabled={act.isPending}
                      onClick={() => act.mutate({ path: `/milestones/${m.id}`, method: "PATCH", body: { status: "delivered" }, message: `${m.title} marked delivered` })}
                      aria-label={`Mark ${m.title} delivered`}
                    >
                      Delivered
                    </Button>
                  )}
                  <Button className={small} onClick={() => setOpen({ milestone: m })} aria-label={`Edit ${m.title}`}>
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="flex min-w-0 flex-col gap-10">
          <Section title="Change requests" action={<Button onClick={() => setOpen("change")}>Add change</Button>}>
            {changed && (
              <p className="num rounded-2xl bg-sunk px-5 py-3.5 text-[13px] text-ink-2">
                Started at {d.budget.originalMinor == null ? "no budget" : formatMoney(d.budget.originalMinor, a.currency)}
                {d.endDateOriginal && `, ending ${formatDay(d.endDateOriginal)}`}. Now {d.budget.budgetMinor == null ? "no budget" : formatMoney(d.budget.budgetMinor, a.currency)}
                {a.endDate && `, ending ${formatDay(a.endDate)}`}.
              </p>
            )}
            {d.changeRequests.length === 0 ? (
              <p className="text-ink-2">No changes. An approved change moves the budget, the end date, or both, and stays on record here.</p>
            ) : (
              <ul aria-label="Change requests" className="flex flex-col">
                {d.changeRequests.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3.5">
                    <Pill tone={c.status === "approved" ? "brand" : "none"}>{c.status === "approved" ? "Approved" : c.status === "proposed" ? "Proposed" : "Rejected"}</Pill>
                    <span className="min-w-0 flex-1 basis-40">
                      <span className="block truncate font-semibold">{c.title}</span>
                      <span className="num block text-[13px] text-ink-2">
                        {[c.budgetChangeMinor ? signed(c.budgetChangeMinor, a.currency) : null, c.newEndDate ? `end date to ${formatDay(c.newEndDate)}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    {c.status === "proposed" && (
                      <>
                        <Button
                          className={small}
                          disabled={act.isPending}
                          onClick={() => act.mutate({ path: `/change-requests/${c.id}/approve`, message: `${c.title} approved` })}
                          aria-label={`Approve ${c.title}`}
                        >
                          Approve
                        </Button>
                        <Button
                          className={small}
                          disabled={act.isPending}
                          onClick={() => act.mutate({ path: `/change-requests/${c.id}/reject`, message: `${c.title} rejected` })}
                          aria-label={`Reject ${c.title}`}
                        >
                          Reject
                        </Button>
                        <Button className={small} onClick={() => setOpen({ change: c })} aria-label={`Edit ${c.title}`}>
                          Edit
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Consultants" action={d.roles.length > 0 ? <Button onClick={() => setOpen("consultant")}>Add consultant</Button> : undefined}>
            {d.roles.length === 0 && (
              <p className="text-ink-2">
                To name consultants, first add day rates for{" "}
                <Link to={`/vendors?open=${a.vendorId}`} className="font-semibold text-accent-ink underline-offset-2 hover:underline">
                  {a.vendorName}
                </Link>{" "}
                under Money in the vendor's panel.
              </p>
            )}
            {d.roles.length > 0 && d.consultants.length === 0 && <p className="text-ink-2">Nobody named yet.</p>}
            <ul aria-label="Consultants" className="flex flex-col">
              {d.consultants.map((c) => (
                <li key={c.id} className="flex items-center gap-3 border-b border-line py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block truncate text-[13px] text-ink-2">{c.role}</span>
                  </span>
                  <span className="num text-ink-2">{c.dayRateMinor == null ? "No rate yet" : `${formatMoney(c.dayRateMinor, c.currency!)} a day`}</span>
                  <Button className={small} onClick={() => setOpen({ consultant: c })} aria-label={`Edit ${c.name}`}>
                    Edit
                  </Button>
                  <ConfirmButton
                    className={small}
                    disabled={act.isPending}
                    onConfirm={() => act.mutate({ path: `/consultants/${c.id}`, method: "DELETE", message: `Removed ${c.name}` })}
                    label={`Remove ${c.name}`}
                  />
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      {open === "milestone" && <MilestoneForm sow={a} onClose={() => setOpen(null)} onSaved={() => done("Milestone added")} />}
      {open && typeof open === "object" && "milestone" in open && (
        <MilestoneForm sow={a} milestone={open.milestone} onClose={() => setOpen(null)} onSaved={() => done("Milestone saved")} />
      )}
      {open === "change" && <ChangeForm sow={a} onClose={() => setOpen(null)} onSaved={() => done("Change request added")} />}
      {open && typeof open === "object" && "change" in open && (
        <ChangeForm sow={a} change={open.change} onClose={() => setOpen(null)} onSaved={() => done("Change request saved")} />
      )}
      {open === "consultant" && <ConsultantForm sow={a} roles={d.roles} onClose={() => setOpen(null)} onSaved={() => done("Consultant added")} />}
      {open && typeof open === "object" && "consultant" in open && (
        <ConsultantForm sow={a} roles={d.roles} consultant={open.consultant} onClose={() => setOpen(null)} onSaved={() => done("Consultant saved")} />
      )}
    </>
  );
}
