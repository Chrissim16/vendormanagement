import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import type { SystemCheckItem } from "../../../../shared/types";
import { api, messageOf } from "../../lib/api";
import { item, list } from "../../lib/motion";
import { Button, ErrorState, Loading, PageHeader, Pill } from "../../platform/ui";

export function SystemCheckPage() {
  const q = useQuery({ queryKey: ["system-check"], queryFn: () => api<SystemCheckItem[]>("/admin/system-check"), staleTime: 0, gcTime: 0, refetchOnWindowFocus: false });
  const failing = q.data?.filter((i) => !i.ok).length ?? 0;
  const standIns = q.data?.some((i) => i.kind === "stand-in");
  return (
    <>
      <PageHeader
        context="Tests every connection the app depends on"
        title={
          q.isFetching
            ? "Checking the connections"
            : q.isError
              ? "The check could not run"
              : failing
                ? `${failing} of ${q.data?.length} connections need attention`
                : "Everything is connected"
        }
      >
        <Button onClick={() => void q.refetch()} disabled={q.isFetching}>
          Run again
        </Button>
      </PageHeader>
      {standIns && !q.isFetching && (
        <p className="-mt-6 max-w-[66ch] text-ink-2">
          Connections marked “stand-in” are local substitutes used while the app is being built. After the move to Databricks they are replaced by the real services, and this page
          tests those.
        </p>
      )}
      {q.isFetching ? (
        <Loading rows={5} />
      ) : q.isError ? (
        <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />
      ) : (
        <motion.ul variants={list} initial="initial" animate="animate" className="flex flex-col">
          {q.data?.map((c) => (
            <motion.li key={c.key} variants={item} data-testid={`check-${c.key}`} className="border-b border-line py-5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="w-36 text-base font-semibold">{c.label}</h2>
                <Pill tone={c.ok ? "ok" : "bad"}>{c.ok ? "Working" : "Not working"}</Pill>
                <Pill>{c.kind === "stand-in" ? "Stand-in" : "Real service"}</Pill>
              </div>
              <p className="mt-2 max-w-[80ch]">{c.detail}</p>
              {!c.ok && c.fix && (
                <p className="mt-1 max-w-[80ch] text-ink-2">
                  <span className="font-semibold text-ink">What to do:</span> {c.fix}
                </p>
              )}
              {c.cases.length > 0 && (
                <details className="mt-2 text-[13px] text-ink-2">
                  <summary className="cursor-pointer font-medium">
                    {c.cases.filter((x) => x.ok).length} of {c.cases.length} detailed checks passed
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {c.cases.map((x) => (
                      <li key={x.name} className="flex flex-wrap items-center gap-2">
                        <Pill tone={x.ok ? "ok" : "bad"}>{x.ok ? "Passed" : "Failed"}</Pill>
                        {x.name}
                        {x.error && <span>: {x.error}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </motion.li>
          ))}
        </motion.ul>
      )}
    </>
  );
}
