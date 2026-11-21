import { useQuery } from "@tanstack/react-query";
import type { Warning } from "../../../shared/vendors";
import { api } from "./api";

export interface Person {
  id: string;
  email: string;
  displayName: string | null;
}
export const personName = (p: Person) => p.displayName ?? p.email;

/** Colleagues who can own a vendor or an agreement. */
export const usePeople = () => useQuery({ queryKey: ["people"], queryFn: () => api<Person[]>("/people"), staleTime: 60_000 });

/** Everything that needs attention today. Shown in the header count and on the warnings page. */
export const useWarnings = () => useQuery({ queryKey: ["warnings"], queryFn: () => api<Warning[]>("/warnings") });
