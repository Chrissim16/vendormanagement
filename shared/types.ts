import { z } from "zod";

export const roles = ["admin", "member"] as const;
export type Role = (typeof roles)[number];

export interface User {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  userEmail: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export interface CheckResult {
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface SystemCheckItem extends CheckResult {
  key: "database" | "identity" | "storage" | "jira" | "ai";
  label: string;
  kind: "stand-in" | "real";
  cases: { name: string; ok: boolean; error?: string }[];
}

export const updateUserSchema = z
  .object({ role: z.enum(roles).optional(), active: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.active !== undefined, { message: "Nothing to change." });
export type UpdateUser = z.infer<typeof updateUserSchema>;

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}
