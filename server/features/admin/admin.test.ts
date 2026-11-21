import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { ADMIN, MEMBER, testApp } from "../../testing";

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.close());

const userId = async (email: string) => {
  const res = await t.as(ADMIN).get("/api/admin/users").query({ q: email });
  return res.body.items[0].id as string;
};

describe("F-1 sign-in", () => {
  it("returns the signed-in person and their role", async () => {
    const res = await t.as(ADMIN).get("/api/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: ADMIN, role: "admin" });
  });
  it("adds a first-time visitor as a member and records it", async () => {
    const res = await t.as("New.Person@example.test").get("/api/me");
    expect(res.body).toMatchObject({ email: "new.person@example.test", role: "member", active: true });
    const history = await t.as(ADMIN).get("/api/audit/history").query({ entityType: "user", entityId: res.body.id });
    expect(history.body.items).toHaveLength(1);
    expect(history.body.items[0]).toMatchObject({ action: "create", userEmail: "new.person@example.test" });
  });
  it("makes the bootstrap address an admin on first visit", async () => {
    const other = await testApp({}, { empty: true });
    expect((await other.as(ADMIN).get("/api/me")).body.role).toBe("admin");
    expect((await other.as("someone@example.test").get("/api/me")).body.role).toBe("member");
    await other.close();
  });
  it("rescues the first admin when the app has been left without one", async () => {
    const other = await testApp({ BOOTSTRAP_ADMIN_EMAIL: "owner@example.test" }, { empty: true });
    const { users } = await import("../../../db/schema");
    // The owner first arrived while the setting was wrong, so they are a member and nobody is admin.
    await other.ports.database.db.insert(users).values({ email: "owner@example.test", role: "member" });
    const res = await other.as("owner@example.test").get("/api/me");
    expect(res.body.role).toBe("admin");
    const history = await other.as("owner@example.test").get("/api/audit/history").query({ entityType: "user", entityId: res.body.id });
    expect(history.body.items[0]).toMatchObject({ userEmail: "system", changes: { role: { from: "member", to: "admin" } } });
    // With an admin in place, the setting no longer promotes anyone.
    await other.ports.database.db.update(users).set({ role: "member" });
    await other.ports.database.db.insert(users).values({ email: "second@example.test", role: "admin" });
    expect((await other.as("owner@example.test").get("/api/me")).body.role).toBe("member");
    await other.close();
  });
  it("gives a switched-off person no access", async () => {
    const res = await t.as("former@example.test").get("/api/me");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("no_access");
  });
  it("creates one record when first requests arrive together", async () => {
    const answers = await Promise.all([1, 2, 3, 4].map(() => t.as("twin@example.test").get("/api/me")));
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(answers.map((a) => a.body.id)).size).toBe(1);
    const history = await t.as(ADMIN).get("/api/audit/history").query({ entityType: "user", entityId: answers[0]!.body.id });
    expect(history.body.items).toHaveLength(1);
  });
});

