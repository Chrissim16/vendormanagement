import path from "node:path";
import { clock, type Config } from "../config";
import { scriptedAi, servingAi } from "./ai";
import { embeddedDatabase, postgresDatabase } from "./database";
import { provisionedLakebasePassword, workspaceToken } from "./databricks";
import { devIdentity, headerIdentity } from "./identity";
import { cloudJira, fakeJira } from "./jira";
import { diskStorage, volumeStorage } from "./storage";
import type { DatabasePort, Ports } from "./types";

function need(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`The setting ${name} is missing. See docs/runbook.md.`);
  return v;
}

/** Stand-ins: everything runs on this machine. */
async function localPorts(config: Config): Promise<Ports> {
  const database = config.databaseUrl
    ? await postgresDatabase({ connectionString: config.databaseUrl }, "stand-in")
    : await embeddedDatabase(config.databaseMemory ? null : path.join(config.dataDir, "pg"));
  return { identity: devIdentity(config.devUserEmail), database, storage: diskStorage(config.filesDir), jira: fakeJira(clock(config)), ai: scriptedAi() };
}

/** The real services inside the company's Databricks workspace. UNPROVEN until first deployment. */
async function databricksPorts(config: Config, env: NodeJS.ProcessEnv): Promise<Ports> {
  const rawHost = need(env, "DATABRICKS_HOST");
  const host = rawHost.startsWith("http") ? rawHost : `https://${rawHost}`;
  const getToken = workspaceToken(host, need(env, "DATABRICKS_CLIENT_ID"), need(env, "DATABRICKS_CLIENT_SECRET"));

  let database: DatabasePort;
  if (env.LAKEBASE_ENDPOINT) {
    // Lakebase Autoscaling: Databricks' own helper keeps the connection's token fresh.
    const { createLakebasePool } = await import("@databricks/lakebase");
    database = await postgresDatabase({ pool: createLakebasePool({ max: 5 }) as unknown as import("pg").Pool }, "real");
  } else {
    // Lakebase Provisioned: plain connection with a token from the credentials API as password.
    database = await postgresDatabase(
      {
        host: need(env, "PGHOST"),
        port: Number(env.PGPORT || 5432),
        database: need(env, "PGDATABASE"),
        user: env.PGUSER || need(env, "DATABRICKS_CLIENT_ID"),
        ssl: true,
        password: provisionedLakebasePassword(host, need(env, "LAKEBASE_INSTANCE"), getToken),
      },
      "real",
    );
  }

  return {
    identity: headerIdentity(),
    database,
    storage: volumeStorage(host, config.volumePath ?? need(env, "VOLUME_PATH"), getToken),
    jira: cloudJira(config.jira.baseUrl ?? need(env, "JIRA_BASE_URL"), config.jira.email ?? need(env, "JIRA_EMAIL"), config.jira.token ?? need(env, "JIRA_API_TOKEN")),
    ai: servingAi(host, { strong: config.ai.strongEndpoint ?? need(env, "AI_STRONG_ENDPOINT"), fast: config.ai.fastEndpoint ?? need(env, "AI_FAST_ENDPOINT") }, getToken),
  };
}

export const buildPorts = (config: Config, env: NodeJS.ProcessEnv = process.env): Promise<Ports> =>
  config.platform === "databricks" ? databricksPorts(config, env) : localPorts(config);
