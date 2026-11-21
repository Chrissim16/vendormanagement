import request from "supertest";
import { seed } from "../db/seed/run";
import { createApp } from "./app";
import { loadConfig } from "./platform/config";
import { buildPorts } from "./platform/ports";

/** A fresh app on an empty in-memory database with the sample people loaded. */
export async function testApp() {
  const config = loadConfig({ PLATFORM: "local", DATABASE_MEMORY: "1", FILES_DIR: ".data/test-files", CLIENT_DIR: "does-not-exist" });
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
  return { app, ports, config, as, close: () => ports.database.close() };
}

export const ADMIN = "admin@example.test";
export const MEMBER = "mira@example.test";
