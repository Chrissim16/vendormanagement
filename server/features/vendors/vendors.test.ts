import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, MEMBER, testApp } from "../../testing";

let t: Awaited<ReturnType<typeof testApp>>;
let me: string;
beforeAll(async () => {
  t = await testApp();
  me = (await t.as(MEMBER).get("/api/me")).body.id;
});
afterAll(() => t.close());

const add = (o: Record<string, unknown> = {}) =>
  t
    .as(MEMBER)
    .post("/api/vendors")
    .send({ name: `Vendor ${Math.random().toString(36).slice(2)}`, type: "software", ownerUserId: me, ...o });
const vendorNamed = async (name: string) => (await t.as(MEMBER).get("/api/vendors").query({ q: name, status: "all" })).body.items[0];

describe("V-1 vendor list", () => {
  it("shows name, type, status, owner, active agreements and warnings", async () => {
    const v = (await add({ name: "Listed Vendor", type: "consultancy" })).body;
    const agreement = (o: Record<string, unknown>) =>
      t
        .as(MEMBER)
        .post("/api/agreements")
        .send({ vendorId: v.id, ownerUserId: me, ...o });
    await agreement({ kind: "msa", title: "MSA", status: "active", signedOn: "2026-01-01" });
    await agreement({ kind: "nda", title: "NDA", status: "active", signedOn: "2026-01-01" });
    await agreement({ kind: "dpa", title: "Old DPA", status: "active", signedOn: "2025-01-01", endDate: "2026-11-01" });
    await agreement({ kind: "nda", title: "Draft NDA" });
    expect(await vendorNamed("Listed Vendor")).toMatchObject({
      type: "consultancy",
      status: "active",
      ownerName: "Mira Okafor",
      activeAgreements: 3,
      nda: "in_place",
      dpa: "expired",
      warnings: 1,
    });
  });
  it("searches by name and filters by type, status and owner", async () => {
    const list = (q: Record<string, string>) => t.as(MEMBER).get("/api/vendors").query(q);
    expect((await list({ q: "quillon" })).body.items.map((v: { name: string }) => v.name)).toEqual(["Quillon Consulting"]);
    expect((await list({ type: "advisory" })).body.items.map((v: { name: string }) => v.name)).toEqual(["Emberline Advisory"]);
    expect((await list({ status: "prospect" })).body.items.map((v: { name: string }) => v.name)).toEqual([
      "Calderby Software",
      "Fennmoor Expenses",
      "Harrowick Partners",
      "Oakhollow Apps",
    ]);
    const sanne = (await t.as(MEMBER).get("/api/people")).body.find((p: { email: string }) => p.email === "sanne@example.test").id;
    expect((await list({ owner: sanne })).body.items.every((v: { ownerName: string }) => v.ownerName === "Sanne de Wit")).toBe(true);
    expect((await list({ owner: sanne })).body.total).toBeGreaterThan(0);
    expect((await list({ q: "%" })).body.total).toBe(0);
  });
  it("sorts by any column and pages", async () => {
    const names = async (q: Record<string, string>) => (await t.as(MEMBER).get("/api/vendors").query(q)).body.items.map((v: { name: string }) => v.name);
    const asc = await names({ sort: "name" });
    expect(asc).toEqual([...asc].sort((a, b) => a.localeCompare(b)));
    expect(await names({ sort: "name", dir: "desc" })).toEqual([...asc].reverse());
    const owners = (await t.as(MEMBER).get("/api/vendors").query({ sort: "owner" })).body.items.map((v: { ownerName: string }) => v.ownerName);
    expect(owners).toEqual([...owners].sort((a, b) => a.localeCompare(b)));
    expect((await names({ pageSize: "2", page: "2" })).length).toBe(2);
    expect((await t.as(MEMBER).get("/api/vendors").query({ sort: "secret" })).status).toBe(400);
  });
  it("hides offboarded vendors unless asked for", async () => {
    const v = (await add({ name: "Gone Away Ltd", status: "offboarded" })).body;
    const names = async (q: Record<string, string>) =>
      (
        await t
          .as(MEMBER)
          .get("/api/vendors")
          .query({ q: "Gone Away", ...q })
      ).body.items.map((x: { id: string }) => x.id);
    expect(await names({})).toEqual([]);
    expect(await names({ status: "offboarded" })).toEqual([v.id]);
    expect(await names({ status: "all" })).toEqual([v.id]);
  });
});

