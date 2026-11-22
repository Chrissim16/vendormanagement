import { useState } from "react";
import { approvalBlocker, reviewBlockers, signoffLabels, signoffOutcomes, type RfpDetail, type Signoff } from "../../../../shared/rfp";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { Dialog } from "../../platform/Dialog";
import { FormFooter, Grid, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { useToday } from "../../platform/session";
import { Button, ConfirmButton, Pill } from "../../platform/ui";
import { Nothing, Section } from "../overview/parts";
import { useAdoptRfp, useRfpChange } from "./parts";
import { OpenRemarks, ReviewRounds } from "./Remarks";

function SignoffForm({ rfp, onClose, onSaved }: { rfp: RfpDetail; onClose: () => void; onSaved: (r: RfpDetail) => void }) {
  const today = useToday();
  const form = useForm({ reviewerName: "", reviewerRole: "", outcome: "", onDate: today, comment: "" }, (v) => api<RfpDetail>(`/rfps/${rfp.id}/signoffs`, { body: v }), {
    onSaved,
    check: (v) => ({
      reviewerName: v.reviewerName.trim() ? "" : "Name the reviewer.",
      outcome: v.outcome ? "" : "Choose what the reviewer decided.",
      onDate: !v.onDate ? "Enter the date." : v.onDate > today ? "The date cannot be in the future." : "",
      comment: v.outcome === "changes_requested" && !v.comment.trim() ? "Say which changes were asked for." : "",
    }),
  });
  const { values: v, set } = form;
  return (
    <Dialog title="Record a sign-off" onClose={onClose}>
      <form onSubmit={form.submit} noValidate className="flex flex-col gap-5">
        <p className="-mt-2 text-ink-2">Reviewers read the Word copy; what each of them decided is recorded here by a team member.</p>
        <Grid>
          <TextField form={form} name="reviewerName" label="Reviewer" value={v.reviewerName} maxLength={200} onChange={(e) => set("reviewerName", e.target.value)} />
          <TextField
            form={form}
            name="reviewerRole"
            label="Role or team"
            value={v.reviewerRole}
            maxLength={200}
            onChange={(e) => set("reviewerRole", e.target.value)}
            placeholder="For example CTO"
          />
          <SelectField form={form} name="outcome" label="Outcome" value={v.outcome} onChange={(e) => set("outcome", e.target.value)}>
            <option value="">Choose</option>
            {signoffOutcomes.map((o) => (
              <option key={o} value={o}>
                {signoffLabels[o]}
              </option>
            ))}
          </SelectField>
          <TextField form={form} name="onDate" label="Date" type="date" max={today} value={v.onDate} onChange={(e) => set("onDate", e.target.value)} />
        </Grid>
        <TextAreaField
          form={form}
          name="comment"
          label={v.outcome === "changes_requested" ? "The changes asked for" : "Comment"}
          value={v.comment}
          maxLength={2000}
          onChange={(e) => set("comment", e.target.value)}
        />
        <FormFooter problem={form.problem} busy={form.busy} submitLabel="Record sign-off" onCancel={onClose} />
      </form>
    </Dialog>
  );
}

/** Q-3, Q-13: the review copy and its rounds, the reviewers' remarks from Word, what each reviewer decided, and the step to approved. */
export function ReviewTab({ rfp, unsaved = false, onDocument }: { rfp: RfpDetail; unsaved?: boolean; onDocument?: () => void }) {
  const [adding, setAdding] = useState(false);
  const adopt = useAdoptRfp(rfp.id);
  const stage = useRfpChange(rfp.id, (to: "drafting" | "in_review" | "approved") => api<RfpDetail>(`/rfps/${rfp.id}/stage`, { body: { to } }), {
    done: (_r, to) => (to === "approved" ? "RFP approved. Next: the shortlist and issuing." : to === "in_review" ? "Sent for review" : "Back in drafting"),
  });
  const resolve = useRfpChange(rfp.id, (v: { s: Signoff; resolved: boolean }) => api<RfpDetail>(`/rfp-signoffs/${v.s.id}`, { method: "PATCH", body: { resolved: v.resolved } }), {
    done: (_r, v) => (v.resolved ? "Marked as dealt with" : "Open again"),
  });
  const remove = useRfpChange(rfp.id, (s: Signoff) => api<RfpDetail>(`/rfp-signoffs/${s.id}`, { method: "DELETE" }), { done: "Sign-off removed" });
  const blocker = approvalBlocker(rfp.signoffs, rfp.review.remarks);
  const notReady = reviewBlockers(rfp);
  const editable = rfp.stage === "drafting" || rfp.stage === "in_review";
  const move = (to: "drafting" | "in_review" | "approved") => !stage.isPending && stage.mutate(to);
  return (
    <>
      <Section title="Review copy and rounds">
        <ReviewRounds rfp={rfp} />
      </Section>

      <Section title="Reviewers' remarks from Word">
        {unsaved && (
          <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-sunk px-5 py-4">
            <p className="min-w-0 flex-1 text-ink-2">
              The document has changes on the Document tab that are not saved. Save or discard them first: taking an edit over changes the document, and saving afterwards would
              undo it.
            </p>
            {onDocument && <Button onClick={onDocument}>Go to the document</Button>}
          </div>
        )}
        <OpenRemarks rfp={rfp} unsaved={unsaved} />
      </Section>

      <Section
        title="Sign-offs"
        more={
          rfp.stage === "in_review" && (
            <Button variant={rfp.signoffs.length ? "plain" : "primary"} onClick={() => setAdding(true)}>
              Record a sign-off
            </Button>
          )
        }
      >
        {rfp.signoffs.length === 0 ? (
          <Nothing>
            {rfp.stage === "drafting"
              ? "No sign-offs yet. They are recorded once the draft has been sent for review."
              : "No sign-offs yet. Record what each reviewer decided: approved, or changes requested."}
          </Nothing>
        ) : (
          <ul aria-label="Sign-offs" className="flex flex-col">
            {rfp.signoffs.map((s) => {
              const open = s.outcome === "changes_requested" && !s.resolvedOn;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3.5">
                  <span className="w-44 shrink-0">
                    <Pill tone={s.superseded ? "none" : s.outcome === "approved" ? "ok" : open ? "warn" : "none"}>
                      {s.outcome === "approved" ? (s.superseded ? "Approved an earlier version" : "Approved") : open ? "Changes requested, open" : "Changes dealt with"}
                    </Pill>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {s.reviewerName}
                      {s.reviewerRole && <span className="font-normal text-ink-2"> · {s.reviewerRole}</span>}
                    </span>
                    <span className="block text-[13px] text-ink-2">
                      <span className="num">{formatDate(s.onDate)}</span>
                      {s.comment && ` · ${s.comment}`}
                      {s.resolvedOn && ` · Dealt with on ${formatDate(s.resolvedOn)}`}
                    </span>
                  </span>
                  {editable && s.outcome === "changes_requested" && (
                    <Button onClick={() => !resolve.isPending && resolve.mutate({ s, resolved: !s.resolvedOn })} aria-disabled={resolve.isPending || undefined}>
                      {s.resolvedOn ? "Open again" : "Mark as dealt with"}
                    </Button>
                  )}
                  {editable && <ConfirmButton label={`Remove the sign-off by ${s.reviewerName}`} onConfirm={() => remove.mutate(s)} disabled={remove.isPending} />}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {rfp.stage === "drafting" && (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-sunk px-5 py-4">
          <p className="min-w-0 flex-1 text-ink-2">
            {notReady.length ? `The draft cannot go to review yet. ${notReady.join(" ")}` : "The draft is complete enough to go to its reviewers."}
          </p>
          <Button variant="primary" disabled={notReady.length > 0} onClick={() => move("in_review")}>
            Send for review
          </Button>
        </div>
      )}
      {rfp.stage === "in_review" && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-sunk px-5 py-4">
          <p role="status" className="min-w-0 flex-1 text-ink-2">
            {blocker ?? "At least one reviewer approved and no requested change or reviewer's remark is open: the RFP can be marked as approved."}
          </p>
          <Button onClick={() => move("drafting")}>Back to drafting</Button>
          <Button variant="primary" disabled={!!blocker} onClick={() => move("approved")}>
            Mark as approved
          </Button>
        </div>
      )}
      {rfp.stage === "approved" && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-2xl bg-sunk px-5 py-4">
          <p className="min-w-0 flex-1 text-ink-2">
            The RFP is approved, and its document is fixed as approved. If it has to change after all, take it back to drafting: once the document is changed, the approval no
            longer counts and a new one is needed.
          </p>
          <Button onClick={() => move("drafting")}>Back to drafting</Button>
        </div>
      )}

      {adding && (
        <SignoffForm
          rfp={rfp}
          onClose={() => setAdding(false)}
          onSaved={(next) => {
            setAdding(false);
            adopt(next, "Sign-off recorded");
          }}
        />
      )}
    </>
  );
}
