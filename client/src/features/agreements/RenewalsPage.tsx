import { useSettings } from "../../platform/session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { Agreement } from "../../../../shared/agreements";
import { formatDay } from "../../../../shared/dates";

import { api, messageOf } from "../../lib/api";
import { item, list as listMotion } from "../../lib/motion";
import { useUrlState } from "../../lib/useUrlState";
import { useMe, useToday } from "../../platform/session";
import { Button, EmptyState, ErrorState, Field, Loading, PageHeader, Pill, Select } from "../../platform/ui";
import { AgreementTabs } from "./AgreementsPage";
import { DecisionDialog } from "./DecisionDialog";
import { renewalPill } from "./display";
import { shownMoney } from "../../platform/Money";

/** Subscriptions whose notice deadline has passed or is coming up, soonest first (A-6). */
export function RenewalsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const today = useToday();
  const [url, setUrl] = useUrlState({ window: "", mine: "" });
  const usual = String(useSettings().noticeDays);
  const windowDays = url.window || usual;
  const [deciding, setDeciding] = useState<Agreement | null>(null);
  const q = useQuery({
    queryKey: ["renewals", url],
    queryFn: () => api<Agreement[]>("/renewals", { query: { window: url.window || undefined, owner: url.mine ? me.id : undefined } }),
  });
  const overdue = q.data?.filter((a) => a.renewalState === "overdue").length ?? 0;
  return (
    <>
      <PageHeader context={q.data ? `${q.data.length} waiting for a decision${overdue ? `, ${overdue} overdue` : ""}` : " "} title="Renewals" />
      <AgreementTabs />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Notice deadline within" htmlFor="renewals-window">
          <Select id="renewals-window" value={windowDays} onChange={(e) => setUrl({ window: e.target.value === usual ? "" : e.target.value })}>
            {[...new Set(["30", "60", "90", "180", usual])]
              .sort((a, b) => Number(a) - Number(b))
              .map((w) => (
                <option key={w} value={w}>
                  {w} days
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Whose" htmlFor="renewals-mine">
          <Select id="renewals-mine" value={url.mine} onChange={(e) => setUrl({ mine: e.target.value })}>
            <option value="">Everyone's</option>
            <option value="1">Mine</option>
          </Select>
        </Field>
      </div>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState title="Nothing needs a renewal decision">
          Subscriptions appear here when their notice deadline is within {windowDays} days or has passed, until someone records a decision. MSAs and SOWs never appear, because they
          do not renew.
        </EmptyState>
      ) : (
        <motion.ul variants={listMotion} initial="initial" animate="animate" aria-label="Renewals" className="flex flex-col">
          {q.data.map((a) => {
            const pill = renewalPill(a, today)!;
            return (
              <motion.li key={a.id} variants={item} className="flex items-center gap-4 border-b border-line py-4">
                <span className="w-24 shrink-0">
                  <Pill tone={pill.tone}>{pill.label}</Pill>
                </span>
                <span className="min-w-0 flex-1">
                  <Link to={`/agreements/${a.id}`} className="block truncate font-semibold underline-offset-2 hover:underline">
                    {a.vendorName} · {a.title}
                  </Link>
                  <span className="block truncate text-[13px] text-ink-2">
                    Notice deadline {a.renewalState === "overdue" ? "passed" : "is"} {formatDay(a.noticeDeadline!)} · renews {formatDay(a.endDate!)} · {a.ownerName}
                  </span>
                </span>
                <span className="num text-ink-2">{a.annualValueMinor == null ? "" : `${shownMoney(a.annualValueMinor, a.currency)} a year`}</span>
                <Button onClick={() => setDeciding(a)} aria-label={`Record decision for ${a.title}`}>
                  Record decision
                </Button>
              </motion.li>
            );
          })}
        </motion.ul>
      )}
      {deciding && (
        <DecisionDialog
          agreement={deciding}
          today={today}
          onClose={() => setDeciding(null)}
          onSaved={async () => {
            setDeciding(null);
            toast.success("Decision recorded");
            await qc.invalidateQueries();
          }}
        />
      )}
    </>
  );
}
