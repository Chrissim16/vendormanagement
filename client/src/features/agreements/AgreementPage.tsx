import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { kindLabels, pricingLabels, statusLabels, type AgreementDetail, type DocumentInfo } from "../../../../shared/agreements";
import { daysBetween, formatDay } from "../../../../shared/dates";
import type { DocumentReading } from "../../../../shared/reading";
import { formatMoney } from "../../../../shared/money";
import { api, ApiError, messageOf } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { DOCUMENT_EXTENSIONS, DropZone, FileButton, FileProblems, useAttachEach } from "../../platform/files";
import { History } from "../../platform/History";
import { useToday } from "../../platform/session";
import { Button, ErrorState, Loading, PageHeader, Pill } from "../../platform/ui";
import { InvoicesSection } from "../invoices/InvoicesSection";
import { SowDelivery } from "../sow/SowDelivery";
import { AgreementForm } from "./AgreementForm";
import { AgreementReadings } from "./DocumentReadings";
import { DecisionDialog } from "./DecisionDialog";
import { agreementTone, day, renewalPill } from "./display";

const Fact = ({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) => (
  <div className="min-w-0">
    <p className="text-[13.5px] font-medium text-ink-2">{label}</p>
    <p className="num mt-2 truncate text-[26px] font-semibold leading-tight tracking-[-0.02em]">{value}</p>
    {note && <p className="mt-1 text-[12.5px] text-ink-3">{note}</p>}
  </div>
);
const Section = ({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <section className="flex min-w-0 flex-col gap-3">
    <div className="flex items-center gap-3">
      <h2 className="flex-1 text-base font-semibold">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);
const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);
const reasonLabels = { completed: "Completed", expired: "Expired", terminated: "Terminated", replaced: "Replaced" } as const;
/** How far off the notice deadline is, for a subscription with nothing due yet. The same count the renewals page shows. */
const daysLeft = (today: string, deadline: string) => {
  const n = daysBetween(today, deadline);
  return `${n} ${n === 1 ? "day" : "days"} to the notice deadline`;
};
const decisionLabels = { renew: "Renew", renegotiate: "Renegotiate", terminate: "Terminate" } as const;

function Documents({ a }: { a: AgreementDetail }) {
  const qc = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const done = () => qc.invalidateQueries();
  // A-5, X-7: one or several files, picked or dropped, each checked and sent in turn.
  const upload = useAttachEach((file) => api<DocumentInfo>(`/agreements/${a.id}/documents`, { file }), { after: done });
  // A refused drop is listed with the refused files, and gives way to the next attach's outcome.
  const show = (message: string) => {
    setProblem(null);
    upload.setProblems([message]);
  };
  const attach = (files: File[]) => {
    setProblem(null);
    void upload.attach(files);
  };
  // E-1: what the AI read in these documents, and asking it to read one.
  const readings = useQuery({ queryKey: ["agreement", a.id, "readings"], queryFn: () => api<DocumentReading[]>(`/agreements/${a.id}/readings`) });
  const read = useMutation({
    mutationFn: (documentId: string) => api<DocumentReading>(`/documents/${documentId}/reading`, { method: "POST" }),
    onSuccess: async (r) => {
      setProblem(null);
      await done();
      // The reading is shown across the page, above this section: take the reader, and the keyboard, there.
      requestAnimationFrame(() => {
        const panel = document.getElementById(`reading-${r.documentId}`);
        panel?.scrollIntoView({ block: "center", behavior: "smooth" });
        panel?.focus({ preventScroll: true });
      });
    },
    onError: (e) => setProblem(messageOf(e)),
  });
  const wasRead = new Set((readings.data ?? []).map((r) => r.documentId));
  const remove = useMutation({
    mutationFn: (d: DocumentInfo) => api(`/documents/${d.id}`, { method: "DELETE" }),
    onSuccess: async (_r, d) => {
      toast.success(`Removed ${d.fileName}`);
      await done();
    },
    onError: (e) => setProblem(messageOf(e)),
  });
  return (
    <DropZone enabled label="Drop to attach" multiple busy={upload.busy} onFiles={attach} onProblem={show}>
      <Section
        title="Documents"
        action={<FileButton label="Attach document" chooserLabel="Choose a document to attach" accept={DOCUMENT_EXTENSIONS} multiple busy={upload.busy} onFiles={attach} />}
      >
        {problem && <ErrorState message={problem} />}
        <FileProblems problems={upload.problems} />
        {a.documents.length === 0 ? (
          <p className="text-ink-2">No documents attached. PDF, Word and Excel files up to 25 MB can be added.</p>
        ) : (
          <ul className="flex flex-col">
            {a.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 border-b border-line py-3.5">
                <span className="min-w-0 flex-1">
                  <a href={`/api/documents/${d.id}/download`} download className="block truncate font-semibold text-accent-ink underline-offset-2 hover:underline">
                    {d.fileName}
                  </a>
                  <span className="num block text-[13px] text-ink-2">
                    {size(d.sizeBytes)} · added {formatDate(d.createdAt)} by {d.createdBy ?? "someone"}
                    {d.readable === false && " · no readable text, so it cannot be searched or read by the AI"}
                  </span>
                </span>
                {d.readable && !wasRead.has(d.id) && (
                  <Button
                    className={`h-8 px-3.5 text-[12.5px] ${read.isPending && read.variables === d.id ? "cursor-progress" : ""}`}
                    onClick={() => !read.isPending && read.mutate(d.id)}
                    aria-disabled={read.isPending || undefined}
                    aria-label={`Read with AI: ${d.fileName}`}
                  >
                    {read.isPending && read.variables === d.id ? "Reading" : "Read with AI"}
                  </Button>
                )}
                <Button className="h-8 px-3.5 text-[12.5px]" onClick={() => remove.mutate(d)} aria-label={`Remove ${d.fileName}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </DropZone>
  );
}

export function AgreementPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const today = useToday();
  const [dialog, setDialog] = useState<null | "edit" | "decision">(null);
  const q = useQuery({ queryKey: ["agreement", id], queryFn: () => api<AgreementDetail>(`/agreements/${id}`), retry: false });
  if (q.isPending) return <Loading />;
  if (q.isError) {
    return (
      <>
        <PageHeader
          title={q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400) ? "That agreement does not exist" : "The agreement could not be loaded"}
        />
        <ErrorState
          message={
            q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400) ? "The link may be old, or the agreement may never have existed." : messageOf(q.error)
          }
          onRetry={q.error instanceof ApiError && q.error.status < 500 && q.error.status !== 0 ? undefined : () => void q.refetch()}
        />
      </>
    );
  }
  const a = q.data;
  const pill = renewalPill(a, today);
  const value = a.budgetMinor ?? a.annualValueMinor;
  const saved = async (message: string) => {
    setDialog(null);
    toast.success(message);
    await qc.invalidateQueries();
  };

  return (
    <>
      <PageHeader
        context={
          <>
            <Link to={`/vendors?open=${a.vendorId}`} className="text-accent-ink underline-offset-2 hover:underline">
              {a.vendorName}
            </Link>
            {a.parent && (
              <>
                {" · under "}
                <Link to={`/agreements/${a.parent.id}`} className="text-accent-ink underline-offset-2 hover:underline">
                  {a.parent.title}
                </Link>
              </>
            )}
            {a.reference && ` · ${a.reference}`}
          </>
        }
        title={a.title}
      >
        <Pill tone={a.kind === "sow" ? "brand" : "none"}>{kindLabels[a.kind]}</Pill>
        <Pill tone={agreementTone(a.status)}>{statusLabels[a.status]}</Pill>
        {a.pricing && <Pill>{pricingLabels[a.pricing]}</Pill>}
        {a.status === "ended" && a.endReason && <Pill>{reasonLabels[a.endReason]}</Pill>}
        <Button onClick={() => setDialog("edit")}>Edit or change status</Button>
      </PageHeader>

      <div className="grid grid-cols-4 gap-8 border-t border-line pt-6">
        {a.kind === "subscription" && <Fact label="Annual value" value={value == null ? "–" : formatMoney(value, a.currency)} />}
        <Fact label="Signed on" value={day(a.signedOn)} />
        {a.kind !== "nda" && a.kind !== "dpa" && <Fact label="Starts" value={day(a.startDate)} />}
        {a.kind === "msa" ? (
          <Fact label="Ends" value={a.status === "ended" ? day(a.endDate) : "No end date"} note={a.status === "ended" ? undefined : "Runs until someone ends it"} />
        ) : (
          <Fact
            label={a.kind === "subscription" ? "Renews on" : a.kind === "sow" ? "Ends" : "Valid until"}
            value={a.endDate ? day(a.endDate) : "No end date"}
            note={a.kind === "subscription" ? (a.autoRenews ? "Renews automatically" : "Does not renew automatically") : undefined}
          />
        )}
        {a.kind === "subscription" && <Fact label="Notice deadline" value={day(a.noticeDeadline)} note={`${a.noticePeriodDays} days before renewal`} />}
        {a.kind === "subscription" && <Fact label="Invoiced so far" value={formatMoney(a.invoicedMinor, a.currency)} />}
        <Fact label="Owner" value={<span className="text-[18px]">{a.ownerName}</span>} />
      </div>

      {a.kind === "subscription" && a.status === "active" && (
        <Section title="Renewal" action={!a.decidedForTerm ? <Button onClick={() => setDialog("decision")}>Record decision</Button> : undefined}>
          <div className="flex flex-wrap items-center gap-3">
            {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : a.decidedForTerm ? <Pill tone="ok">Decided</Pill> : <Pill>{daysLeft(today, a.noticeDeadline!)}</Pill>}
            <p className="text-ink-2">
              {a.renewalState === "overdue" && `The notice deadline passed on ${formatDay(a.noticeDeadline!)} and no decision has been recorded.`}
              {a.renewalState === "due_soon" && `Decide before ${formatDay(a.noticeDeadline!)} whether to renew, renegotiate or terminate.`}
              {a.renewalState === "ok" && (a.decidedForTerm ? "A decision has been recorded for the current term." : `The notice deadline is ${formatDay(a.noticeDeadline!)}.`)}
            </p>
          </div>
          {a.decisions.length > 0 && (
            <ul className="flex flex-col">
              {a.decisions.map((d) => (
                <li key={d.id} className="border-b border-line py-3">
                  <p>
                    <span className="font-semibold">{decisionLabels[d.decision]}</span> for the term ending {formatDay(d.termEndDate)}
                    {d.notes && <span className="text-ink-2">: {d.notes}</span>}
                  </p>
                  <p className="text-[13px] text-ink-2">
                    {d.decidedBy} · {formatDay(d.decidedOn)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {a.kind === "msa" && (
        <Section title="SOWs under this MSA">
          {a.children.length === 0 ? (
            <p className="text-ink-2">No SOWs sit under this MSA yet.</p>
          ) : (
            <ul className="flex flex-col">
              {a.children.map((c) => (
                <li key={c.id}>
                  <Link to={`/agreements/${c.id}`} className="flex items-center gap-3.5 border-b border-line py-3.5 transition-[padding] duration-300 ease-out hover:pl-2.5">
                    <Pill tone="brand">SOW</Pill>
                    <span className="min-w-0 flex-1 truncate font-semibold">{c.title}</span>
                    <Pill tone={agreementTone(c.status)}>{statusLabels[c.status]}</Pill>
                    <span className="num w-28 text-right text-ink-2">{day(c.endDate)}</span>
                    <span className="num w-32 text-right">{c.budgetMinor == null ? "–" : formatMoney(c.budgetMinor, c.currency)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {a.kind === "sow" && <SowDelivery agreement={a} />}

      <AgreementReadings agreementId={a.id} />

      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-14">
        <div className="flex min-w-0 flex-col gap-10">
          {(a.kind === "sow" || a.kind === "subscription") && <InvoicesSection agreement={a} />}
          <Documents key={a.id} a={a} />
          {a.notes && (
            <Section title="Notes">
              <p className="whitespace-pre-wrap text-ink-2">{a.notes}</p>
            </Section>
          )}
        </div>
        <History entityType="agreement" entityId={a.id} />
      </div>

      {dialog === "edit" && <AgreementForm agreement={a} onClose={() => setDialog(null)} onSaved={(x) => saved(`Saved ${x.title}`)} />}
      {dialog === "decision" && <DecisionDialog agreement={a} today={today} onClose={() => setDialog(null)} onSaved={() => saved("Decision recorded")} />}
    </>
  );
}
