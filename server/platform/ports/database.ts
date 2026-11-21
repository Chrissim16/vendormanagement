import { sql } from "drizzle-orm";
import * as schema from "../../../db/schema";
import type { DatabasePort, Db } from "./types";
import type { CheckResult } from "../../../shared/types";
import { explain } from "./explain";

const MIGRATIONS = "db/migrations";

async function probe(db: Db, where: string, fix: string): Promise<CheckResult> {
  try {
    await db.execute(sql`select 1`);
    const rows = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
    return { ok: true, detail: `Connected to ${where}. ${rows[0]?.n ?? 0} people have signed in so far.` };
  } catch (e) {
    const why = explain(e);
    console.error(`Database check failed for ${where}:`, (e as Error).message);
    return { ok: false, detail: `Could not use ${where}. ${why.cause}`, fix: why.fix ?? fix };
  }
}

/** Local stand-in: Postgres built into the app, kept in a folder (or in memory for tests). No install needed. */
export async function embeddedDatabase(dir: string | null): Promise<DatabasePort> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dir) (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir ?? undefined);
  const d = drizzle(client, { schema });
  const db = d as unknown as Db;
  return {
    kind: "stand-in",
    db,
    migrate: () => migrate(d, { migrationsFolder: MIGRATIONS }),
    check: () => probe(db, dir ? `the built-in database in ${dir}` : "the in-memory test database", "Delete the .data folder and start again."),
    close: () => client.close(),
  };
}

/**
 * A Postgres server: a local one through DATABASE_URL, or Lakebase when deployed.
 * `password` may be a function so a short-lived Lakebase token is fetched for each new connection.
 */
export async function postgresDatabase(
  options: { connectionString?: string; host?: string; port?: number; database?: string; user?: string; ssl?: boolean; password?: () => Promise<string>; pool?: import("pg").Pool },
  kind: "stand-in" | "real",
): Promise<DatabasePort> {
  const pg = (await import("pg")).default;
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool =
    options.pool ??
    new pg.Pool({
      connectionString: options.connectionString,
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: options.password,
      ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
      max: 5,
      // Lakebase tokens last about an hour; recycle connections well before that.
      maxLifetimeSeconds: kind === "real" ? 1800 : 0,
    });
  // Without a listener, a dropped idle connection would stop the whole app.
  pool.on("error", (e) => console.error("Database connection dropped; it will be reopened when next needed.", e.message));
  const d = drizzle(pool, { schema });
  const db = d as unknown as Db;
  return {
    kind,
    db,
    migrate: () => migrate(d, { migrationsFolder: MIGRATIONS }),
    check: () =>
      probe(
        db,
        kind === "real" ? "the Lakebase database" : "the Postgres server",
        kind === "real"
          ? "Check that the Lakebase database is attached to the app as a resource and that the app's service principal may connect and create tables."
          : "Check DATABASE_URL in the .env file.",
      ),
    close: () => pool.end(),
  };
}
