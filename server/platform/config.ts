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
  clientDir: string;
  volumePath: string | null;
  jira: { baseUrl: string | null; email: string | null; token: string | null };
  ai: { strongEndpoint: string | null; fastEndpoint: string | null };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const platform = env.PLATFORM === "databricks" ? "databricks" : "local";
  // The Databricks Apps runtime sets DATABRICKS_APP_NAME. Running there with stand-ins would
  // let anyone choose who they are, so refuse to start.
  if (env.DATABRICKS_APP_NAME && platform !== "databricks") {
    throw new Error("This looks like a Databricks App but PLATFORM is not 'databricks'. Set PLATFORM=databricks in app.yaml.");
  }
  const dataDir = env.DATA_DIR || ".data";
  return {
    platform,
    production: env.NODE_ENV === "production",
    port: Number(env.DATABRICKS_APP_PORT || env.PORT || 3000),
    host: env.HOST || (platform === "databricks" ? "0.0.0.0" : "127.0.0.1"),
    devUserEmail: (env.DEV_USER_EMAIL || "admin@example.test").toLowerCase(),
    bootstrapAdminEmail: (env.BOOTSTRAP_ADMIN_EMAIL || (platform === "local" ? "admin@example.test" : "")).toLowerCase(),
    databaseUrl: env.DATABASE_URL || null,
    databaseMemory: env.DATABASE_MEMORY === "1",
    dataDir,
    filesDir: env.FILES_DIR || `${dataDir}/files`,
    seedOnStart: env.SEED_ON_START === "1",
    clientDir: env.CLIENT_DIR || "dist/client",
    volumePath: env.VOLUME_PATH || null,
    jira: { baseUrl: env.JIRA_BASE_URL || null, email: env.JIRA_EMAIL || null, token: env.JIRA_API_TOKEN || null },
    ai: { strongEndpoint: env.AI_STRONG_ENDPOINT || null, fastEndpoint: env.AI_FAST_ENDPOINT || null },
  };
}
