import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, type ReactNode } from "react";
import type { User } from "../../../shared/types";
import { api, ApiError, messageOf } from "../lib/api";
import { ErrorState } from "./ui";

const Ctx = createContext<User | null>(null);
export const useMe = () => {
  const me = useContext(Ctx);
  if (!me) throw new Error("useMe outside Session");
  return me;
};

/** Loads who is signed in. People without access see an explanation instead of the app. */
export function Session({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: ["me"], queryFn: () => api<User>("/me"), retry: false });
  if (q.isPending) return null;
  if (q.isError) {
    const noAccess = q.error instanceof ApiError && q.error.code === "no_access";
    return (
      <main className="mx-auto flex h-full max-w-xl flex-col justify-center gap-5 px-6">
        <h1 className="text-[30px] font-semibold tracking-[-0.025em]">{noAccess ? "You no longer have access" : "We could not sign you in"}</h1>
        {noAccess ? <p className="text-ink-2">{messageOf(q.error)}</p> : <ErrorState message={messageOf(q.error)} onRetry={() => void q.refetch()} />}
      </main>
    );
  }
  return <Ctx.Provider value={q.data}>{children}</Ctx.Provider>;
}
