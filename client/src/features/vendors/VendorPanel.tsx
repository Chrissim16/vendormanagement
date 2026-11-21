import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { kindLabels, statusLabels, type Agreement } from "../../../../shared/agreements";
import { formatDay } from "../../../../shared/dates";
import { formatMoney } from "../../../../shared/money";
import type { Page } from "../../../../shared/types";
import { vendorStatusLabels, vendorTypeLabels, type Contact, type Paperwork, type VendorDetail } from "../../../../shared/vendors";
import { api, messageOf } from "../../lib/api";
import { Dialog } from "../../platform/Dialog";
import { CheckField, FormFooter, Grid, TextField, useForm } from "../../platform/form";
import { History } from "../../platform/History";
import { Panel } from "../../platform/SplitView";
import { Tabs } from "../../platform/Tabs";
import { Button, ErrorState, Loading, Pill, type Tone } from "../../platform/ui";
import { AgreementForm } from "../agreements/AgreementForm";
import { agreementTone } from "../agreements/display";
import { VendorForm } from "./VendorForm";

const paper: Record<Paperwork, [Tone, string]> = { in_place: ["ok", "In place"], missing: ["bad", "Missing"], expired: ["bad", "Expired"], not_required: ["none", "Not required"] };
export const vendorTone = (status: VendorDetail["status"]): Tone => (status === "active" ? "ok" : status === "on_hold" ? "warn" : "none");

function ContactForm({ vendorId, contact, onClose, onSaved }: { vendorId: string; contact?: Contact; onClose: () => void; onSaved: () => void }) {
  const form = useForm(
    { name: contact?.name ?? "", jobTitle: contact?.jobTitle ?? "", email: contact?.email ?? "", phone: contact?.phone ?? "", isPrimary: contact?.isPrimary ?? false },
    (v) => api<Contact[]>(contact ? `/contacts/${contact.id}` : `/vendors/${vendorId}/contacts`, { method: contact ? "PATCH" : "POST", body: v }),
    { onSaved },
  );
  const { values: v, set } = form;
  return (
    <Dialog title={contact ? `Edit ${contact.name}` : "Add contact"} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <Grid>
          <TextField form={form} name="name" label="Name" value={v.name} onChange={(e) => set("name", e.target.value)} autoFocus />
          <TextField form={form} name="jobTitle" label="Job title (optional)" value={v.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
          <TextField form={form} name="email" label="Email (optional)" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />
          <TextField form={form} name="phone" label="Phone (optional)" value={v.phone} onChange={(e) => set("phone", e.target.value)} />
        </Grid>
        <CheckField id="f-isPrimary" label="Primary contact" hint="A vendor has one primary contact." checked={v.isPrimary} onChange={(x) => set("isPrimary", x)} />
        <FormFooter problem={form.problem} busy={form.busy} submitLabel={contact ? "Save changes" : "Add contact"} onCancel={onClose} />
      </form>
    </Dialog>
  );
}

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <>
    <dt className="text-ink-2">{label}</dt>
    <dd className="min-w-0 break-words">{children}</dd>
  </>
);

export function AgreementRow({ a, indent }: { a: Agreement; indent?: boolean }) {
  const value = a.budgetMinor ?? a.annualValueMinor;
  return (
    <Link
      to={`/agreements/${a.id}`}
      className={`group flex items-center gap-3.5 border-b border-line py-3.5 transition-[padding] duration-300 ease-out hover:pl-2.5 ${indent ? "ml-6 border-l border-l-line-2 pl-4" : ""}`}
    >
      <Pill tone={a.kind === "sow" ? "brand" : "none"}>{kindLabels[a.kind]}</Pill>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{a.title}</span>
        <span className="block truncate text-[13px] text-ink-2">
          {a.status === "ended"
            ? `Ended${a.endDate ? ` ${formatDay(a.endDate)}` : ""}`
            : a.endDate
              ? `${a.kind === "subscription" ? "Renews" : a.kind === "sow" ? "Ends" : "Valid until"} ${formatDay(a.endDate)}`
              : a.kind === "msa" && a.status === "active"
                ? "Runs indefinitely"
                : statusLabels[a.status]}
        </span>
      </span>
      <Pill tone={agreementTone(a.status)}>{statusLabels[a.status]}</Pill>
      {value != null && <span className="num text-ink-2">{formatMoney(value, a.currency)}</span>}
    </Link>
  );
}

type Tab = "overview" | "contacts" | "agreements" | "history";

