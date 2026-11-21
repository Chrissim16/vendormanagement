import { randomBytes } from "node:crypto";
import request from "supertest";
import { seed } from "../db/seed/run";
import { createApp } from "./app";
import { loadConfig } from "./platform/config";
import { buildPorts } from "./platform/ports";

/**
 * A fresh app on an empty database with the sample people loaded. Uses the built-in
 * database, or, when TEST_DATABASE_URL is set (always in CI), a new database on that
 * Postgres server, so the same tests prove both.
 */
export async function testApp(env: Record<string, string> = {}) {
  const server = process.env.TEST_DATABASE_URL;
  let dropDatabase = async () => {};
  let databaseEnv: Record<string, string> = { DATABASE_MEMORY: "1" };
  if (server) {
    const pg = (await import("pg")).default;
    const name = `t_${randomBytes(6).toString("hex")}`;
    const admin = new pg.Client({ connectionString: server });
    await admin.connect();
    await admin.query(`create database ${name}`);
    await admin.end();
    const url = new URL(server);
    url.pathname = `/${name}`;
    databaseEnv = { DATABASE_URL: url.toString() };
    dropDatabase = async () => {
      const c = new pg.Client({ connectionString: server });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    };
  }
  const config = loadConfig({ PLATFORM: "local", FILES_DIR: ".data/test-files", CLIENT_DIR: "does-not-exist", ...databaseEnv, ...env });
  const ports = await buildPorts(config);
  await ports.database.migrate();
  await seed(ports.database.db);
  const app = createApp(config, ports);
  /** Makes requests as the given person. */
  const as = (email: string) => {
    const agent = request.agent(app);
    agent.set("x-dev-user", email);
    return agent;
  };
  return { app, ports, config, as, close: async () => (await ports.database.close(), await dropDatabase()) };
}

export const ADMIN = "admin@example.test";
export const MEMBER = "mira@example.test";
