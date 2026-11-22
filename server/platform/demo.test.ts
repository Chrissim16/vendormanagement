import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { demoGate } from "./demo";
import { MEMBER, testApp } from "../testing";

const basic = (password: string, name = "anyone") => `Basic ${Buffer.from(`${name}:${password}`).toString("base64")}`;
const PASSWORD = "correct horse battery";

describe("F-5 a sample version on a public address", () => {
  it("F-5 the app listens beyond this machine only behind the sample version's password, and never so inside Databricks", () => {
    const local = { PLATFORM: "local" };
    expect(() => loadConfig({ ...local, HOST: "0.0.0.0" })).toThrow("only listens on this machine");
    expect(loadConfig({ ...local, HOST: "0.0.0.0", DEMO_PASSWORD: PASSWORD })).toMatchObject({ host: "0.0.0.0", demoPassword: PASSWORD });
    expect(() => loadConfig({ ...local, HOST: "0.0.0.0", DEMO_PASSWORD: "short" })).toThrow("at least 12 characters");
    expect(loadConfig(local).demoPassword).toBeNull();
    expect(() =>
      loadConfig({ PLATFORM: "databricks", BOOTSTRAP_ADMIN_EMAIL: "someone@company.test", JIRA_BASE_URL: "https://company.atlassian.net", DEMO_PASSWORD: PASSWORD }),
    ).toThrow("sample version only");
  });

  it("F-5 nothing is served without the password: no page, no data, no file; with it everything works as usual", async () => {
    const t = await testApp({ DEMO_PASSWORD: PASSWORD });
    try {
      for (const path of ["/", "/vendors", "/api/vendors", "/api/config", "/api/me", "/api/dev/users", "/api/agreements/export.csv", "/assets/anything.js"]) {
        const res = await request(t.app).get(path).set("x-dev-user", MEMBER);
        expect(res.status, path).toBe(401);
        expect(res.headers["www-authenticate"], path).toContain('Basic realm="Vendor management sample version"');
        expect(res.text, path).toBe("This sample version needs its password.");
      }
      expect((await request(t.app).post("/api/ask").set("x-dev-user", MEMBER).send({ question: "Which RFPs are still running?" })).status).toBe(401);
      expect((await request(t.app).get("/api/vendors").set("x-dev-user", MEMBER).set("Authorization", basic("wrong password here"))).status).toBe(401);
      expect((await request(t.app).get("/api/vendors").set("x-dev-user", MEMBER).set("Authorization", `Bearer ${PASSWORD}`)).status).toBe(401);

      const ok = await request(t.app).get("/api/vendors").set("x-dev-user", MEMBER).set("Authorization", basic(PASSWORD, "whoever"));
      expect(ok.status).toBe(200);
      expect(ok.body.total).toBeGreaterThan(5);
      expect(ok.headers["x-robots-tag"]).toBe("noindex, nofollow");
      // A password with a colon in it, and an empty name, are read correctly.
      expect((await request(t.app).get("/api/config").set("Authorization", basic(PASSWORD, ""))).body).toMatchObject({ demo: true, standInSignIn: true });
      // The hosting service's own check answers without the password and gives nothing away.
      const health = await request(t.app).get("/healthz");
      expect([health.status, health.text]).toEqual([200, "ok"]);
      expect((await request(t.app).post("/healthz")).status).toBe(401);
    } finally {
      await t.close();
    }
  });

  it("F-5 without the setting there is no gate and the app does not call itself a sample version", async () => {
    const t = await testApp();
    try {
      expect((await t.as(MEMBER).get("/api/config")).body.demo).toBe(false);
      expect((await request(t.app).get("/healthz")).status).not.toBe(200);
    } finally {
      await t.close();
    }
  });

  it("F-5 the password cannot be found by trying: ten wrong ones from an address close it for ten minutes", async () => {
    let time = 0;
    const app = express();
    app.set("trust proxy", 1);
    app.use(demoGate("a:long:password:with:colons", () => time));
    app.get("/", (_req, res) => res.send("in"));
    const from = (ip: string, password?: string) => {
      const r = request(app).get("/").set("X-Forwarded-For", ip);
      return password === undefined ? r : r.set("Authorization", basic(password));
    };
    expect((await from("10.0.0.1", "a:long:password:with:colons")).text).toBe("in");
    // Asking without a password, as a browser first does, does not count.
    for (let i = 0; i < 30; i++) expect((await from("10.0.0.1")).status).toBe(401);
    for (let i = 0; i < 10; i++) expect((await from("10.0.0.1", `guess ${i}`)).status).toBe(401);
    const closed = await from("10.0.0.1", "a:long:password:with:colons");
    expect(closed.status).toBe(429);
    expect(closed.headers["retry-after"]).toBe("600");
    // Someone else is not shut out with them.
    expect((await from("10.0.0.2", "a:long:password:with:colons")).status).toBe(200);
    time += 10 * 60_000 + 1;
    expect((await from("10.0.0.1", "a:long:password:with:colons")).status).toBe(200);
    // A right password clears the count.
    for (let i = 0; i < 9; i++) await from("10.0.0.3", "nope");
    expect((await from("10.0.0.3", "a:long:password:with:colons")).status).toBe(200);
    for (let i = 0; i < 9; i++) expect((await from("10.0.0.3", "nope")).status).toBe(401);
    expect((await from("10.0.0.3", "a:long:password:with:colons")).status).toBe(200);
  });
});
