import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** The migrations up to (not including) the one that turned job titles into roles, in a folder of their own. */
function migrationsBefore(tag: string) {
  const dir = mkdtempSync(join(tmpdir(), "migrations-"));
  cpSync("db/migrations", dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(
    0,
    journal.entries.findIndex((e) => e.tag === tag),
  );
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

const before = migrationsBefore("0014_parched_doctor_doom");
afterAll(() => rmSync(before, { recursive: true, force: true }));

const long = "Head of regional service delivery and continuous improvement for the Benelux".repeat(2);

describe("V-7 job titles become roles", () => {
  it("keeps every job title typed before as a role on its contact, without doubles", async () => {
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: before });
    await client.exec(`
      insert into users (id, email, role) values ('00000000-0000-4000-8000-000000000001', 'owner@example.test', 'admin');
      insert into vendors (id, name, type, owner_user_id) values ('00000000-0000-4000-8000-0000000000a1', 'Old Vendor', 'software', '00000000-0000-4000-8000-000000000001');
      insert into contacts (vendor_id, name, job_title, is_primary) values
        ('00000000-0000-4000-8000-0000000000a1', 'Ann', 'Service  Director ', true),
        ('00000000-0000-4000-8000-0000000000a1', 'Cas', 'account manager', false),
        ('00000000-0000-4000-8000-0000000000a1', 'Dee', '  ', false),
        ('00000000-0000-4000-8000-0000000000a1', 'Eve', null, false),
        ('00000000-0000-4000-8000-0000000000a1', 'Fay', '${"Head of regional service delivery and continuous improvement for the Benelux".repeat(2)}', false);
      -- Typed later, in other capitals: the first spelling is the one kept.
      insert into contacts (vendor_id, name, job_title, is_primary, created_at) values ('00000000-0000-4000-8000-0000000000a1', 'Ben', 'service director', false, now() + interval '1 day');
    `);
    await migrate(db, { migrationsFolder: "db/migrations" });
    const roles = await client.query<{ name: string }>(`select name from contact_roles order by lower(name)`);
    const names = roles.rows.map((r) => r.name);
    expect(names.filter((n) => n.toLowerCase() === "service director")).toEqual(["Service Director"]);
    expect(names.filter((n) => n.toLowerCase() === "account manager")).toEqual(["Account Manager"]);
    expect(names).toHaveLength(14);
    const held = await client.query<{ contact: string; role: string }>(
      `select c.name as contact, r.name as role from contact_role_links l join contacts c on c.id = l.contact_id join contact_roles r on r.id = l.role_id order by c.name`,
    );
    expect(held.rows).toEqual([
      { contact: "Ann", role: "Service Director" },
      { contact: "Ben", role: "Service Director" },
      { contact: "Cas", role: "Account Manager" },
      { contact: "Fay", role: long },
    ]);
    await client.close();
  });
});

describe("V-7 a long job title carried over as a role", () => {
  it("does not block changing that contact", async () => {
    // Up to 200 characters, as job titles were, so a title from before stays valid.
    const { contactSchema } = await import("../../../shared/vendors");
    expect(contactSchema.safeParse({ name: "Fay", roles: [long] }).success).toBe(true);
    expect(long.length).toBeGreaterThan(60);
  });
});

