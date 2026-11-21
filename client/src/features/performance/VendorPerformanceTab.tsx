import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { formatMetric, metricInfo, metricKeys, type VendorPerformance } from "../../../../shared/performance";
import { api, messageOf } from "../../lib/api";
import { ErrorState, Loading } from "../../platform/ui";
import { MissedPill, monthTitle, Verdict } from "./parts";

/** The Performance tab of a vendor's panel: this month at a glance, and the way to the full page. */
export function VendorPerformanceTab({ vendorId }: { vendorId: string }) {
  const q = useQuery({ queryKey: ["performance", "vendor", vendorId, ""], queryFn: () => api<VendorPerformance>(`/performance/vendors/${vendorId}`) });
  if (q.isPending) return <Loading rows={3} />;
  if (q.isError) return <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />;
  const p = q.data;
  const month = p.months.at(-1);
  const open = (
    <Link to={`/performance/${vendorId}`} className="font-semibold text-accent-ink underline-offset-2 hover:underline">
      {p.link ? "Open performance" : "Go to performance"}
    </Link>
  );
  if (!p.link || !month)
    return (
      <>
        <p className="text-ink-2">No Jira board is linked to this vendor, so there are no helpdesk figures. A vendor without a board is scored by hand.</p>
        <div>{open}</div>
      </>
    );
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="flex-1 text-base font-semibold">{monthTitle(month.month, p.currentMonth)}</h3>
        <MissedPill missed={month.missed} anyTarget={metricKeys.some((k) => month.cells[k].targetTenths != null)} />
      </div>
      <dl className="grid grid-cols-[190px_minmax(0,1fr)] gap-x-4 gap-y-3">
        {metricKeys.map((k) => (
          <div key={k} className="contents">
            <dt className="text-ink-2">{metricInfo[k].label}</dt>
            <dd className="flex flex-wrap items-baseline gap-x-3">
              <span className="num font-semibold">{formatMetric(k, month.cells[k].valueTenths)}</span>
              <Verdict metric={k} cell={month.cells[k]} />
            </dd>
          </div>
        ))}
      </dl>
      <div>{open}</div>
    </>
  );
}