describe("V-2 add and edit a vendor", () => {
  it("adds a vendor with defaults and records it", async () => {
    const res = await add({ name: "  Fresh   Vendor ", website: "https://fresh.example.test", country: "nl" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: "Fresh Vendor",
      status: "active",
      scoringEnabled: true,
      ndaRequired: true,
      dpaRequired: true,
      country: "NL",
      nda: "missing",
      warnings: 2,
    });
    const history = await t.as(MEMBER).get("/api/audit/history").query({ entityType: "vendor", entityId: res.body.id });
    expect(history.body.items[0]).toMatchObject({ action: "create", userEmail: MEMBER, summary: "Fresh Vendor" });
  });
  it("points out missing and invalid fields and saves nothing", async () => {
    const before = (await t.as(MEMBER).get("/api/vendors").query({ status: "all" })).body.total;
    const res = await t.as(MEMBER).post("/api/vendors").send({ name: " ", website: "not a link" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(["name", "ownerUserId", "type", "website"]);
    expect((await t.as(MEMBER).get("/api/vendors").query({ status: "all" })).body.total).toBe(before);
  });
  it("refuses a second vendor with the same name, ignoring case and spaces", async () => {
    await add({ name: "Twin Peaks Software" });
    for (const name of ["twin peaks software", "  TWIN   PEAKS  Software "]) {
      const res = await add({ name });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.name).toMatch(/already exists/);
    }
    const two = await Promise.all([add({ name: "Race Co" }), add({ name: "race co" })]);
    expect(two.map((r) => r.status).sort()).toEqual([201, 400]);
  });
  it("refuses renaming onto another vendor, and allows changing the case of its own name", async () => {
    const a = (await add({ name: "Alpha Works" })).body;
    await add({ name: "Beta Works" });
    expect((await t.as(MEMBER).patch(`/api/vendors/${a.id}`).send({ name: "beta works" })).status).toBe(400);
    expect((await t.as(MEMBER).patch(`/api/vendors/${a.id}`).send({ name: "ALPHA Works" })).body.name).toBe("ALPHA Works");
  });
  it("changes only what was sent, and records what changed", async () => {
    const v = (await add({ name: "Switchable", ndaRequired: false })).body;
    const res = await t.as(ADMIN).patch(`/api/vendors/${v.id}`).send({ scoringEnabled: false, dpaRequired: false });
    expect(res.body).toMatchObject({ scoringEnabled: false, dpaRequired: false, ndaRequired: false, nda: "not_required", dpa: "not_required", warnings: 0 });
    const history = await t.as(MEMBER).get("/api/audit/history").query({ entityType: "vendor", entityId: v.id });
    expect(history.body.items[0]).toMatchObject({ userEmail: ADMIN, changes: { scoringEnabled: { from: true, to: false }, dpaRequired: { from: true, to: false } } });
    expect(Object.keys(history.body.items[0].changes)).toHaveLength(2);
  });
  it("needs an owner who still has access", async () => {
    const former = (await t.as(ADMIN).get("/api/admin/users").query({ q: "former@" })).body.items[0].id;
    expect((await add({ ownerUserId: former })).body.error.fields.ownerUserId).toBeTruthy();
  });
  it("answers an unknown vendor with not found", async () => {
    expect((await t.as(MEMBER).get("/api/vendors/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await t.as(MEMBER).patch("/api/vendors/00000000-0000-4000-8000-000000000000").send({ notes: "x" })).status).toBe(404);
    expect((await t.as(MEMBER).get("/api/vendors/not-an-id")).status).toBe(400);
  });
});

describe("V-3 vendor page", () => {
  it("keeps contacts with exactly one primary", async () => {
    const v = (await add()).body;
    const first = (await t.as(MEMBER).post(`/api/vendors/${v.id}/contacts`).send({ name: "Ada Vale", email: "ada@vendor.example.test", isPrimary: true })).body;
    const second = (await t.as(MEMBER).post(`/api/vendors/${v.id}/contacts`).send({ name: "Bo Lind", isPrimary: true })).body;
    expect(second.filter((c: { isPrimary: boolean }) => c.isPrimary).map((c: { name: string }) => c.name)).toEqual(["Bo Lind"]);
    const ada = first[0].id;
    const edited = (await t.as(MEMBER).patch(`/api/contacts/${ada}`).send({ name: "Ada Vale", jobTitle: "CFO", isPrimary: true })).body;
    expect(edited.filter((c: { isPrimary: boolean }) => c.isPrimary).map((c: { name: string }) => c.name)).toEqual(["Ada Vale"]);
    expect((await t.as(MEMBER).delete(`/api/contacts/${ada}`)).body.map((c: { name: string }) => c.name)).toEqual(["Bo Lind"]);
    expect((await t.as(MEMBER).get(`/api/vendors/${v.id}`)).body.contacts).toHaveLength(1);
    const history = (await t.as(MEMBER).get("/api/audit/history").query({ entityType: "vendor", entityId: v.id })).body.items;
    expect(history[0].changes).toEqual({ "contact Ada Vale": { from: "listed", to: "removed" } });
    // Created, Ada added, Bo added (taking primary from Ada), Ada edited (taking it back), Ada removed.
    expect(history).toHaveLength(5);
    expect(history[2].changes).toEqual({ "contact Ada Vale isPrimary": { from: true, to: false }, "contact Bo Lind": { from: null, to: "added" } });
  });
  it("changes only the contact fields that were sent", async () => {
    const v = (await add()).body;
    const [c] = (await t.as(MEMBER).post(`/api/vendors/${v.id}/contacts`).send({ name: "Pat Moss", email: "pat@vendor.example.test", phone: "+31 20 555 0100", isPrimary: true }))
      .body;
    const [after] = (await t.as(MEMBER).patch(`/api/contacts/${c.id}`).send({ jobTitle: "Lead" })).body;
    expect(after).toMatchObject({ name: "Pat Moss", jobTitle: "Lead", email: "pat@vendor.example.test", phone: "+31 20 555 0100", isPrimary: true });
    expect((await t.as(MEMBER).patch(`/api/contacts/${c.id}`).send({ email: "nope" })).status).toBe(400);
  });
  it("refuses a contact without a name or with a bad email", async () => {
    const v = (await add()).body;
    const res = await t.as(MEMBER).post(`/api/vendors/${v.id}/contacts`).send({ name: "", email: "nope" });
    expect(Object.keys(res.body.error.fields).sort()).toEqual(["email", "name"]);
  });
  it("shows whether the NDA and data processing agreement are in place, missing or expired", async () => {
    const detail = async (name: string) => (await t.as(MEMBER).get(`/api/vendors/${(await vendorNamed(name)).id}`)).body;
    expect(await detail("Larkspur Data")).toMatchObject({ nda: "missing", dpa: "in_place" });
    expect(await detail("Mossgate IT")).toMatchObject({ nda: "in_place", dpa: "expired" });
    expect(await detail("Emberline Advisory")).toMatchObject({ nda: "in_place", dpa: "not_required" });
  });
});

describe("V-4 offboarding", () => {
  it("is refused while the vendor has an active agreement, naming it", async () => {
    const v = await vendorNamed("Tarnwick Software");
    const res = await t.as(MEMBER).patch(`/api/vendors/${v.id}`).send({ status: "offboarded" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Data processing agreement and 2 more/);
    expect((await vendorNamed("Tarnwick Software")).status).toBe("active");
  });
  it("is allowed once nothing is active", async () => {
    const v = await vendorNamed("Harrowick Partners");
    expect((await t.as(MEMBER).patch(`/api/vendors/${v.id}`).send({ status: "offboarded" })).body.status).toBe("offboarded");
  });
});
