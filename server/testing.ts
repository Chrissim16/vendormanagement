import { randomBytes } from "node:crypto";
import request from "supertest";
import type { Response } from "superagent";
import { seed } from "../db/seed/run";
import { createApp, scorecardContext } from "./app";
import { loadConfig } from "./platform/config";
import { buildPorts } from "./platform/ports";

/**
 * A fresh app on its own database with the sample data loaded (or nothing, with `empty`). Uses the built-in
 * database, or, when TEST_DATABASE_URL is set (always in CI), a new database on that
 * Postgres server, so the same tests prove both.
 */
export async function testApp(env: Record<string, string> = {}, options: { empty?: boolean } = {}) {
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
  // "Today" is pinned so date rules give the same answer whenever the tests run.
  const config = loadConfig({ PLATFORM: "local", FILES_DIR: ".data/test-files", CLIENT_DIR: "does-not-exist", TODAY: TODAY, ...databaseEnv, ...env });
  const ports = await buildPorts(config);
  await ports.database.migrate();
  if (!options.empty) await seed(ports.database.db, config.today!, scorecardContext(config, ports));
  const app = createApp(config, ports);
  /** Makes requests as the given person. */
  const as = (email: string) => {
    const agent = request.agent(app);
    agent.set("x-dev-user", email);
    return agent;
  };
  return { app, ports, config, as, close: async () => (await ports.database.close(), await dropDatabase()) };
}

export const TODAY = "2026-11-21";
export const ADMIN = "admin@example.test";
export const MEMBER = "mira@example.test";

/** Reads a file download as bytes: `.buffer(true).parse(binary)`. */
export const binary = (res: Response, done: (err: Error | null, body: unknown) => void) => {
  const chunks: Buffer[] = [];
  const stream = res as unknown as NodeJS.ReadableStream;
  stream.on("data", (c: Buffer) => chunks.push(c));
  stream.on("end", () => done(null, Buffer.concat(chunks)));
};
