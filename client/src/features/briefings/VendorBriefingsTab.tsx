import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { formatDay } from "../../../../shared/dates";
import type { Briefing, BriefingHeader } from "../../../../shared/overview";
import { suggestionStatusLabels } from "../../../../shared/scorecards";
import { api, messageOf } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Button, EmptyState, ErrorState, Loading } from "../../platform/ui";
import { RowLink } from "../overview/parts";

const textState = (b: BriefingHeader) =>
  b.hasText
    ? b.suggestionStatus === "accepted"
      ? "AI text accepted"
      : b.suggestionStatus === "edited"
        ? "AI text accepted with changes"
        : "Written by hand"
    : b.suggestionStatus
      ? `AI text: ${suggestionStatusLabels[b.suggestionStatus].toLowerCase()}`
      : "Facts only";

/** A vendor's briefings (B-1), newest first, and the button that prepares a new one. */
export function VendorBriefingsTab({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["briefings", vendorId], queryFn: () => api<BriefingHeader[]>(`/vendors/${vendorId}/briefings`) });
  const prepare = useMutation({
    mutationFn: () => api<{ briefing: Briefing; aiProblem: string | null }>(`/vendors/${vendorId}/briefings`, { method: "POST" }),
    onSuccess: async ({ briefing, aiProblem }) => {
      qc.setQueryData(["briefing", briefing.id], briefing);
      await qc.invalidateQueries({ queryKey: ["briefings", vendorId] });
      navigate(`/briefings/${briefing.id}`, { state: { aiProblem } });
    },
  });
  const button = (
    <Button
      variant="primary"
      onClick={() => !prepare.isPending && prepare.mutate()}
      aria-disabled={prepare.isPending || undefined}
      className={prepare.isPending ? "cursor-progress" : undefined}
    >
      {prepare.isPending ? "Preparing the briefing" : "Prepare a briefing"}
    </Button>
  );
  return (
    <>
      {q.isPending ? (
        <Loading rows={2} />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="No briefings yet" action={button}>
          A briefing gathers what the app holds about {vendorName} for a review meeting: agreements and upcoming dates, spend against budget, helpdesk figures, open milestones and
          risk flags. The AI suggests a summary and talking points, which you can use, change or replace.
        </EmptyState>
      ) : (
        <>
          <ul aria-label="Briefings" className="flex flex-col">
            {q.data.map((b) => (
              <li key={b.id}>
                <RowLink to={`/briefings/${b.id}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">Briefing, {formatDay(b.asAt)}</span>
                    <span className="block truncate text-[13px] text-ink-2">
                      Prepared {formatDateTime(b.createdAt)}
                      {b.createdBy ? ` by ${b.createdBy}` : ""}
                    </span>
                  </span>
                  <span className="text-[13px] text-ink-2">{textState(b)}</span>
                </RowLink>
              </li>
            ))}
          </ul>
          <div>{button}</div>
        </>
      )}
      {prepare.isError && <ErrorState message={messageOf(prepare.error)} onRetry={() => prepare.mutate()} />}
    </>
  );
}
