import { useQuery } from "@tanstack/react-query";
import type { ContactRole, Warning } from "../../../shared/vendors";
import { api } from "./api";

export interface Person {
  id: string;
  email: string;
  displayName: string | null;
}
export const personName = (p: Person) => p.displayName ?? p.email;

/** The shared list of contact roles (V-7), A to Z. */
export const useContactRoles = () => useQuery({ queryKey: ["contact-roles"], queryFn: () => api<ContactRole[]>("/contact-roles"), staleTime: 30_000 });
/** Colleagues who can own a vendor or an agreement. */
export const usePeople = () => useQuery({ queryKey: ["people"], queryFn: () => api<Person[]>("/people"), staleTime: 60_000 });

/** Everything that needs attention today. Shown in the header count and on the warnings page. */
export const useWarnings = () => useQuery({ queryKey: ["warnings"], queryFn: () => api<Warning[]>("/warnings") });
