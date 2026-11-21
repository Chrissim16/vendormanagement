import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { formatMetric, formatTarget, metricInfo, monthName, type Month } from "../../../../shared/performance";
import { suggestionStatusLabels, type Proposal, type ProposalScore, type ProposalState } from "../../../../shared/scorecards";
import { api, messageOf } from "../../lib/api";
import { burst } from "../../lib/burst";
import { formatDateTime } from "../../lib/format";
import { Dialog } from "../../platform/Dialog";
import { Button, ErrorState, Loading, Pill } from "../../platform/ui";
import { AiLabel, linkClass, ScoreBadge, ScoreSelector } from "./parts";

const plural = (n: number, one: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : `${one}s`}`;

/** The figures a score was based on, exactly as the app worked them out. */
function UsedFigures({ score }: { score: ProposalScore }) {
  return (
    <ul aria-label={`Figures used for ${score.criterionName}`} className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
      {score.metrics.map((m) => (
        <li key={m.key} className="num">
          {metricInfo[m.key].label} <span className="font-semibold text-ink">{formatMetric(m.key, m.valueTenths)}</span>
          {m.targetTenths == null ? " · no target" : ` · target ${formatTarget(m.key, m.targetTenths)}`}
          {m.verdict === "missed" && <span className="font-semibold text-[var(--crit-text)]"> · missed</span>}
          {m.verdict === "met" && " · met"}
        </li>
      ))}
    </ul>
  );
}

/** Change the proposed scores before accepting them (AI-1: accept or edit). */
function EditScores({ proposal, onClose, onSaved }: { proposal: Proposal; onClose: () => void; onSaved: (p: Proposal) => void }) {
  const [scores, setScores] = useState(() => Object.fromEntries(proposal.scores.map((s) => [s.criterionId, s.score])));
  const save = useMutation({
    mutationFn: () =>
      api<Proposal>(`/proposals/${proposal.id}/review`, {
        body: { action: "edit", scores: proposal.scores.map((s) => ({ criterionId: s.criterionId, score: scores[s.criterionId] })) },
      }),
    onSuccess: onSaved,
  });
  return (
    <Dialog title={`Scores for ${monthName(proposal.month)}`} onClose={onClose}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!save.isPending) save.mutate();
        }}
      >
        <p className="-mt-2 text-ink-2">Set the scores you stand behind. The AI's own proposal stays on record next to yours.</p>
        {proposal.scores.map((s) => (
          <div key={s.criterionId} className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{s.criterionName}</p>
              <p className="text-[13px] text-ink-2">The AI proposed {s.aiScore}</p>
            </div>
            <ScoreSelector label={`Score for ${s.criterionName}`} value={scores[s.criterionId] ?? null} onChange={(n) => setScores((v) => ({ ...v, [s.criterionId]: n }))} />
          </div>
        ))}
        {save.isError && <ErrorState message={messageOf(save.error)} />}
        <div className="flex justify-end gap-2.5">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" aria-disabled={save.isPending || undefined}>
            {save.isPending ? "Saving" : "Save scores"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The AI's proposal for one vendor and month (P-1): a score per measured criterion with
 * its reason and the figures used, and the recurring ticket themes. It is labelled as
 * AI-written, says when it was written and what a person decided about it (AI-1), and
 * when the AI cannot answer the page says so and nothing else changes (AI-2).
 */
export function MonthProposal({ vendorId, month }: { vendorId: string; month: Month }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const key = ["proposal", vendorId, month];
  const q = useQuery({ queryKey: key, queryFn: () => api<ProposalState>(`/performance/vendors/${vendorId}/proposal`, { query: { month } }) });
  const done = async (p: Proposal) => {
    qc.setQueryData<ProposalState>(key, (s) => (s ? { ...s, proposal: p } : s));
    await Promise.all([qc.invalidateQueries({ queryKey: ["history"] }), qc.invalidateQueries({ queryKey: ["scorecard"] })]);
  };
  const ask = useMutation({ mutationFn: () => api<Proposal>(`/performance/vendors/${vendorId}/proposal`, { body: { month } }), onSuccess: done });
  const review = useMutation({
    mutationFn: (action: "accept" | "reject") => api<Proposal>(`/proposals/${q.data!.proposal!.id}/review`, { body: { action } }),
    onSuccess: async (p, action) => {
      if (action === "accept") burst(acceptRef.current, 9);
      toast.success(action === "accept" ? "Proposal accepted" : "Proposal rejected");
      await done(p);
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  const title = `AI proposal for ${monthName(month)}`;
  const p = q.data?.proposal ?? null;
  const reviewed = p && p.status !== "proposed";
  const confirmed = p?.status === "accepted" || p?.status === "edited";
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {q.isPending ? (
        <Loading rows={2} />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : !p ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-sunk px-5 py-4">
          <p className="min-w-0 flex-1 text-ink-2">
            {q.data.blocked ?? "There is no proposal for this month yet. The AI can read the month's figures and tickets and propose a score per measured criterion."}
          </p>
          {!q.data.blocked && (
            <Button
              variant="primary"
              onClick={() => !ask.isPending && ask.mutate()}
              aria-disabled={ask.isPending || undefined}
              className={ask.isPending ? "cursor-progress" : undefined}
            >
              {ask.isPending ? "Asking the AI" : "Ask the AI for a proposal"}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5 rounded-2xl bg-tint px-5 py-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <AiLabel>AI proposal</AiLabel>
            <p className="min-w-0 flex-1 text-[13px] text-ink-2">
              Written by the AI on {formatDateTime(p.createdAt)} from {plural(p.ticketsRead, "ticket")} and the month's figures.{" "}
              <span className="font-semibold text-ink">
                {suggestionStatusLabels[p.status]}
                {reviewed && p.reviewedBy ? ` by ${p.reviewedBy}${p.reviewedAt ? ` on ${formatDateTime(p.reviewedAt)}` : ""}` : ""}.
              </span>
            </p>
            <Pill tone={confirmed ? "ok" : p.status === "rejected" ? "none" : "none"}>{suggestionStatusLabels[p.status]}</Pill>
          </div>

          <ul aria-label="Proposed scores" className="flex flex-col gap-4">
            {p.scores.map((s) => (
              <li key={s.criterionId} aria-label={s.criterionName} className="flex gap-4">
                <ScoreBadge
                  score={s.score}
                  confirmed={!!confirmed}
                  label={`${s.criterionName}: ${s.score} out of 5, ${confirmed ? "accepted" : p.status === "rejected" ? "rejected" : "proposed by the AI, not accepted yet"}`}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <p>
                    <span className="font-semibold">{s.criterionName}</span>
                    {s.score !== s.aiScore && (
                      <span className="text-[13px] text-ink-2">
                        {" "}
                        · the AI proposed {s.aiScore}, changed to {s.score}
                      </span>
                    )}
                  </p>
                  <p className={p.status === "rejected" ? "text-ink-2" : undefined}>{s.reason}</p>
                  <UsedFigures score={s} />
                </div>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2">
            <h3 className="font-semibold">Recurring themes in the tickets</h3>
            {p.themes.length === 0 ? (
              <p className="text-ink-2">The AI found no problem that came back in several tickets this month.</p>
            ) : (
              <ul aria-label="Ticket themes" className="flex flex-col gap-3">
                {p.themes.map((t) => (
                  <li key={t.title} className="flex flex-col gap-1">
                    <p>
                      <span className="font-semibold">{t.title}</span>{" "}
                      <span className="num text-[13px] text-ink-2">
                        · {plural(t.tickets, "ticket")} of the {p.ticketsRead.toLocaleString("en-GB")} read
                      </span>
                    </p>
                    <p>{t.summary}</p>
                    <p className="text-[13px] text-ink-2">
                      For example:{" "}
                      {t.examples.map((e, i) => (
                        <span key={e.key}>
                          {i > 0 && ", "}
                          {e.url ? (
                            <a href={e.url} target="_blank" rel="noreferrer" className={linkClass}>
                              {e.key}
                            </a>
                          ) : (
                            <span className="num font-medium text-ink">{e.key}</span>
                          )}
                        </span>
                      ))}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {p.status !== "accepted" && p.status !== "edited" && (
              <Button ref={acceptRef} variant="primary" onClick={() => !review.isPending && review.mutate("accept")} aria-disabled={review.isPending || undefined}>
                Accept proposal
              </Button>
            )}
            <Button onClick={() => setEditing(true)}>Change scores</Button>
            {p.status !== "rejected" && (
              <Button onClick={() => !review.isPending && review.mutate("reject")} aria-disabled={review.isPending || undefined}>
                Reject
              </Button>
            )}
            {!confirmed && (
              <Button onClick={() => !ask.isPending && ask.mutate()} aria-disabled={ask.isPending || undefined} className={ask.isPending ? "cursor-progress" : undefined}>
                {ask.isPending ? "Asking the AI" : "Ask again"}
              </Button>
            )}
            <p className="min-w-0 flex-1 text-[13px] text-ink-2">
              {confirmed
                ? "These scores feed the suggestion on the quarter's scorecard."
                : "Nothing here counts until someone accepts it; the scorecard is always scored by a person."}
            </p>
          </div>
        </div>
      )}
      {ask.isError && <ErrorState message={messageOf(ask.error)} onRetry={() => ask.mutate()} />}
      {editing && p && (
        <EditScores
          proposal={p}
          onClose={() => setEditing(false)}
          onSaved={async (next) => {
            setEditing(false);
            toast.success("Scores saved");
            await done(next);
          }}
        />
      )}
    </section>
  );
}
