import { DEFAULT_SETTINGS, type Settings } from "../../../shared/sow";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import { toast } from "sonner";
import type { User } from "../../../shared/types";
import { api, ApiError, messageOf } from "../lib/api";
import { setTimeZone } from "../lib/format";
import { ErrorState } from "./ui";

const Ctx = createContext<User | null>(null);
export const useMe = () => {
  const me = useContext(Ctx);
  if (!me) throw new Error("useMe outside Session");
  return me;
};

interface AppConfig {
  standInSignIn: boolean;
  timeZone: string;
  /** Today's date in the team's time zone, as the server sees it. */
  today: string;
}

/** Today's date as the server sees it, so "27 days left" on screen agrees with the server's rules. */
export function useToday(): string {
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("/config"), staleTime: 5 * 60_000 });
  return config.data?.today ?? new Date().toISOString().slice(0, 10);
}

/** Local only: look at the app as someone else to try out roles. Never present when deployed. */
export function DevSwitcher({ current }: { current?: string }) {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("/config"), staleTime: 5 * 60_000 });
  const people = useQuery({ queryKey: ["dev-users"], queryFn: () => api<{ email: string; role: string; active: boolean }[]>("/dev/users"), enabled: !!config.data?.standInSignIn });
  if (!config.data?.standInSignIn || !people.data) return null;
  return (
    <div className="flex flex-col gap-1 px-2.5 text-[12px] font-medium text-ink-3">
      <label htmlFor="dev-user">Viewing as (local only)</label>
      <select
        id="dev-user"
        value={current ?? ""}
        onChange={async (e) => {
          try {
            await api("/dev/switch", { method: "POST", body: { email: e.target.value } });
            // Drop everything the previous person loaded, so nothing of theirs flashes by.
            await qc.resetQueries();
          } catch (err) {
            toast.error(messageOf(err));
          }
        }}
        className="h-8 rounded-full border border-line-2 bg-surface px-2.5 text-[12.5px] text-ink"
      >
        {!current && <option value="">Choose a person</option>}
        {people.data.map((p) => (
          <option key={p.email} value={p.email}>
            {p.email} ({p.active ? p.role : "no access"})
          </option>
        ))}
      </select>
    </div>
  );
}

/** Loads who is signed in. People without access see an explanation instead of the app. */
export function Session({ children }: { children: ReactNode }) {
  const config = useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("/config"), staleTime: 5 * 60_000 });
  const q = useQuery({ queryKey: ["me"], queryFn: () => api<User>("/me"), retry: false });
  if (config.data) setTimeZone(config.data.timeZone);
  if (q.isPending || config.isPending) return null;
  if (q.isError) {
    const noAccess = q.error instanceof ApiError && q.error.code === "no_access";
    return (
      <main className="mx-auto flex h-full max-w-xl flex-col justify-center gap-5 px-6">
        <h1 className="text-[30px] font-semibold tracking-[-0.025em]">{noAccess ? "You no longer have access" : "We could not sign you in"}</h1>
        {noAccess ? <p className="text-ink-2">{messageOf(q.error)}</p> : <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />}
        <div className="-mx-2.5 max-w-xs">
          <DevSwitcher />
        </div>
      </main>
    );
  }
  return <Ctx.Provider value={q.data}>{children}</Ctx.Provider>;
}

/** The admin's warning windows and exchange rate; the built-in defaults until they have loaded. */
export function useSettings(): Settings {
  return useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings"), staleTime: 60_000 }).data ?? DEFAULT_SETTINGS;
}