describe("F-2 admin", () => {
  it("refuses a member on every admin endpoint", async () => {
    const id = await userId(MEMBER);
    for (const res of [
      await t.as(MEMBER).get("/api/admin/users"),
      await t.as(MEMBER).patch(`/api/admin/users/${id}`).send({ role: "admin" }),
      await t.as(MEMBER).get("/api/admin/audit"),
      await t.as(MEMBER).get(`/api/admin/users/${id}`),
      await t.as(MEMBER).post("/api/admin/system-check"),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
    }
    expect((await t.as(MEMBER).get("/api/me")).body.role).toBe("member");
  });
  it("lets an admin change a role and switch access off and on", async () => {
    const id = await userId("jonas@example.test");
    expect((await t.as(ADMIN).patch(`/api/admin/users/${id}`).send({ role: "admin" })).body.role).toBe("admin");
    expect((await t.as(ADMIN).patch(`/api/admin/users/${id}`).send({ role: "member", active: false })).body).toMatchObject({ role: "member", active: false });
    expect((await t.as("jonas@example.test").get("/api/me")).status).toBe(403);
    expect((await t.as(ADMIN).patch(`/api/admin/users/${id}`).send({ active: true })).body.active).toBe(true);
  });
  it("refuses demoting or switching off the last admin", async () => {
    const id = await userId(ADMIN);
    for (const change of [{ role: "member" }, { active: false }]) {
      const res = await t.as(ADMIN).patch(`/api/admin/users/${id}`).send(change);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("last_admin");
    }
    expect((await t.as(ADMIN).get("/api/me")).body).toMatchObject({ role: "admin", active: true });
  });
  it("keeps one admin when two admins demote each other at the same moment", async () => {
    const other = await testApp();
    const a = await other.as(ADMIN).get("/api/me");
    const jonas = (await other.as(ADMIN).get("/api/admin/users").query({ q: "jonas@" })).body.items[0].id;
    await other.as(ADMIN).patch(`/api/admin/users/${jonas}`).send({ role: "admin" });
    const { changeUser } = await import("./service");
    const db = other.ports.database.db;
    const admin = a.body;
    const second = { ...admin, id: jonas, email: "jonas@example.test" };
    // Call the service directly so both changes are already past the role check, as in a true race.
    const results = await Promise.allSettled([changeUser(db, jonas, { role: "member" }, admin), changeUser(db, admin.id, { role: "member" }, second)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "last_admin" } });
    expect((await other.as(ADMIN).get("/api/admin/users").query({ role: "admin", active: "true" })).body.total).toBe(1);
    await other.close();
  });
  it("opens one person by id, wherever they are in the list", async () => {
    const id = await userId(MEMBER);
    expect((await t.as(ADMIN).get(`/api/admin/users/${id}`)).body.email).toBe(MEMBER);
    expect((await t.as(ADMIN).get("/api/admin/users/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
  it("rejects an invalid change with a field message", async () => {
    const id = await userId(MEMBER);
    const res = await t.as(ADMIN).patch(`/api/admin/users/${id}`).send({ role: "owner" });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.role).toBeTruthy();
    expect((await t.as(ADMIN).patch(`/api/admin/users/${id}`).send({})).status).toBe(400);
  });
  it("searches, filters, sorts and pages the people list", async () => {
    const all = await t.as(ADMIN).get("/api/admin/users").query({ sort: "email", dir: "desc", pageSize: 2 });
    expect(all.body.items).toHaveLength(2);
    expect(all.body.total).toBeGreaterThanOrEqual(5);
    expect(all.body.items[0].email > all.body.items[1].email).toBe(true);
    const inactive = await t.as(ADMIN).get("/api/admin/users").query({ active: "false" });
    expect(inactive.body.items.map((u: { email: string }) => u.email)).toEqual(["former@example.test"]);
    expect((await t.as(ADMIN).get("/api/admin/users").query({ q: "okafor" })).body.items[0].email).toBe(MEMBER);
    expect((await t.as(ADMIN).get("/api/admin/users").query({ sort: "password" })).status).toBe(400);
    const byName = await t.as(ADMIN).get("/api/admin/users").query({ sort: "name" });
    expect(byName.body.items[0].displayName).toBe("Alex Admin");
  });
  it("treats search text literally and refuses text the database cannot search", async () => {
    for (const q of ["%", "_", "\\"]) expect((await t.as(ADMIN).get("/api/admin/users").query({ q })).body.total, q).toBe(0);
    expect((await t.as(ADMIN).get("/api/admin/users?q=%00")).status).toBe(400);
    expect((await t.as(ADMIN).get("/api/admin/audit").query({ user: "%" })).body.total).toBe(0);
  });
  it("answers a malformed or oversized request with a clear refusal, not a crash", async () => {
    const id = await userId(MEMBER);
    const broken = await t.as(ADMIN).patch(`/api/admin/users/${id}`).set("Content-Type", "application/json").send("{");
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe("bad_request");
    const huge = await t
      .as(ADMIN)
      .patch(`/api/admin/users/${id}`)
      .send({ role: "x".repeat(2_000_000) });
    expect(huge.status).toBe(413);
  });
});

describe("F-3 audit trail", () => {
  it("records who changed what, and shows it on the record and in the log", async () => {
    const id = await userId("sanne@example.test");
    await t.as(ADMIN).patch(`/api/admin/users/${id}`).send({ role: "admin" });
    const history = await t.as(MEMBER).get("/api/audit/history").query({ entityType: "user", entityId: id });
    expect(history.body.items[0]).toMatchObject({ userEmail: ADMIN, action: "update", summary: "sanne@example.test", changes: { role: { from: "member", to: "admin" } } });
    const log = await t.as(ADMIN).get("/api/admin/audit").query({ user: "admin@", entityType: "user" });
    expect(log.body.items.some((e: { entityId: string }) => e.entityId === id)).toBe(true);
    expect(log.body.entityTypes).toContain("user");
  });
  it("writes nothing when nothing changed or the change was refused", async () => {
    const id = await userId(ADMIN);
    // The previous test made a second admin; undo that so the last-admin rule applies again.
    await t
      .as(ADMIN)
      .patch(`/api/admin/users/${await userId("sanne@example.test")}`)
      .send({ role: "member" });
    const before = (await t.as(ADMIN).get("/api/admin/audit")).body.total;
    await t.as(ADMIN).patch(`/api/admin/users/${id}`).send({ role: "admin" });
    await t.as(ADMIN).patch(`/api/admin/users/${id}`).send({ role: "member" });
    expect((await t.as(ADMIN).get("/api/admin/audit")).body.total).toBe(before);
  });
  it("filters the log by date", async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect((await t.as(ADMIN).get("/api/admin/audit").query({ from: today, to: today })).body.total).toBeGreaterThan(0);
    expect((await t.as(ADMIN).get("/api/admin/audit").query({ to: "2000-01-01" })).body.total).toBe(0);
  });
  it("refuses dates that do not exist", async () => {
    for (const from of ["2026-02-31", "2026-13-01", "0000-00-00", "21-11-2026"]) {
      const res = await t.as(ADMIN).get("/api/admin/audit").query({ from });
      expect(res.status, from).toBe(400);
      expect(res.body.error.fields.from).toBeTruthy();
    }
  });
  it("counts a day in the team's time zone, matching the time shown on screen", async () => {
    const other = await testApp({ APP_TIME_ZONE: "Europe/Amsterdam" });
    const { auditLog } = await import("../../../db/schema");
    // 23:30 UTC on 14 July is 01:30 on 15 July in Amsterdam.
    await other.ports.database.db
      .insert(auditLog)
      .values({ at: new Date("2026-07-14T23:30:00Z"), userEmail: "tz@example.test", action: "create", entityType: "tz", entityId: "1" });
    const on = (day: string) => other.as(ADMIN).get("/api/admin/audit").query({ entityType: "tz", from: day, to: day });
    expect((await on("2026-07-15")).body.total).toBe(1);
    expect((await on("2026-07-14")).body.total).toBe(0);
    await other.close();
  });
});

describe("F-4 system check", () => {
  it("tests all five connections and reports each as working", async () => {
    const res = await t.as(ADMIN).post("/api/admin/system-check");
    expect(res.body.map((i: { key: string }) => i.key).sort()).toEqual(["ai", "database", "identity", "jira", "storage"]);
    for (const item of res.body) {
      expect(item, item.label).toMatchObject({ ok: true, kind: "stand-in" });
      expect(item.cases.length).toBeGreaterThan(0);
    }
  });
  it("explains a broken connection in plain language with a fix", async () => {
    const broken = await testApp();
    broken.ports.storage.put = async () => {
      throw Object.assign(new Error("ENOSPC: no space left on device, write '/secret/path'"), { code: "ENOSPC" });
    };
    const res = await broken.as(ADMIN).post("/api/admin/system-check");
    const storage = res.body.find((i: { key: string }) => i.key === "storage");
    expect(storage.ok).toBe(false);
    expect(storage.detail).toMatch(/not allowed to write there, or the disk is full/);
    expect(storage.detail).not.toMatch(/ENOSPC|secret/);
    expect(storage.fix).toBeTruthy();
    expect(res.body.find((i: { key: string }) => i.key === "database").ok).toBe(true);
    await broken.close();
  });
});

describe("errors", () => {
  it("answers unknown addresses in the standard shape", async () => {
    const res = await t.as(ADMIN).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: "not_found" });
  });
});
