import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addMonth,
  formatMetric,
  formatTarget,
  metricInfo,
  monthName,
  type BoardLink,
  type MetricCell,
  type MetricKey,
  type Month,
  type SyncOutcome,
  type TicketSet,
} from "../../../../shared/performance";
import { api, messageOf, queryString } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
import { Button, Field, Pill, Select } from "../../platform/ui";

export const count = (n: number) => n.toLocaleString("en-GB");
export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
/** Where the list of tickets behind a figure lives. */
export const ticketsHref = (vendorId: string, set: TicketSet, month: Month) => `/performance/${vendorId}/tickets${queryString({ set, month })}`;
/** The set of tickets a metric's headline figure is made from. */
export const headlineSet: Record<MetricKey, TicketSet> = { first_response: "fr_measured", first_line: "resolved", sla_breaches: "resolved", backlog_age: "backlog", csat: "rated" };

/** "November 2026 so far" for the running month. */
export const monthTitle = (month: Month, current: Month) => (month === current ? `${monthName(month)} so far` : monthName(month));

/** The last two years, newest first: tickets are kept for 24 months. */
export function MonthSelect({ id, value, current, onChange }: { id: string; value: Month; current: Month; onChange: (m: Month) => void }) {
  return (
    <Field label="Month" htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {Array.from({ length: 24 }, (_, i) => addMonth(current, -i)).map((m) => (
          <option key={m} value={m}>
            {monthTitle(m, current)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** Met, missed or no target, said in words with the dot carrying the colour. */
export function Verdict({ metric, cell, short }: { metric: MetricKey; cell: MetricCell; short?: boolean }) {
  if (cell.targetTenths == null) return <span className="text-[12.5px] text-ink-3">No target</span>;
  // In a table column the direction is left out: the column heading and the verdict already say it.
  const target = short
    ? `${metricInfo[metric].direction === "at_least" ? "min" : "max"} ${formatMetric(metric, cell.targetTenths)}`
    : `target ${formatTarget(metric, cell.targetTenths)}`;
  if (cell.verdict === "none") return <span className="text-[12.5px] text-ink-2">Nothing to measure · {target}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px]">
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${cell.verdict === "missed" ? "bg-crit" : "bg-ok"}`} />
      <span className={cell.verdict === "missed" ? "font-semibold text-[var(--crit-text)]" : "text-ink-2"}>
        {cell.verdict === "missed" ? "Missed" : "Met"} · {target}
      </span>
    </span>
  );
}

/** A figure with what it is judged against underneath; used in the overview's columns. */
export function MetricFigure({ metric, cell }: { metric: MetricKey; cell: MetricCell }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="num font-medium">{formatMetric(metric, cell.valueTenths)}</span>
      <Verdict metric={metric} cell={cell} short />
    </span>
  );
}

export function MissedPill({ missed, anyTarget, short }: { missed: number; anyTarget: boolean; short?: boolean }) {
  if (missed > 0) return <Pill tone="bad">{short ? `${missed} missed` : missed === 1 ? "1 target missed" : `${missed} targets missed`}</Pill>;
  return anyTarget ? <Pill tone="ok">Targets met</Pill> : <Pill>No targets</Pill>;
}

/** How often tickets arrive by themselves, in words. */
export const everyWords = (minutes: number) =>
  minutes <= 0
    ? "only when someone presses Sync now"
    : minutes === 1
      ? "every minute"
      : minutes === 60
        ? "every hour"
        : minutes % 60 === 0
          ? `every ${minutes / 60} hours`
          : `every ${minutes} minutes`;

/** When a board was last fetched, how much came in, and what went wrong if it failed (J-2). */
export function SyncStatus({ link }: { link: BoardLink }) {
  if (!link.active)
    return (
      <p className="flex flex-wrap items-center gap-2.5 text-ink-2">
        <Pill tone="warn">Sync switched off</Pill>
        {link.lastSyncedAt ? `Tickets were last fetched ${formatDateTime(link.lastSyncedAt)}.` : "No tickets have been fetched."} An admin can switch it on again.
      </p>
    );
  if (link.lastSyncOk === false)
    return (
      <div role="status" aria-label="Jira sync problem" className="flex flex-wrap items-center gap-3 rounded-2xl bg-sunk px-5 py-4">
        <Pill tone="bad">Last sync failed</Pill>
        <p className="min-w-0 flex-1">
          {link.lastSyncMessage}{" "}
          <span className="text-ink-2">
            Tried {link.lastAttemptAt ? formatDateTime(link.lastAttemptAt) : "just now"}
            {link.lastSyncedAt ? `; last fetched successfully ${formatDateTime(link.lastSyncedAt)}.` : "; nothing has been fetched yet."}
          </span>
        </p>
      </div>
    );
  if (!link.lastSyncedAt) return <p className="text-ink-2">No tickets have been fetched yet. Press Sync now.</p>;
  return (
    <p className="num text-ink-2">
      Last fetched from Jira {formatDateTime(link.lastSyncedAt)} · {plural(link.lastSyncUpdated ?? 0, "ticket")} updated · {plural(link.tickets, "ticket")} held
    </p>
  );
}

/** "Sync now" for one vendor's board, or for every board. Says what came of it. */
export function SyncButton({ vendorId, disabled }: { vendorId?: string; disabled?: boolean }) {
  const qc = useQueryClient();
  const sync = useMutation({
    mutationFn: async () =>
      vendorId ? [await api<SyncOutcome>(`/performance/vendors/${vendorId}/sync`, { method: "POST" })] : api<SyncOutcome[]>("/performance/sync", { method: "POST" }),
    onSuccess: async (done) => {
      const failed = done.filter((r) => !r.ok);
      const updated = done.reduce((n, r) => n + r.updated, 0);
      if (!done.length) toast("No boards to sync");
      else if (!failed.length) toast.success(`Fetched from Jira: ${plural(updated, "ticket")} updated`);
      else
        toast.error(
          done.length === 1 ? failed[0]!.message : `${failed.length} of ${plural(done.length, "board")} could not be fetched: ${failed.map((f) => f.vendorName).join(", ")}`,
        );
      await qc.invalidateQueries();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Button
      onClick={() => !sync.isPending && sync.mutate()}
      aria-disabled={sync.isPending || disabled || undefined}
      disabled={disabled}
      className={sync.isPending ? "cursor-progress" : undefined}
    >
      {sync.isPending ? "Fetching" : "Sync now"}
    </Button>
  );
}

export const metricLabel = (k: MetricKey) => metricInfo[k].label;
