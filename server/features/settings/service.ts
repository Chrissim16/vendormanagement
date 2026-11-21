import { settings } from "../../../db/schema";
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from "../../../shared/sow";
import type { User } from "../../../shared/types";
import { diff } from "../../../shared/users";
import { audit } from "../../platform/audit";
import type { Db, Queryable } from "../../platform/ports/types";

/** The admin's settings, or the defaults when none have been saved yet. */
export async function getSettings(db: Queryable): Promise<Settings> {
  const row = (await db.select().from(settings))[0];
  return row ? { gbpToEurE4: row.gbpToEurE4, noticeDays: row.noticeDays, sowEndDays: row.sowEndDays, budgetWarningPct: row.budgetWarningPct } : DEFAULT_SETTINGS;
}

export async function saveSettings(db: Db, input: unknown, by: User): Promise<Settings> {
  const next = settingsSchema.parse(input);
  return db.transaction(async (tx) => {
    const current = await getSettings(tx);
    const changes = diff(current, next);
    if (!Object.keys(changes).length) return current;
    const values = { ...next, updatedAt: new Date(), updatedBy: by.email };
    await tx
      .insert(settings)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: settings.id, set: values });
    await audit(tx, { userEmail: by.email, action: "update", entityType: "settings", entityId: "settings", summary: "Settings", changes });
    return next;
  });
}
