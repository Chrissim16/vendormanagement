import { users } from "../schema";
import type { Db } from "../../server/platform/ports/types";

/** Invented people only. Never real names or addresses. */
export const seedUsers = [
  { email: "admin@example.test", displayName: "Alex Admin", role: "admin" as const, active: true },
  { email: "mira@example.test", displayName: "Mira Okafor", role: "member" as const, active: true },
  { email: "jonas@example.test", displayName: "Jonas Brandt", role: "member" as const, active: true },
  { email: "sanne@example.test", displayName: "Sanne de Wit", role: "member" as const, active: true },
  { email: "former@example.test", displayName: "Former Colleague", role: "member" as const, active: false },
];

/** Safe to run more than once. */
export async function seed(db: Db) {
  await db
    .insert(users)
    .values(seedUsers.map((u) => ({ ...u, createdBy: "seed", updatedBy: "seed" })))
    .onConflictDoNothing();
}
