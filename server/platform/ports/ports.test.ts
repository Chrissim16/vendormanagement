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
  it("refuses to run with stand-ins inside Databricks", () => {
    expect(() => loadConfig({ DATABRICKS_APP_NAME: "vendorapp" })).toThrow(/PLATFORM/);
    expect(loadConfig({ DATABRICKS_APP_NAME: "vendorapp", PLATFORM: "databricks" }).platform).toBe("databricks");
  });
});
