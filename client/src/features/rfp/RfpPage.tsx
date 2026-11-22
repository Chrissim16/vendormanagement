import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatMoney } from "../../../../shared/money";
import { isOpen, nextStep, rfpPath, rfpStageLabels, type RfpDetail, type RfpTab } from "../../../../shared/rfp";
import { api, messageOf } from "../../lib/api";
import { formatDate, formatDateTime } from "../../lib/format";
import { useUrlState } from "../../lib/useUrlState";
import { Dialog } from "../../platform/Dialog";
import { FormFooter, TextAreaField, useForm } from "../../platform/form";
import { History } from "../../platform/History";
import { useMe } from "../../platform/session";
import { Tabs } from "../../platform/Tabs";
import { Button, ErrorState, Loading, PageHeader } from "../../platform/ui";
import { linkClass, Section } from "../overview/parts";
import { CandidatesTab } from "./CandidatesTab";
import { DecisionTab } from "./DecisionTab";
import { DocumentTab, type Kept } from "./DocumentTab";
import { StagePill, useAdoptRfp } from "./parts";
import { ResponsesTab } from "./ResponsesTab";
import { ReviewTab } from "./ReviewTab";
import { DemandForm } from "./RfpsPage";
import { ScoringTab } from "./ScoringTab";

const tabs: { id: RfpTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "document", label: "Document" },
  { id: "review", label: "Review" },
  { id: "candidates", label: "Candidates" },
  { id: "responses", label: "Responses" },
  { id: "scoring", label: "Scoring" },
  { id: "decision", label: "Decision" },
  // The history has its own tab at every stage, so it never pushes the demand down (Q-11).
  { id: "history", label: "History" },
];

/** Where the RFP stands on its way from drafting to decided (Q-11). */
function Stages({ rfp }: { rfp: RfpDetail }) {
  const at = rfpPath.indexOf(rfp.stage);
  return (
    <ol aria-label="Stages" className="flex flex-wrap gap-x-2 gap-y-2">
      {rfpPath.map((s, i) => {
        const done = at > i;
        const current = at === i;
        return (
          <li
            key={s}
            aria-current={at === i ? "step" : undefined}
            className={clsx(
              "flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold",
              current ? "bg-primary text-primary-on" : done ? "bg-tint text-accent-ink" : "bg-sunk text-ink-2",
            )}
          >
            <span className="num">{i + 1}</span>
            {rfpStageLabels[s]}
            <span className="sr-only">{current ? " (current stage)" : done ? " (done)" : " (still to come)"}</span>
          </li>
        );
      })}
    </ol>
  );
}

function CancelForm({ rfp, onClose, onSaved }: { rfp: RfpDetail; onClose: () => void; onSaved: (r: RfpDetail) => void }) {
  const form = useForm({ reason: "" }, (v) => api<RfpDetail>(`/rfps/${rfp.id}/cancel`, { body: v }), {
    onSaved,
    check: (v) => ({ reason: v.reason.trim() ? "" : "Say why the RFP is cancelled." }),
  });
  return (
    <Dialog title="Cancel this RFP" onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <p className="-mt-2 text-ink-2">A cancelled RFP stays in the list with everything recorded so far, but nothing on it can be changed any more. This cannot be undone.</p>
        <TextAreaField form={form} name="reason" label="Reason" value={form.values.reason} maxLength={1000} onChange={(e) => form.set("reason", e.target.value)} />
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Cancel the RFP" onCancel={onClose} />
      </form>
    </Dialog>
  );
}

function Overview({ rfp, onEdit, onCancel }: { rfp: RfpDetail; onEdit: () => void; onCancel: () => void }) {
  const facts: [string, string][] = [
    ["Budget", rfp.budgetMinor == null ? "Not set" : formatMoney(rfp.budgetMinor, rfp.currency)],
    ["Sponsor", rfp.sponsor ?? "Not set"],
    ["Demand approved on", rfp.demandApprovedOn ? formatDate(rfp.demandApprovedOn) : "Not set"],
    ["Decision wanted by", rfp.targetDecisionDate ? formatDate(rfp.targetDecisionDate) : "Not set"],
    ["Owner", rfp.ownerName],
    ["How the score is made up", `Written answers ${rfp.writtenWeight}%, demo and interview ${rfp.demoWeight}%`],
  ];
  return (
    <>
      <Section
        title="The demand"
        more={
          isOpen(rfp.stage) && (
            <>
              <Button onClick={onCancel}>Cancel RFP</Button>
              <Button onClick={onEdit}>Change the demand</Button>
            </>
          )
        }
      >
        <p className="max-w-[78ch] whitespace-pre-line">{rfp.need}</p>
        <dl aria-label="Demand" className="grid grid-cols-3 gap-x-8 gap-y-5 border-t border-line pt-5">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[12.5px] font-medium text-ink-2">{label}</dt>
              <dd className="num mt-1 font-medium">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[13px] text-ink-2">
          Created {formatDateTime(rfp.createdAt)}
          {rfp.createdBy ? ` by ${rfp.createdBy}` : ""}. The budget and the sponsor stay inside the team: they are in the review copy and the decision record, never in what goes to
          a candidate.
        </p>
      </Section>
    </>
  );
}

