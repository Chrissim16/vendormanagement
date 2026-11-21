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
    const other = await testApp();
    const fresh = request.agent(other.app);
    // admin@example.test is seeded; prove the rule with a database that has never seen the address.
    const { users } = await import("../../../db/schema");
    await other.ports.database.db.delete(users);
    const res = await fresh.get("/api/me").set("x-dev-user", ADMIN);
    expect(res.body.role).toBe("admin");
    await other.close();
  });
  it("gives a switched-off person no access", async () => {
    const res = await t.as("former@example.test").get("/api/me");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("no_access");
  });
  it("creates one record when first requests arrive together", async () => {
    await Promise.all([1, 2, 3, 4].map(() => t.as("twin@example.test").get("/api/me")));
    const res = await t.as(ADMIN).get("/api/admin/users").query({ q: "twin@" });
    expect(res.body.total).toBe(1);
  });
});

describe("F-2 admin", () => {
  it("refuses a member on every admin endpoint", async () => {
    const id = await userId(MEMBER);
    for (const res of [
      await t.as(MEMBER).get("/api/admin/users"),
      await t.as(MEMBER).patch(`/api/admin/users/${id}`).send({ role: "admin" }),
      await t.as(MEMBER).get("/api/admin/audit"),
      await t.as(MEMBER).get("/api/admin/system-check"),
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
    await t.as(ADMIN).patch(`/api/admin/users/${await userId("sanne@example.test")}`).send({ role: "member" });
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
});

describe("F-4 system check", () => {
  it("tests all five connections and reports each as working", async () => {
    const res = await t.as(ADMIN).get("/api/admin/system-check");
    expect(res.body.map((i: { key: string }) => i.key).sort()).toEqual(["ai", "database", "identity", "jira", "storage"]);
    for (const item of res.body) {
      expect(item, item.label).toMatchObject({ ok: true, kind: "stand-in" });
      expect(item.cases.length).toBeGreaterThan(0);
    }
  });
  it("explains a broken connection in plain language with a fix", async () => {
    const broken = await testApp();
    broken.ports.storage.put = async () => {
      throw new Error("disk is full");
    };
    const res = await broken.as(ADMIN).get("/api/admin/system-check");
    const storage = res.body.find((i: { key: string }) => i.key === "storage");
    expect(storage.ok).toBe(false);
    expect(storage.detail).toMatch(/disk is full/);
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
