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