describe("Q-12 section text from before M11", () => {
  it("is marked as plain text, and everything saved afterwards as formatted text", async () => {
    const dir = migrationsBefore("0015_rfp_section_format");
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: dir });
    await client.exec(`
      insert into users (id, email, role) values ('00000000-0000-4000-8000-000000000001', 'owner@example.test', 'admin');
      insert into rfps (id, title, need, owner_user_id) values ('00000000-0000-4000-8000-0000000000b1', 'Old RFP', 'A need', '00000000-0000-4000-8000-000000000001');
      insert into rfp_sections (rfp_id, position, heading, body) values ('00000000-0000-4000-8000-0000000000b1', 1, 'Intro', '- typed as a line, not a list');
    `);
    await migrate(db, { migrationsFolder: "db/migrations" });
    await client.exec(`insert into rfp_sections (rfp_id, position, heading, body) values ('00000000-0000-4000-8000-0000000000b1', 2, 'New', '- a list');`);
    const rows = await client.query<{ heading: string; body_format: string }>(`select heading, body_format from rfp_sections order by position`);
    expect(rows.rows).toEqual([
      { heading: "Intro", body_format: "plain" },
      { heading: "New", body_format: "markdown" },
    ]);
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("M-8 the pound rate becomes a currency list", () => {
  const before = async () => {
    const dir = migrationsBefore("0018_any_currency");
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: dir });
    return { client, db, dir };
  };
  it("keeps a pound rate an admin saved, turned round to 1 EUR = so many pounds, with who saved it; the others are starting rates", async () => {
    const { client, db, dir } = await before();
    await client.exec(`
      insert into settings (id, gbp_to_eur_e4, notice_days, sow_end_days, budget_warning_pct, updated_at, updated_by) values (1, 11700, 90, 30, 80, '2026-10-01T08:00:00Z', 'owner@example.test');
      insert into users (id, email, role) values ('00000000-0000-4000-8000-000000000001', 'owner@example.test', 'admin');
      insert into vendors (id, name, type, owner_user_id) values ('00000000-0000-4000-8000-0000000000a1', 'Old Vendor', 'software', '00000000-0000-4000-8000-000000000001');
      insert into briefings (vendor_id, as_at, facts) values
        ('00000000-0000-4000-8000-0000000000a1', '2026-10-02', '{"asAt":"2026-10-02","spend":{"from":"2025-11-01","to":"2026-10-02","total":{"EUR":10000,"GBP":20000,"eurMinor":33400}}}'),
        ('00000000-0000-4000-8000-0000000000a1', '2026-10-03', '{"asAt":"2026-10-03","spend":{"from":"2025-11-01","to":"2026-10-03","total":{"EUR":0,"GBP":0,"eurMinor":0}}}');
    `);
    await migrate(db, { migrationsFolder: "db/migrations" });
    const rows = await client.query<{ code: string; units_per_eur_e4: number; rate_set_by: string | null; rate_set_at: Date | null }>(
      `select code, units_per_eur_e4, rate_set_by, rate_set_at from currencies order by code`,
    );
    expect(rows.rows.map((r) => [r.code, r.units_per_eur_e4, r.rate_set_by])).toEqual([
      ["DKK", 74600, null],
      ["EUR", 10000, null],
      ["GBP", 8547, "owner@example.test"],
      ["NOK", 117000, null],
      ["SEK", 115000, null],
      ["USD", 10800, null],
    ]);
    expect(rows.rows.find((r) => r.code === "GBP")!.rate_set_at!.toISOString()).toBe("2026-10-01T08:00:00.000Z");
    // A briefing keeps its figures in the new shape, with the pound rate they were converted at.
    const facts = await client.query<{ facts: { spend: unknown } }>(`select facts from briefings order by as_at`);
    expect(facts.rows.map((r) => r.facts.spend)).toEqual([
      { from: "2025-11-01", to: "2026-10-02", total: { amounts: { EUR: 10000, GBP: 20000 }, eurMinor: 33400 }, rates: [{ code: "GBP", unitsPerEurE4: 8547, starting: false }] },
      { from: "2025-11-01", to: "2026-10-03", total: { amounts: {}, eurMinor: 0 }, rates: [] },
    ]);
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  it("without a saved pound rate, every rate is a starting rate, and an unknown currency cannot be used", async () => {
    const { client, db, dir } = await before();
    await migrate(db, { migrationsFolder: "db/migrations" });
    const gbp = await client.query<{ units_per_eur_e4: number; rate_set_at: Date | null }>(`select units_per_eur_e4, rate_set_at from currencies where code = 'GBP'`);
    expect(gbp.rows).toEqual([{ units_per_eur_e4: 8550, rate_set_at: null }]);
    await client.exec(`insert into users (id, email, role) values ('00000000-0000-4000-8000-000000000001', 'owner@example.test', 'admin');
      insert into vendors (id, name, type, owner_user_id) values ('00000000-0000-4000-8000-0000000000a1', 'V', 'software', '00000000-0000-4000-8000-000000000001');`);
    await expect(
      client.exec(`insert into agreements (vendor_id, kind, title, owner_user_id, currency) values ('00000000-0000-4000-8000-0000000000a1', 'msa', 'M', '00000000-0000-4000-8000-000000000001', 'PLN')`),
    ).rejects.toThrow();
    await expect(client.exec(`update currencies set units_per_eur_e4 = 20000 where code = 'EUR'`)).rejects.toThrow();
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
