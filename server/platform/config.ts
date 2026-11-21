export interface Config {
  platform: "local" | "databricks";
  production: boolean;
  port: number;
  host: string;
  devUserEmail: string;
  bootstrapAdminEmail: string;
  databaseUrl: string | null;
  /** In-memory database, used by tests. */
  databaseMemory: boolean;
  dataDir: string;
  filesDir: string;
  seedOnStart: boolean;
  /** The team's time zone: dates on screen and day filters use it. */
  timeZone: string;
  /** A fixed "today" (YYYY-MM-DD) for tests and demos. Only honoured with stand-ins. */
  today: string | null;
  clientDir: string;
  volumePath: string | null;
  jira: { baseUrl: string | null; email: string | null; token: string | null };
  ai: { strongEndpoint: string | null; fastEndpoint: string | null };
}

function pinnedDay(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new Error("TODAY must be a real date written YYYY-MM-DD.");
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const platform = env.PLATFORM === "databricks" ? "databricks" : "local";
  // The Databricks Apps runtime sets DATABRICKS_APP_NAME. Running there with stand-ins would
  // let anyone choose who they are, so refuse to start.
  if (env.DATABRICKS_APP_NAME && platform !== "databricks") {
    throw new Error("This looks like a Databricks App but PLATFORM is not 'databricks'. Set PLATFORM=databricks in app.yaml.");
  }
  const dataDir = env.DATA_DIR || ".data";
  const host = env.HOST || (platform === "databricks" ? "0.0.0.0" : "127.0.0.1");
  const bootstrap = (env.BOOTSTRAP_ADMIN_EMAIL || (platform === "local" ? "admin@example.test" : "")).toLowerCase();
  if (platform === "databricks" && (!bootstrap.includes("@") || bootstrap.endsWith("example.test"))) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL in app.yaml must be the first admin's real work email. It is still empty or the placeholder.");
  }
  // The local stand-in lets anyone choose who they are, so it only listens on this machine.
  if (platform === "local" && !["127.0.0.1", "localhost", "::1"].includes(host) && env.ALLOW_REMOTE_STAND_IN !== "1") {
    throw new Error("With stand-in sign-in the app only listens on this machine. Remove HOST, or set PLATFORM=databricks.");
  }
  return {
    platform,
    production: env.NODE_ENV === "production",
    port: Number(env.DATABRICKS_APP_PORT || env.PORT || 3000),
    host,
    devUserEmail: (env.DEV_USER_EMAIL || "admin@example.test").toLowerCase(),
    bootstrapAdminEmail: bootstrap,
    databaseUrl: env.DATABASE_URL || null,
    databaseMemory: env.DATABASE_MEMORY === "1",
    dataDir,
    filesDir: env.FILES_DIR || `${dataDir}/files`,
    seedOnStart: env.SEED_ON_START === "1",
    timeZone: env.APP_TIME_ZONE || "Europe/Amsterdam",
    today: platform === "local" && env.TODAY ? pinnedDay(env.TODAY) : null,
    clientDir: env.CLIENT_DIR || "dist/client",
    volumePath: env.VOLUME_PATH || null,
    jira: { baseUrl: env.JIRA_BASE_URL || null, email: env.JIRA_EMAIL || null, token: env.JIRA_API_TOKEN || null },
    ai: { strongEndpoint: env.AI_STRONG_ENDPOINT || null, fastEndpoint: env.AI_FAST_ENDPOINT || null },
  };
}
