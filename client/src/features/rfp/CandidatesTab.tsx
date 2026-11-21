import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { candidateListLabels, candidateLists, inEvaluation, isOpen, ndaInPlace, type Candidate, type CandidateList, type RfpDetail } from "../../../../shared/rfp";
import type { Page } from "../../../../shared/types";
import { vendorStatusLabels, vendorTypeLabels, vendorTypes, type Vendor } from "../../../../shared/vendors";
import { api, messageOf } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { Dialog } from "../../platform/Dialog";
import { CheckField, FormFooter, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { useToday } from "../../platform/session";
import { Button, ConfirmButton, ErrorState, Pill, Segmented } from "../../platform/ui";
import { linkClass, Nothing, Section } from "../overview/parts";
import { downloadClass, useAdoptRfp, useRfpChange } from "./parts";

/** Q-4: a vendor already in the app, or a new one that becomes a prospect. */
function AddCandidate({ rfp, onClose, onSaved }: { rfp: RfpDetail; onClose: () => void; onSaved: (r: RfpDetail, name: string) => void }) {
  const vendors = useQuery({
    queryKey: ["vendors", "candidates"],
    queryFn: async () => (await api<Page<Vendor>>("/vendors", { query: { status: "all", pageSize: 200, sort: "name" } })).items.filter((v) => v.status !== "offboarded"),
  });
  const taken = new Set(rfp.candidates.map((c) => c.vendorId));
  const form = useForm(
    { known: "yes" as "yes" | "no", vendorId: "", name: "", type: "", list: "longlist" as "longlist" | "shortlist", reason: "" },
    async (v) => {
      const body = { list: v.list, reason: v.reason, ...(v.known === "yes" ? { vendorId: v.vendorId } : { newVendor: { name: v.name, type: v.type } }) };
      return {
        rfp: await api<RfpDetail>(`/rfps/${rfp.id}/candidates`, { body }),
        name: v.known === "yes" ? (vendors.data?.find((x) => x.id === v.vendorId)?.name ?? "The vendor") : v.name.trim(),
      };
    },
    {
      onSaved: (r) => onSaved(r.rfp, r.name),
      check: (v) => ({
        vendorId: v.known === "yes" && !v.vendorId ? "Choose a vendor." : "",
        "newVendor.name": v.known === "no" && !v.name.trim() ? "Give the vendor a name." : "",
        "newVendor.type": v.known === "no" && !v.type ? "Choose a type." : "",
        reason: v.reason.trim() ? "" : "Give the reason.",
      }),
    },
  );
  const { values: v, set } = form;
  return (
    <Dialog title="Add a candidate" onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <Segmented
          label="Which vendor"
          value={v.known}
          onChange={(known) => form.patch({ known, vendorId: "", name: "", type: "" })}
          options={[
            { value: "yes", label: "A vendor already in the app" },
            { value: "no", label: "A new vendor" },
          ]}
        />
        {vendors.isError && <ErrorState message={messageOf(vendors.error)} onRetry={() => void vendors.refetch()} />}
        {v.known === "yes" ? (
          <SelectField form={form} name="vendorId" label="Vendor" value={v.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
            <option value="">{vendors.isPending ? "Loading vendors" : "Choose a vendor"}</option>
            {vendors.data
              ?.filter((x) => !taken.has(x.id))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({vendorStatusLabels[x.status].toLowerCase()})
                </option>
              ))}
          </SelectField>
        ) : (
          <>
            <TextField form={form} name="newVendor.name" label="Vendor name" value={v.name} maxLength={200} onChange={(e) => set("name", e.target.value, ["newVendor.name"])} />
            <SelectField form={form} name="newVendor.type" label="Type" value={v.type} onChange={(e) => set("type", e.target.value, ["newVendor.type"])}>
              <option value="">Choose a type</option>
              {vendorTypes.map((t) => (
                <option key={t} value={t}>
                  {vendorTypeLabels[t]}
                </option>
              ))}
            </SelectField>
            <p className="text-[13px] text-ink-2">The vendor is added to Vendors as a prospect, with you as its owner. It becomes active only if it wins.</p>
          </>
        )}
        <Segmented
          label="List"
          value={v.list}
          onChange={(list) => set("list", list)}
          options={[
            { value: "longlist", label: "Longlist" },
            { value: "shortlist", label: "Shortlist" },
          ]}
        />
        <TextAreaField
          form={form}
          name="reason"
          label="Reason"
          value={v.reason}
          maxLength={1000}
          onChange={(e) => set("reason", e.target.value)}
          placeholder="Why this vendor is on the list"
        />
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Add candidate" onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Moves a candidate to another list, with the reason for where it now stands. */
function MoveCandidate({ candidate: c, onClose, onSaved }: { candidate: Candidate; onClose: () => void; onSaved: (r: RfpDetail, list: CandidateList) => void }) {
  const form = useForm(
    { list: c.list === "longlist" ? ("shortlist" as CandidateList) : c.list === "shortlist" ? ("dropped" as CandidateList) : ("shortlist" as CandidateList), reason: "" },
    async (v) => ({ rfp: await api<RfpDetail>(`/rfp-candidates/${c.id}`, { method: "PATCH", body: v }), list: v.list }),
    { onSaved: (r) => onSaved(r.rfp, r.list), check: (v) => ({ reason: v.reason.trim() ? "" : "Give the reason." }) },
  );
  const { values: v, set } = form;
  return (
    <Dialog title={`Move ${c.vendorName}`} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <p className="-mt-2 text-ink-2">
          Now on: {candidateListLabels[c.list].toLowerCase()}. Reason given: {c.reason}
        </p>
        <SelectField form={form} name="list" label="Move to" value={v.list} onChange={(e) => set("list", e.target.value as CandidateList)}>
          {candidateLists
            .filter((l) => l !== c.list && !(c.issuedOn && l === "longlist"))
            .map((l) => (
              <option key={l} value={l}>
                {candidateListLabels[l]}
              </option>
            ))}
        </SelectField>
        <TextAreaField form={form} name="reason" label="Reason" value={v.reason} maxLength={1000} onChange={(e) => set("reason", e.target.value)} placeholder="Why it moves" />
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Move candidate" onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Q-5: records that the RFP went out. Without an NDA in place the warning has to be acknowledged first. */
function IssueCandidate({ rfp, candidate: c, onClose, onSaved }: { rfp: RfpDetail; candidate: Candidate; onClose: () => void; onSaved: (r: RfpDetail) => void }) {
  const today = useToday();
  const withoutNda = !ndaInPlace(c);
  const form = useForm({ issuedOn: today, ndaWarningAcknowledged: false }, (v) => api<RfpDetail>(`/rfp-candidates/${c.id}/issue`, { body: v }), {
    onSaved,
    check: (v) => ({
      issuedOn: !v.issuedOn ? "Enter the day of issue." : v.issuedOn > today ? "The day of issue cannot be in the future." : "",
      ndaWarningAcknowledged: withoutNda && !v.ndaWarningAcknowledged ? "Tick the box to confirm that the RFP goes out without an NDA in place." : "",
    }),
  });
  const { values: v, set } = form;
  return (
    <Dialog title={`Issue the RFP to ${c.vendorName}`} onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <p className="-mt-2 text-ink-2">
          Send {c.vendorName} its RFP (Word) and its answer sheet (Excel), then record the day here.
          {rfp.stage === "approved" &&
            " From the first issue on, the sections, criteria and questions can no longer be changed, so that every candidate answers the same questions."}
        </p>
        <TextField form={form} name="issuedOn" label="Issued on" type="date" max={today} value={v.issuedOn} onChange={(e) => set("issuedOn", e.target.value)} />
        {withoutNda && (
          <div role="alert" className="flex flex-col gap-3 rounded-2xl bg-sunk px-5 py-4">
            <p className="flex items-center gap-3">
              <Pill tone="warn">No NDA</Pill>
              <span className="font-semibold">No NDA is in place with {c.vendorName}.</span>
            </p>
            <p className="text-[13.5px] text-ink-2">
              The RFP may hold information that should stay confidential. An NDA is added on the vendor's Agreements tab; once it is active this warning goes.
            </p>
            <CheckField
              id="nda-ack"
              label="Issue the RFP anyway"
              hint="Your name is recorded with this choice."
              checked={v.ndaWarningAcknowledged}
              onChange={(x) => set("ndaWarningAcknowledged", x)}
            />
            {form.errors.ndaWarningAcknowledged && <p className="text-[12.5px] font-medium text-[var(--crit-text)]">{form.errors.ndaWarningAcknowledged}</p>}
          </div>
        )}
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Record as issued" onCancel={onClose} />
      </form>
    </Dialog>
  );
}

const ndaPill = (c: Candidate) =>
  c.nda === "in_place" ? (
    <Pill tone="ok">NDA in place</Pill>
  ) : c.nda === "not_required" ? (
    <Pill>NDA not required</Pill>
  ) : (
    <Pill tone="warn">{c.nda === "expired" ? "NDA expired" : "No NDA"}</Pill>
  );

/** Q-4 and Q-5: the longlist and the shortlist with a reason each, and issuing the RFP to the shortlist. */
export function CandidatesTab({ rfp }: { rfp: RfpDetail }) {
  const adopt = useAdoptRfp(rfp.id);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Candidate | null>(null);
  const [issuing, setIssuing] = useState<Candidate | null>(null);
  const remove = useRfpChange(rfp.id, (c: Candidate) => api<RfpDetail>(`/rfp-candidates/${c.id}`, { method: "DELETE" }), {
    done: (_r, c) => `${c.vendorName} removed from this RFP`,
  });
  const open = isOpen(rfp.stage);
  const canIssue = ["approved", "issued", "evaluating"].includes(rfp.stage);
  const approved = rfp.stage !== "drafting" && rfp.stage !== "in_review";
  const add = open && (
    <Button variant={rfp.candidates.length ? "plain" : "primary"} onClick={() => setAdding(true)}>
      Add candidate
    </Button>
  );
  const row = (c: Candidate) => {
    const inUse = !!c.issuedOn || c.answered > 0 || c.documents.length > 0 || rfp.scores.some((s) => s.candidateId === c.id);
    const won = rfp.decision?.winnerCandidateId === c.id;
    return (
      <li key={c.id} aria-label={c.vendorName} className="flex flex-col gap-2.5 border-b border-line py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link to={`/vendors?open=${c.vendorId}`} className={`font-semibold underline ${linkClass}`}>
            {c.vendorName}
          </Link>
          {won && <Pill tone="ok">Winner</Pill>}
          <Pill>{vendorStatusLabels[c.vendorStatus]}</Pill>
          {ndaPill(c)}
          {c.issuedOn && (
            <Pill tone="brand">
              Issued {formatDate(c.issuedOn)}
              {c.ndaWarningAcknowledgedBy ? ", without NDA" : ""}
            </Pill>
          )}
          {c.responseReceivedOn && <Pill tone="brand">Response {formatDate(c.responseReceivedOn)}</Pill>}
          <span className="flex-1" />
          {open && <Button onClick={() => setMoving(c)}>Move</Button>}
          {open && !inUse && <ConfirmButton label={`Remove ${c.vendorName} from this RFP`} onConfirm={() => remove.mutate(c)} disabled={remove.isPending} />}
        </div>
        <p className="max-w-[78ch] text-ink-2">{c.reason}</p>
        {c.list === "shortlist" && approved && (
          <div className="flex flex-wrap items-center gap-2.5">
            <a href={`/api/rfp-candidates/${c.id}/rfp.docx`} download className={downloadClass} aria-label={`RFP (Word) for ${c.vendorName}`}>
              RFP (Word)
            </a>
            <a href={`/api/rfp-candidates/${c.id}/answer-sheet.xlsx`} download className={downloadClass} aria-label={`Answer sheet (Excel) for ${c.vendorName}`}>
              Answer sheet (Excel)
            </a>
            {canIssue && !c.issuedOn && (
              <Button variant="primary" onClick={() => setIssuing(c)} aria-label={`Issue the RFP to ${c.vendorName}`}>
                Issue
              </Button>
            )}
            {c.ndaWarningAcknowledgedBy && <span className="text-[13px] text-ink-2">Issued without an NDA in place; acknowledged by {c.ndaWarningAcknowledgedBy}.</span>}
          </div>
        )}
      </li>
    );
  };
  const lists: [CandidateList, string][] = [
    [
      "shortlist",
      approved
        ? "No candidate is on the shortlist. Move the vendors to invite here, each with the reason."
        : "No candidate is on the shortlist yet. The RFP goes to the shortlist once it is approved.",
    ],
    ["longlist", "No candidate is on the longlist."],
    ["dropped", ""],
  ];
  return (
    <>
      {rfp.candidates.length === 0 ? (
        <Section title="Candidates" more={add}>
          <Nothing>
            No candidates yet. Add the vendors that could meet the need to the longlist, each with the reason; a vendor the app does not know yet is added as a prospect.
          </Nothing>
        </Section>
      ) : (
        lists.map(([list, nothing], i) => {
          const mine = rfp.candidates.filter((c) => c.list === list);
          if (!mine.length && !nothing) return null;
          return (
            <Section key={list} title={`${candidateListLabels[list]} (${mine.length})`} more={i === 0 ? add : undefined}>
              {list === "shortlist" && mine.length > 0 && !approved && (
                <p className="-mt-1 text-[13.5px] text-ink-2">Each candidate's RFP and answer sheet can be downloaded once the RFP is approved.</p>
              )}
              {list === "shortlist" && canIssue && mine.some((c) => !c.issuedOn) && (
                <p className="-mt-1 text-[13.5px] text-ink-2">Download each candidate's RFP and answer sheet, send them, and press Issue to record the day.</p>
              )}
              {mine.length === 0 ? (
                <Nothing>{nothing}</Nothing>
              ) : (
                <ul aria-label={candidateListLabels[list]} className="flex flex-col">
                  {mine.map(row)}
                </ul>
              )}
            </Section>
          );
        })
      )}
      {rfp.candidates.some(inEvaluation) && rfp.stage !== "decided" && <p className="text-[13px] text-ink-2">Answers are uploaded on the Responses tab.</p>}

      {adding && (
        <AddCandidate
          rfp={rfp}
          onClose={() => setAdding(false)}
          onSaved={(next, name) => {
            setAdding(false);
            adopt(next, `${name} added`);
          }}
        />
      )}
      {moving && (
        <MoveCandidate
          candidate={moving}
          onClose={() => setMoving(null)}
          onSaved={(next, list) => {
            adopt(next, `${moving.vendorName} moved to ${candidateListLabels[list].toLowerCase()}`);
            setMoving(null);
          }}
        />
      )}
      {issuing && (
        <IssueCandidate
          rfp={rfp}
          candidate={issuing}
          onClose={() => setIssuing(null)}
          onSaved={(next) => {
            adopt(next, `Issued to ${issuing.vendorName}`);
            setIssuing(null);
          }}
        />
      )}
    </>
  );
}
