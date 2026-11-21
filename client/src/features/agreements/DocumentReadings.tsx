import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { DocumentReading, Proposal, ReadingField } from "../../../../shared/reading";
import { suggestionStatusLabels } from "../../../../shared/scorecards";
import { api, messageOf } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Button, ErrorState, Pill } from "../../platform/ui";
import { AiLabel } from "../scorecards/parts";

/** The passage a value was read from, word for word, with the page it stands on. */
const Passage = ({ p }: { p: Proposal }) => (
  <figure className="min-w-0">
    <blockquote className="border-l-2 border-line-2 pl-3 text-[13px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">“{p.passage}”</blockquote>
    {p.where && <figcaption className="mt-1 pl-3 text-[12px] text-ink-2">{p.where}</figcaption>}
  </figure>
);

/**
 * E-1: what the AI read in one document, next to what the agreement holds. A value is
 * taken over only when it is ticked and "Use the ticked values" is pressed (AI-1).
 */
function Reading({ r, onRead, reading }: { r: DocumentReading; onRead: () => void; reading: boolean }) {
  const qc = useQueryClient();
  const usable = r.proposals.filter((p) => p.state === "differs").map((p) => p.field);
  const [ticked, setTicked] = useState<ReadingField[]>(usable);
  // A new reading starts with everything that differs ticked.
  useEffect(() => setTicked(usable), [r.suggestion.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = r.suggestion.status === "proposed";
  const review = useMutation({
    mutationFn: (body: { action: "apply"; fields: ReadingField[] } | { action: "reject" }) =>
      api<DocumentReading>(`/documents/${r.documentId}/reading/review`, { body: { ...body, suggestionId: r.suggestion.id } }),
    onSuccess: async (_d, body) => {
      toast.success(body.action === "apply" ? "The agreement was updated from the document" : "The reading was rejected; nothing was changed");
      await qc.invalidateQueries();
    },
  });
  const busy = review.isPending;
  const s = r.suggestion;
  const table = (
    <table aria-label={`Values read from ${r.fileName}`} className="w-full border-collapse text-left">
      <thead>
        <tr className="text-[12.5px] text-ink-2">
          {open && (
            <th scope="col" className="w-8 py-2 pr-2 font-medium">
              <span className="sr-only">Use</span>
            </th>
          )}
          <th scope="col" className="w-[15%] py-2 pr-4 font-medium">
            Field
          </th>
          <th scope="col" className="w-[19%] py-2 pr-4 font-medium">
            On the agreement
          </th>
          <th scope="col" className="w-[19%] py-2 pr-4 font-medium">
            In the document
          </th>
          <th scope="col" className="py-2 font-medium">
            Passage it comes from
          </th>
        </tr>
      </thead>
      <tbody>
        {r.proposals.map((p) => (
          <tr key={p.field} className="border-t border-line align-top">
            {open && (
              <td className="py-3 pr-2">
                {p.state === "differs" && (
                  <input
                    type="checkbox"
                    aria-label={`Use ${p.label}: ${p.proposed}`}
                    checked={ticked.includes(p.field)}
                    onChange={(e) => setTicked((t) => (e.target.checked ? [...t, p.field] : t.filter((f) => f !== p.field)))}
                    className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                  />
                )}
              </td>
            )}
            <th scope="row" className="py-3 pr-4 font-medium">
              {p.label}
            </th>
            <td className="num py-3 pr-4 text-ink-2 [overflow-wrap:anywhere]">{p.current}</td>
            <td className="py-3 pr-4 [overflow-wrap:anywhere]">
              <span className={p.state === "differs" ? "num font-semibold" : "num"}>{p.proposed}</span>
              <span className="mt-1 block text-[12.5px] text-ink-2">{p.state === "same" ? "The same" : p.state === "differs" ? "Differs" : p.why}</span>
            </td>
            <td className="py-3">
              <Passage p={p} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const notes = (
    <>
      {r.proposals.length === 0 && <p>The AI found none of the fields in this document.</p>}
      {r.notFound.length > 0 && r.proposals.length > 0 && <p className="text-[13px] text-ink-2">The document does not say: {r.notFound.join(", ").toLowerCase()}.</p>}
      {r.partly && <p className="text-[13px] text-ink-2">This is a long document; the AI read only its first part.</p>}
    </>
  );
  const again = (
    <Button onClick={() => !reading && !busy && onRead()} aria-disabled={reading || busy || undefined} className={reading ? "cursor-progress" : undefined}>
      {reading ? "Reading" : "Read again"}
    </Button>
  );

  if (!open)
    return (
      <div
        id={`reading-${r.documentId}`}
        tabIndex={-1}
        role="group"
        aria-label={`AI reading of ${r.fileName}`}
        className="flex flex-col gap-3 rounded-2xl bg-sunk px-5 py-4 outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 flex-1 text-[13.5px] text-ink-2">
            The AI read <span className="font-medium text-ink">{r.fileName}</span> on {formatDateTime(s.createdAt)} ·{" "}
            <span className="font-semibold text-ink">
              {suggestionStatusLabels[s.status]}
              {s.reviewedBy && s.reviewedBy !== "system" ? ` by ${s.reviewedBy}${s.reviewedAt ? ` on ${formatDateTime(s.reviewedAt)}` : ""}` : ""}
            </span>
          </p>
          {again}
        </div>
        <details>
          <summary className="cursor-pointer text-[13px] font-medium text-accent-ink">What it read</summary>
          <div className="mt-2 flex flex-col gap-2">
            {table}
            {notes}
          </div>
        </details>
      </div>
    );

  return (
    <div
      id={`reading-${r.documentId}`}
      tabIndex={-1}
      role="group"
      aria-label={`AI reading of ${r.fileName}`}
      className="flex flex-col gap-4 rounded-2xl bg-tint px-5 py-5 outline-none focus-visible:shadow-[0_0_0_2px_var(--accent)]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AiLabel>AI proposal</AiLabel>
        <p className="min-w-0 flex-1 text-[13px] text-ink-2">
          Read by the AI on {formatDateTime(s.createdAt)} from <span className="font-medium text-ink">{r.fileName}</span>.{" "}
          <span className="font-semibold text-ink">{suggestionStatusLabels[s.status]}.</span>
        </p>
        <Pill>{suggestionStatusLabels[s.status]}</Pill>
      </div>
      {r.proposals.length > 0 && table}
      {notes}
      {review.isError && <ErrorState message={messageOf(review.error)} />}
      <div className="flex flex-wrap items-center gap-2.5">
        {usable.length > 0 && (
          <Button
            variant="primary"
            onClick={() => !busy && ticked.length > 0 && review.mutate({ action: "apply", fields: ticked })}
            aria-disabled={busy || ticked.length === 0 || undefined}
            className={ticked.length === 0 ? "opacity-50" : undefined}
          >
            Use the ticked values
          </Button>
        )}
        <Button onClick={() => !busy && review.mutate({ action: "reject" })} aria-disabled={busy || undefined}>
          Reject
        </Button>
        {again}
        <p className="min-w-0 flex-1 text-[13px] text-ink-2">
          {usable.length === 0
            ? "The document says nothing that differs from the agreement, so there is nothing to take over."
            : ticked.length === 0
              ? "Tick at least one value to use."
              : "Nothing changes on the agreement until you press Use the ticked values. Check each value against its passage first."}
        </p>
      </div>
    </div>
  );
}

/** What the AI read in an agreement's documents, across the page, so each value sits next to its passage. Nothing is shown when no document was read. */
export function AgreementReadings({ agreementId }: { agreementId: string }) {
  const qc = useQueryClient();
  const readings = useQuery({ queryKey: ["agreement", agreementId, "readings"], queryFn: () => api<DocumentReading[]>(`/agreements/${agreementId}/readings`) });
  const again = useMutation({
    mutationFn: (documentId: string) => api<DocumentReading>(`/documents/${documentId}/reading`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
  if (!readings.data?.length) return null;
  return (
    <section aria-label="Read from the documents" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-base font-semibold">Read from the documents</h2>
      {again.isError && <ErrorState message={messageOf(again.error)} />}
      {readings.data.map((r) => (
        <Reading key={r.documentId} r={r} onRead={() => again.mutate(r.documentId)} reading={again.isPending && again.variables === r.documentId} />
      ))}
    </section>
  );
}
