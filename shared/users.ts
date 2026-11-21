import type { Role, UpdateUser } from "./types";

interface UserState {
  role: Role;
  active: boolean;
}

/**
 * There must always be at least one active admin. Returns the reason a change is refused,
 * or null when it is allowed. `otherActiveAdmins` counts active admins other than the target.
 */
export function refuseUserChange(current: UserState, change: UpdateUser, otherActiveAdmins: number): string | null {
  const isActiveAdmin = current.role === "admin" && current.active;
  if (!isActiveAdmin || otherActiveAdmins > 0) return null;
  const next: UserState = { role: change.role ?? current.role, active: change.active ?? current.active };
  if (next.role !== "admin") return "This is the last admin. Make someone else an admin first.";
  if (!next.active) return "This is the last admin. Make someone else an admin before switching off this access.";
  return null;
}

/** The before and after of the fields that actually changed. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, to] of Object.entries(after)) {
    if (to !== undefined && before[k] !== to) out[k] = { from: before[k], to };
  }
  return out;
}
