import assert from "node:assert/strict";
import type { Request } from "express";
import { sql } from "drizzle-orm";
import type { AiPort, DatabasePort, IdentityPort, JiraPort, StoragePort } from "./types";

/**
 * What every implementation of a port must do. The same cases run in the test suite
 * against the stand-ins and, from the system check page, against the real services.
 */
export interface ContractCase {
  name: string;
  run(): Promise<void>;
}

export function storageContract(store: StoragePort): ContractCase[] {
  const key = `_contract/${Date.now()}-${Math.random().toString(36).slice(2)}/a file.txt`;
  return [
    {
      name: "a stored file reads back unchanged",
      async run() {
        const data = Buffer.from([0, 1, 2, 250, 251, 252]);
        await store.put(key, data, "application/octet-stream");
        assert.deepEqual([...(await store.get(key))], [...data]);
      },
    },
    {
      name: "storing again replaces the file",
      async run() {
        await store.put(key, Buffer.from("second"), "text/plain");
        assert.equal((await store.get(key)).toString(), "second");
      },
    },
    {
      name: "a removed file is gone, and removing twice is fine",
      async run() {
        await store.remove(key);
        await store.remove(key);
        await assert.rejects(() => store.get(key), (e: { status?: number }) => e.status === 404);
      },
    },
    {
      name: "a location outside the store is refused",
      async run() {
        await assert.rejects(() => store.put("../outside.txt", Buffer.from("x"), "text/plain"));
        await assert.rejects(() => store.get("/etc/passwd"));
      },
    },
  ];
}

export function databaseContract(port: DatabasePort): ContractCase[] {
  return [
    {
      name: "the tables exist",
      async run() {
        await port.db.execute(sql`select count(*) from users`);
        await port.db.execute(sql`select count(*) from audit_log`);
      },
    },
    {
      name: "a failed transaction leaves nothing behind",
      async run() {
        const marker = `contract-${Date.now()}`;
        await assert.rejects(() =>
          port.db.transaction(async (tx) => {
            await tx.execute(sql`insert into audit_log (user_email, action, entity_type, entity_id) values ('contract@example.test', 'create', 'contract', ${marker})`);
            throw new Error("roll back");
          }),
        );
        const rows = (await port.db.execute(sql`select 1 from audit_log where entity_id = ${marker}`)) as unknown as { rows: unknown[] };
        assert.equal(rows.rows.length, 0);
      },
    },
    {
      name: "dates without a time stay the same day",
      async run() {
        const rows = (await port.db.execute(sql`select '2027-02-28'::date::text as d`)) as unknown as { rows: unknown[] };
        assert.equal((rows.rows[0] as { d: string }).d, "2027-02-28");
      },
    },
  ];
}

export function jiraContract(jira: JiraPort): ContractCase[] {
  return [
    {
      name: "boards can be listed, each with a key and a name",
      async run() {
        const projects = await jira.listProjects();
        assert.ok(projects.length > 0, "no boards visible");
        for (const p of projects) assert.ok(p.key && p.name);
      },
    },
  ];
}

export function aiContract(ai: AiPort): ContractCase[] {
  return [
    {
      name: "both model tiers answer with text",
      async run() {
        for (const tier of ["strong", "fast"] as const) {
          const res = await ai.complete({ tier, system: "Reply with the single word pong.", user: "ping", maxTokens: 20 });
          assert.ok(res.text.trim().length > 0);
          assert.ok(res.model);
        }
      },
    },
    {
      name: "a JSON request returns something that parses as an object",
      async run() {
        const res = await ai.complete({ tier: "fast", system: 'Reply with the JSON object {"ok": true}.', user: "Go.", json: true, maxTokens: 50 });
        const start = res.text.indexOf("{");
        assert.ok(start >= 0, "no JSON object in the answer");
        assert.equal(typeof JSON.parse(res.text.slice(start, res.text.lastIndexOf("}") + 1)), "object");
      },
    },
  ];
}

/** `signedIn` is a request as the platform delivers it for a signed-in person. */
export function identityContract(identity: IdentityPort, signedIn: Request, expectedEmail: string): ContractCase[] {
  return [
    {
      name: "the signed-in person's email is returned in lower case",
      async run() {
        assert.equal(identity.resolve(signedIn)?.email, expectedEmail.toLowerCase());
      },
    },
    {
      name: "an email in the request body or address is ignored",
      async run() {
        const forged = Object.create(signedIn) as Request;
        forged.body = { email: "intruder@example.test", user: "intruder@example.test" };
        forged.query = { email: "intruder@example.test" };
        assert.equal(identity.resolve(forged)?.email, expectedEmail.toLowerCase());
      },
    },
  ];
}

export async function runCases(cases: ContractCase[]) {
  const out: { name: string; ok: boolean; error?: string }[] = [];
  for (const c of cases) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (e) {
      out.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return out;
}
