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
        await assert.rejects(
          () => store.get(key),
          (e: { status?: number }) => e.status === 404,
        );
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
      // The import saves each row in a transaction inside its own (A-8): a row the database refuses must undo only itself.
      name: "a failed transaction inside another undoes only its own work, even after a database error",
      async run() {
        const marker = `nested-${Date.now()}`;
        const count = async (tx: typeof port.db, id: string) =>
          ((await tx.execute(sql`select 1 from audit_log where entity_id = ${id}`)) as unknown as { rows: unknown[] }).rows.length;
        await assert.rejects(
          () =>
            port.db.transaction(async (tx) => {
              await tx.execute(sql`insert into audit_log (user_email, action, entity_type, entity_id) values ('contract@example.test', 'create', 'contract', ${`${marker}-outer`})`);
              await assert.rejects(() =>
                tx.transaction(async (inner) => {
                  await inner.execute(sql`insert into audit_log (user_email, action, entity_type, entity_id) values ('contract@example.test', 'create', 'contract', ${`${marker}-inner`})`);
                  await inner.execute(sql`select 1 / 0`);
                }),
              );
              const db = tx as unknown as typeof port.db;
              assert.equal(await count(db, `${marker}-inner`), 0, "the inner work was undone");
              assert.equal(await count(db, `${marker}-outer`), 1, "the outer work is still there and the outer transaction still usable");
              // Undo the outer one as well, so the check leaves nothing behind.
              throw new Error("done");
            }),
          /done/,
        );
        assert.equal(await count(port.db, `${marker}-outer`), 0);
      },
    },
    {
      name: "the audit log cannot be changed or removed",
      async run() {
        const marker = `locked-${Date.now()}`;
        await port.db.execute(sql`insert into audit_log (user_email, action, entity_type, entity_id) values ('contract@example.test', 'create', 'contract', ${marker})`);
        await assert.rejects(() => port.db.execute(sql`update audit_log set user_email = 'someone-else' where entity_id = ${marker}`));
        await assert.rejects(() => port.db.execute(sql`delete from audit_log where entity_id = ${marker}`));
        await assert.rejects(() => port.db.execute(sql`truncate audit_log`));
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

/** Reads only; a week of one board's tickets, so it is quick against a real Jira too. */
export function jiraContract(jira: JiraPort, now: Date = new Date()): ContractCase[] {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  /** The first service desk the account can see; only those carry the measurements the app reads. */
  let chosen: string | undefined;
  const firstBoard = async () => {
    if (chosen) return chosen;
    for (const p of (await jira.listProjects()).slice(0, 25)) {
      if ((await jira.describeBoard(p.key)).serviceDesk) return (chosen = p.key);
    }
    throw new Error("none of the first 25 boards is a service desk");
  };
  return [
    {
      name: "boards can be listed, each with a key and a name",
      async run() {
        const projects = await jira.listProjects();
        assert.ok(projects.length > 0, "no boards visible");
        for (const p of projects) assert.ok(p.key && p.name);
      },
    },
    {
      name: "a board can be described, with the statuses its tickets can have",
      async run() {
        const key = await firstBoard();
        const board = await jira.describeBoard(key);
        assert.equal(board.key.toUpperCase(), key.toUpperCase());
        assert.ok(board.name);
        assert.ok(board.statuses.length > 0, "the board has no statuses");
        assert.equal(board.serviceDesk, true);
      },
    },
    {
      name: "this Jira has the response-time, resolution-time and satisfaction measurements, under the names the app looks for",
      async run() {
        const { measures } = await jira.describeBoard(await firstBoard());
        assert.ok(measures.firstResponse, 'no field named "Time to first response"');
        assert.ok(measures.resolution, 'no field named "Time to resolution"');
        assert.ok(measures.satisfaction, 'no field named "Satisfaction"');
      },
    },
    {
      name: "a board that does not exist is reported as not found",
      async run() {
        await assert.rejects(
          () => jira.describeBoard("ZZNOBOARD9"),
          (e: { status?: number }) => e.status === 404,
        );
      },
    },
    {
      name: "the open tickets and those changed in the last week can be fetched, each with a key, a status and a creation time",
      async run() {
        const key = await firstBoard();
        const tickets = await jira.fetchTickets(key, weekAgo, now);
        assert.ok(tickets.length > 0, `the board ${key} has no open ticket and none changed in the last week, so nothing could be checked`);
        for (const t of tickets) {
          assert.ok(t.key.toUpperCase().startsWith(`${key.toUpperCase()}-`), `unexpected ticket key ${t.key}`);
          assert.ok(t.status, `${t.key} has no status`);
          assert.ok(t.createdAt instanceof Date && !Number.isNaN(t.createdAt.getTime()), `${t.key} has no creation time`);
          assert.ok(t.updatedAt.getTime() >= t.createdAt.getTime(), `${t.key} changed before it was created`);
          assert.ok(
            t.statusesSeen.some((s) => s.toLowerCase() === t.status.toLowerCase()),
            `${t.key}: the current status is missing from its history`,
          );
          assert.ok(t.csat === null || (t.csat >= 1 && t.csat <= 5), `${t.key} has a rating outside 1 to 5`);
          assert.ok([true, false, null].includes(t.firstResponseBreached) && [true, false, null].includes(t.resolutionBreached));
        }
      },
    },
    {
      name: "fetching the same tickets twice gives the same answer",
      async run() {
        const key = await firstBoard();
        const [a, b] = [await jira.fetchTickets(key, weekAgo, now), await jira.fetchTickets(key, weekAgo, now)];
        assert.deepEqual(
          a.map((t) => t.key),
          b.map((t) => t.key),
        );
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
