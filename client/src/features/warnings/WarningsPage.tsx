import { motion } from "motion/react";
import { Link } from "react-router-dom";
import type { Warning } from "../../../../shared/vendors";
import { messageOf } from "../../lib/api";
import { useWarnings } from "../../lib/data";
import { item, list } from "../../lib/motion";
import { EmptyState, ErrorState, Loading, PageHeader, Pill } from "../../platform/ui";

export const warningLink = (w: Warning) => (w.agreementId ? `/agreements/${w.agreementId}` : `/vendors?open=${w.vendorId}`);

export function WarningRow({ w }: { w: Warning }) {
  return (
    <motion.li variants={item}>
      <Link to={warningLink(w)} className="flex items-center gap-4 border-b border-line py-4 transition-[padding] duration-300 ease-out hover:pl-2.5">
        <span className="w-32 shrink-0">
          <Pill tone={w.tone}>{w.label}</Pill>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{w.title}</span>
          <span className="block truncate text-[13px] text-ink-2">{w.detail}</span>
        </span>
      </Link>
    </motion.li>
  );
}

/** Everything that needs attention today (A-7). */
export function WarningsPage() {
  const q = useWarnings();
  const n = q.data?.length ?? 0;
  return (
    <>
      <PageHeader
        context="Renewal deadlines, SOWs ending and missing paperwork"
        title={q.data ? (n === 0 ? "Nothing needs attention" : `${n} ${n === 1 ? "thing needs" : "things need"} attention`) : "Warnings"}
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : n === 0 ? (
        <EmptyState title="All clear">
          A warning appears here when a subscription's notice deadline is within 90 days or has passed, when a SOW ends within 30 days, and when an active vendor has no valid NDA
          or data processing agreement.
        </EmptyState>
      ) : (
        <motion.ul variants={list} initial="initial" animate="animate" aria-label="Warnings" className="flex flex-col">
          {q.data.map((w, i) => (
            <WarningRow key={`${w.type}-${w.agreementId ?? w.vendorId}-${i}`} w={w} />
          ))}
        </motion.ul>
      )}
    </>
  );
}