/** One RFP from demand to decision (Q-1 to Q-11): the stage it is in, the next step, and a tab for each part of the work. */
export function RfpPage() {
  const { id = "" } = useParams();
  const me = useMe();
  const adopt = useAdoptRfp(id);
  const [url, setUrl] = useUrlState({ tab: "" });
  const [dialog, setDialog] = useState<"edit" | "cancel" | null>(null);
  const opened = useRef<{ id: string; tab: RfpTab } | null>(null);
  // Unsaved changes to the document, kept here while another tab is looked at.
  const kept: Kept = useRef(null);
  const q = useQuery({ queryKey: ["rfp", id], queryFn: () => api<RfpDetail>(`/rfps/${id}`), retry: false });
  if (q.isPending) return <Loading />;
  if (q.isError)
    return (
      <>
        <PageHeader title="RFP not found" />
        <ErrorState message={messageOf(q.error)} />
        <Link to="/rfps" className={`underline ${linkClass}`}>
          Back to the RFPs
        </Link>
      </>
    );
  const rfp = q.data;
  const next = nextStep(rfp, me.id);
  // Without a choice of its own the page opens where the next step is done, and stays there: a change that moves the next step on must not switch the tab under the reader.
  if (opened.current?.id !== rfp.id) {
    opened.current = { id: rfp.id, tab: next.tab };
    kept.current = null;
  }
  const tab = tabs.some((t) => t.id === url.tab) ? (url.tab as RfpTab) : opened.current.tab;
  return (
    <>
      <PageHeader
        context={
          <>
            <Link to="/rfps" className={`underline ${linkClass}`}>
              RFPs
            </Link>{" "}
            · owned by {rfp.ownerName}
            {rfp.targetDecisionDate ? ` · decision wanted by ${formatDate(rfp.targetDecisionDate)}` : ""}
          </>
        }
        title={rfp.title}
      >
        <StagePill stage={rfp.stage} />
      </PageHeader>

      {rfp.stage !== "cancelled" && <Stages rfp={rfp} />}
      <section aria-label="Next step" className="-mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-tile bg-sunk px-7 py-5">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ink-2">{isOpen(rfp.stage) ? "Next step" : "Outcome"}</p>
          <h2 className="mt-1 text-base font-semibold">{next.title}</h2>
          <p className="mt-1 max-w-[86ch] text-ink-2">{next.text}</p>
        </div>
        {tab !== next.tab && isOpen(rfp.stage) && <Button onClick={() => setUrl({ tab: next.tab }, { push: true })}>Go to {tabs.find((t) => t.id === next.tab)!.label}</Button>}
      </section>

      <Tabs label="Parts of this RFP" tabs={tabs} value={tab} onChange={(t) => setUrl({ tab: t }, { push: true })}>
        <div className="flex flex-col gap-10">
          {tab === "overview" && <Overview rfp={rfp} onEdit={() => setDialog("edit")} onCancel={() => setDialog("cancel")} />}
          {tab === "document" && <DocumentTab rfp={rfp} keep={kept} />}
          {tab === "review" && <ReviewTab rfp={rfp} unsaved={!!kept.current} onDocument={() => setUrl({ tab: "document" }, { push: true })} />}
          {tab === "candidates" && <CandidatesTab rfp={rfp} />}
          {tab === "responses" && <ResponsesTab rfp={rfp} />}
          {tab === "scoring" && <ScoringTab rfp={rfp} />}
          {tab === "decision" && <DecisionTab rfp={rfp} />}
          {tab === "history" && <History entityType="rfp" entityId={rfp.id} />}
        </div>
      </Tabs>

      {dialog === "edit" && (
        <DemandForm
          rfp={rfp}
          onClose={() => setDialog(null)}
          onSaved={(r) => {
            setDialog(null);
            adopt(r, "Demand saved");
          }}
        />
      )}
      {dialog === "cancel" && (
        <CancelForm
          rfp={rfp}
          onClose={() => setDialog(null)}
          onSaved={(r) => {
            setDialog(null);
            adopt(r, "RFP cancelled");
          }}
        />
      )}
    </>
  );
}
