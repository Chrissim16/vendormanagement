import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { testApp } from "./testing";

/** X-6: nothing in the repository may be real company, vendor, person or ticket data. */
describe("X-6 sample data is invented", () => {
  it("marks every sample vendor as invented and uses only reserved example addresses", async () => {
    const t = await testApp();
    const vendors = (await t.as("admin@example.test").get("/api/vendors").query({ status: "all", pageSize: "200" })).body.items as {
      name: string;
      legalName: string | null;
      website: string | null;
    }[];
    expect(vendors.length).toBeGreaterThan(5);
    for (const v of vendors) {
      expect(v.legalName, v.name).toMatch(/\(invented\)$/);
      if (v.website) expect(v.website).toMatch(/\.example\.test$/);
    }
    const people = (await t.as("admin@example.test").get("/api/admin/users").query({ pageSize: "200" })).body.items as { email: string }[];
    for (const p of people) expect(p.email).toMatch(/@example\.test$/);
    await t.close();
  });

  it("has no email address outside the reserved example domains anywhere in the code, tests or documents", () => {
    const skip = new Set(["node_modules", ".git", "dist", ".data", "test-results", "playwright-report", "package-lock.json"]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue;
        const file = path.join(dir, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(ts|tsx|md|html|json|yaml|yml|sql|example)$/.test(name)) {
          for (const m of readFileSync(file, "utf8").matchAll(/[\w.+-]+@([\w-]+\.)+[a-z]{2,}/gi)) {
            // Reserved for examples, plus package scopes and the commit trailer's no-reply address.
            if (!/(example\.(test|com|org)|\.example\.test|company\.test|anthropic\.com)$/i.test(m[0]) && !/^[\d.]+$/.test(m[0].split("@")[1]!)) offenders.push(`${file}: ${m[0]}`);
          }
        }
      }
    };
    walk(".");
    expect(offenders).toEqual([]);
  });
});
