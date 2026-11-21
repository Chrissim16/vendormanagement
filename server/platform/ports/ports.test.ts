import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Request } from "express";
import { loadConfig } from "../config";
import { scriptedAi } from "./ai";
import { aiContract, databaseContract, identityContract, jiraContract, storageContract, type ContractCase } from "./contract";
import { embeddedDatabase, postgresDatabase } from "./database";
import { devIdentity, headerIdentity } from "./identity";
import { fakeJira } from "./jira";
import { diskStorage } from "./storage";
import type { DatabasePort } from "./types";

const each = (cases: ContractCase[]) => {
  for (const c of cases) it(c.name, () => c.run());
};
const fakeReq = (headers: Record<string, string>, cookies: Record<string, string> = {}) =>
  ({ header: (n: string) => headers[n.toLowerCase()], cookies, body: {}, query: {} }) as unknown as Request;

describe("storage: folder on disk", () => each(storageContract(diskStorage(".data/test-contract"))));
describe("jira: stand-in", () => each(jiraContract(fakeJira())));
describe("ai: scripted stand-in", () => each(aiContract(scriptedAi())));
describe("ai: the stand-in can be made to fail", () => {
  it("is unreachable or talks nonsense on request, and works again afterwards", async () => {
    const ai = scriptedAi();
    const ping = () => ai.complete({ tier: "fast", system: "", user: "ping" });
    ai.simulate!("unavailable");
    await expect(ping()).rejects.toThrow();
    ai.simulate!("nonsense");
    expect((await ping()).text).not.toBe("pong");
    ai.simulate!("working");
    expect((await ping()).text).toBe("pong");
  });
});

describe("identity: local stand-in", () => {
  const id = devIdentity("Default@Example.test");
  each(identityContract(id, fakeReq({}, { dev_user: "Mira@Example.test" }), "mira@example.test"));
  it("falls back to the configured person", () => expect(id.resolve(fakeReq({}))?.email).toBe("default@example.test"));
});

describe("identity: Databricks headers", () => {
  const id = headerIdentity();
  each(identityContract(id, fakeReq({ "x-forwarded-email": "Mira@Example.test" }), "mira@example.test"));
  it("is nobody without the header", () => expect(id.resolve(fakeReq({}))).toBeNull());
  it("ignores the local stand-in's cookie and header", () => {
    expect(id.resolve(fakeReq({ "x-dev-user": "intruder@example.test" }, { dev_user: "intruder@example.test" }))).toBeNull();
  });
});

describe("database: built-in", () => {
  let port: DatabasePort;
  beforeAll(async () => {
    port = await embeddedDatabase(null);
    await port.migrate();
  });
  afterAll(() => port.close());
  each(
    databaseContract({
      get db() {
        return port.db;
      },
    } as DatabasePort),
  );
  it("reports healthy", async () => expect((await port.check()).ok).toBe(true));
});

// Runs when a Postgres server is available (always in CI), so the same contract is proven on real Postgres.
describe.skipIf(!process.env.TEST_DATABASE_URL)("database: Postgres server", () => {
  let port: DatabasePort;
  beforeAll(async () => {
    port = await postgresDatabase({ connectionString: process.env.TEST_DATABASE_URL }, "stand-in");
    await port.migrate();
  });
  afterAll(() => port.close());
  each(
    databaseContract({
      get db() {
        return port.db;
      },
    } as DatabasePort),
  );
});

describe("configuration", () => {
  const databricks = { DATABRICKS_APP_NAME: "vendorapp", PLATFORM: "databricks", BOOTSTRAP_ADMIN_EMAIL: "owner@company.test" };
  it("refuses to run with stand-ins inside Databricks", () => {
    expect(() => loadConfig({ DATABRICKS_APP_NAME: "vendorapp" })).toThrow(/PLATFORM/);
    expect(loadConfig(databricks).platform).toBe("databricks");
  });
  it("refuses to start in Databricks without a real first admin", () => {
    expect(() => loadConfig({ ...databricks, BOOTSTRAP_ADMIN_EMAIL: "" })).toThrow(/BOOTSTRAP_ADMIN_EMAIL/);
    expect(() => loadConfig({ ...databricks, BOOTSTRAP_ADMIN_EMAIL: "change-me@example.test" })).toThrow(/BOOTSTRAP_ADMIN_EMAIL/);
  });
  it("only offers stand-in sign-in on this machine", () => {
    expect(() => loadConfig({ HOST: "0.0.0.0" })).toThrow(/only listens on this machine/);
    expect(loadConfig({}).host).toBe("127.0.0.1");
  });
});