export function VendorPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<null | "edit" | "contact" | "agreement" | Contact>(null);
  const q = useQuery({ queryKey: ["vendor", id], queryFn: () => api<VendorDetail>(`/vendors/${id}`), retry: false });
  const agreements = useQuery({
    queryKey: ["agreements", { vendorId: id }],
    queryFn: () => api<Page<Agreement>>("/agreements", { query: { vendorId: id, pageSize: 200, sort: "title" } }),
  });
  const refresh = () => qc.invalidateQueries();
  const remove = useMutation({
    mutationFn: (c: Contact) => api(`/contacts/${c.id}`, { method: "DELETE" }),
    onSuccess: async (_r, c) => {
      toast.success(`Removed ${c.name}`);
      await refresh();
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  if (q.isError) {
    return (
      <Panel title="Vendor not found" onClose={onClose}>
        <ErrorState message={messageOf(q.error)} />
      </Panel>
    );
  }
  if (!q.data) {
    return (
      <Panel title="Loading" onClose={onClose}>
        <Loading rows={3} />
      </Panel>
    );
  }
  const v = q.data;
  const list = agreements.data?.items ?? [];
  const msas = list.filter((a) => a.kind === "msa");
  const loose = list.filter((a) => a.kind !== "msa" && !(a.kind === "sow" && a.parentMsaId && msas.some((m) => m.id === a.parentMsaId)));
  const saved = async (message: string) => {
    setDialog(null);
    toast.success(message);
    await refresh();
  };

  return (
    <Panel context={`${vendorTypeLabels[v.type]} · owned by ${v.ownerName}`} title={v.name} onClose={onClose}>
      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <Pill tone={vendorTone(v.status)}>{vendorStatusLabels[v.status]}</Pill>
        {!v.scoringEnabled && <Pill>Not scored</Pill>}
        <span className="flex-1" />
        <Button onClick={() => setDialog("edit")}>Edit vendor</Button>
      </div>
      <Tabs
        label="Vendor sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "contacts", label: `Contacts (${v.contacts.length})` },
          { id: "agreements", label: `Agreements (${list.length})` },
          { id: "history", label: "History" },
        ]}
      >
        {tab === "overview" && (
          <>
            <dl className="grid grid-cols-[190px_minmax(0,1fr)] gap-x-4 gap-y-3">
              <Fact label="NDA">
                <Pill tone={paper[v.nda][0]}>{paper[v.nda][1]}</Pill>
              </Fact>
              <Fact label="Data processing agreement">
                <Pill tone={paper[v.dpa][0]}>{paper[v.dpa][1]}</Pill>
              </Fact>
              <Fact label="Active agreements">
                <span className="num">{v.activeAgreements}</span>
              </Fact>
              <Fact label="Primary contact">{v.contacts.find((c) => c.isPrimary)?.name ?? <span className="text-ink-2">None yet</span>}</Fact>
              {v.legalName && <Fact label="Legal name">{v.legalName}</Fact>}
              {v.country && <Fact label="Country">{v.country}</Fact>}
              {v.website && (
                <Fact label="Website">
                  <a href={v.website} target="_blank" rel="noreferrer noopener" className="font-medium text-accent-ink underline-offset-2 hover:underline">
                    {v.website.replace(/^https?:\/\//, "")}
                  </a>
                </Fact>
              )}
              {v.description && <Fact label="What they do for us">{v.description}</Fact>}
            </dl>
            <p className="rounded-2xl bg-sunk px-5 py-3.5 text-[13px] text-ink-2">
              Money, performance and RFPs for this vendor will appear here as those parts of the app are built.
            </p>
          </>
        )}
        {tab === "contacts" && (
          <>
            {v.contacts.length === 0 && <p className="text-ink-2">No contacts yet. Add the person you call first.</p>}
            <ul className="flex flex-col">
              {v.contacts.map((c) => (
                <li key={c.id} className="flex items-center gap-3 border-b border-line py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block truncate text-[13px] text-ink-2">{[c.jobTitle, c.email, c.phone].filter(Boolean).join(" · ") || "No details"}</span>
                  </span>
                  {c.isPrimary && <Pill tone="brand">Primary</Pill>}
                  <Button className="h-8 px-3.5 text-[12.5px]" onClick={() => setDialog(c)} aria-label={`Edit ${c.name}`}>
                    Edit
                  </Button>
                  <Button className="h-8 px-3.5 text-[12.5px]" onClick={() => remove.mutate(c)} aria-label={`Remove ${c.name}`}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <div>
              <Button onClick={() => setDialog("contact")}>Add contact</Button>
            </div>
          </>
        )}
        {tab === "agreements" && (
          <>
            {agreements.isPending && <Loading rows={3} />}
            {agreements.data && list.length === 0 && <p className="text-ink-2">No agreements yet. Start with the MSA or the NDA.</p>}
            <div className="flex flex-col">
              {msas.map((m) => (
                <div key={m.id}>
                  <AgreementRow a={m} />
                  {list
                    .filter((a) => a.parentMsaId === m.id)
                    .map((a) => (
                      <AgreementRow key={a.id} a={a} indent />
                    ))}
                </div>
              ))}
              {loose.map((a) => (
                <AgreementRow key={a.id} a={a} />
              ))}
            </div>
            {v.status !== "offboarded" && (
              <div>
                <Button onClick={() => setDialog("agreement")}>Add agreement</Button>
              </div>
            )}
          </>
        )}
        {tab === "history" && <History entityType="vendor" entityId={v.id} />}
      </Tabs>

      {dialog === "edit" && <VendorForm vendor={v} onClose={() => setDialog(null)} onSaved={(x) => saved(`Saved ${x.name}`)} />}
      {dialog === "contact" && <ContactForm vendorId={v.id} onClose={() => setDialog(null)} onSaved={() => saved("Contact added")} />}
      {dialog && typeof dialog === "object" && <ContactForm vendorId={v.id} contact={dialog} onClose={() => setDialog(null)} onSaved={() => saved("Contact saved")} />}
      {dialog === "agreement" && <AgreementForm vendorId={v.id} onClose={() => setDialog(null)} onSaved={(a) => saved(`Added ${a.title}`)} />}
    </Panel>
  );
}
