import { formatHundredths, inEvaluation, type RfpDetail } from "../../../../shared/rfp";
import { api } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { FormFooter, Grid, SelectField, TextAreaField, TextField, useForm } from "../../platform/form";
import { useToday } from "../../platform/session";
import { Nothing, Section } from "../overview/parts";
import { downloadClass, primaryDownloadClass, useAdoptRfp } from "./parts";

function DecisionForm({ rfp }: { rfp: RfpDetail }) {
  const today = useToday();
  const adopt = useAdoptRfp(rfp.id);
  const running = rfp.candidates.filter(inEvaluation);
  const best = rfp.results.filter((r) => r.rank === 1);
  const form = useForm(
    { winnerCandidateId: best.length === 1 ? best[0]!.candidateId : "", decidedOn: today, rationale: "" },
    (v) => api<RfpDetail>(`/rfps/${rfp.id}/decision`, { body: v }),
    {
      onSaved: (next) => adopt(next, `Decision recorded: ${next.decision?.winnerName} won`),
      check: (v) => ({
        winnerCandidateId: v.winnerCandidateId ? "" : "Choose the winner.",
        decidedOn: !v.decidedOn ? "Enter the day of the decision." : v.decidedOn > today ? "The day of the decision cannot be in the future." : "",
        rationale: v.rationale.trim() ? "" : "Give the reasons for the decision.",
      }),
    },
  );
  const { values: v, set } = form;
  const winner = running.find((c) => c.id === v.winnerCandidateId);
  const unranked = rfp.results.filter((r) => r.rank == null).length;
  return (
    <form onSubmit={form.submit} noValidate className="flex max-w-[760px] flex-col gap-5">
      {unranked > 0 && (
        <p className="rounded-2xl bg-sunk px-5 py-4 text-ink-2">
          {unranked === rfp.results.length ? "No candidate has an overall score yet" : `${unranked} of ${rfp.results.length} candidates have no overall score yet`}: not every
          criterion has been scored. A decision can still be recorded; the decision record will show the scores as they are.
        </p>
      )}
      <Grid>
        <SelectField form={form} name="winnerCandidateId" label="Winner" value={v.winnerCandidateId} onChange={(e) => set("winnerCandidateId", e.target.value)}>
          <option value="">Choose the winner</option>
          {running.map((c) => {
            const r = rfp.results.find((x) => x.candidateId === c.id);
            return (
              <option key={c.id} value={c.id}>
                {c.vendorName}
                {r?.overallHundredths != null ? ` · ${formatHundredths(r.overallHundredths)} · rank ${r.rank}` : " · no overall score"}
              </option>
            );
          })}
        </SelectField>
        <TextField form={form} name="decidedOn" label="Decided on" type="date" max={today} value={v.decidedOn} onChange={(e) => set("decidedOn", e.target.value)} />
      </Grid>
      <TextAreaField
        form={form}
        name="rationale"
        label="Reasons"
        rows={6}
        value={v.rationale}
        maxLength={4000}
        onChange={(e) => set("rationale", e.target.value)}
        placeholder="Why this candidate was chosen. This goes into the decision record."
      />
      <p className="text-[13.5px] text-ink-2">
        Recording the decision closes this RFP: nothing on it can be changed afterwards.{" "}
        {winner
          ? winner.vendorStatus === "active"
            ? `${winner.vendorName} is already an active vendor.`
            : `${winner.vendorName} becomes an active vendor.`
          : "The winner becomes an active vendor."}{" "}
        No agreement is created; the other candidates stay as they are.
      </p>
      <FormFooter problem={form.problem} busy={form.busy} submitLabel="Record the decision" onCancel={() => form.patch({ winnerCandidateId: "", rationale: "" })} />
    </form>
  );
}

/** Q-9 and Q-10: the winner with the reasons, and the whole trail as one PDF. */
export function DecisionTab({ rfp }: { rfp: RfpDetail }) {
  const record = `/api/rfps/${rfp.id}/decision-record.pdf`;
  const canDecide = rfp.stage === "issued" || rfp.stage === "evaluating";
  return (
    <>
      <Section title="Decision">
        {rfp.decision ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-3 gap-4">
              <div className="rounded-tile bg-sunk px-7 py-6">
                <dt className="text-[13.5px] font-medium text-ink-2">Winner</dt>
                <dd className="mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{rfp.decision.winnerName}</dd>
                <dd className="mt-1 text-[12.5px] text-ink-2">Now an active vendor. No agreement was created; add it under Agreements when it is signed.</dd>
              </div>
              <div className="rounded-tile bg-sunk px-7 py-6">
                <dt className="text-[13.5px] font-medium text-ink-2">Decided on</dt>
                <dd className="num mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em]">{formatDate(rfp.decision.decidedOn)}</dd>
              </div>
              <div className="rounded-tile bg-sunk px-7 py-6">
                <dt className="text-[13.5px] font-medium text-ink-2">Overall score</dt>
                <dd className="num mt-2 text-[26px] font-semibold leading-tight tracking-[-0.02em]">
                  {formatHundredths(rfp.results.find((r) => r.candidateId === rfp.decision!.winnerCandidateId)?.overallHundredths)}
                </dd>
                <dd className="mt-1 text-[12.5px] text-ink-2">Out of 5, from the team's scores</dd>
              </div>
            </dl>
            <div>
              <h3 className="font-semibold">Reasons</h3>
              <p className="mt-1 max-w-[78ch] whitespace-pre-line">{rfp.decision.rationale}</p>
            </div>
          </div>
        ) : rfp.stage === "cancelled" ? (
          <Nothing>This RFP was cancelled, so no decision was recorded. {rfp.cancelReason}</Nothing>
        ) : canDecide ? (
          <DecisionForm rfp={rfp} />
        ) : (
          <Nothing>A decision is recorded once the RFP has been issued and the candidates have been scored.</Nothing>
        )}
      </Section>
      <Section title="Decision record">
        <div className="flex flex-wrap items-center gap-4">
          <p className="min-w-0 flex-1 text-ink-2">
            One PDF with the whole trail: the demand, the sign-offs, every candidate with the reason, the scores per evaluator and what they add up to, and the decision.
            {!rfp.decision && rfp.stage !== "cancelled" && " Until a decision is recorded it holds the trail so far."}
          </p>
          <a href={record} download className={rfp.decision ? primaryDownloadClass : downloadClass}>
            Download decision record
          </a>
        </div>
      </Section>
    </>
  );
}
