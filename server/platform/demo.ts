import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/**
 * F-5: the gate in front of a sample version on a public address. The app's local sign-in
 * lets anyone choose who they are, so here nothing at all is served, no page and no data,
 * until the browser has sent the one shared password. The browser asks for it itself
 * (HTTP Basic); any name is accepted with it.
 */

const MAX_FAILURES = 10;
const WINDOW_MS = 10 * 60_000;
const digest = (s: string) => createHash("sha256").update(s).digest();

export function demoGate(password: string, now: () => number = Date.now): RequestHandler {
  const expected = digest(password);
  /** Wrong passwords per address, so the password cannot be found by trying. */
  const failures = new Map<string, { count: number; since: number }>();
  return (req, res, next) => {
    // The hosting service asks this to see whether the app is up. It says nothing else.
    if (req.method === "GET" && req.path === "/healthz") return void res.type("text/plain").send("ok");
    res.set("X-Robots-Tag", "noindex, nofollow");
    const who = req.ip ?? "unknown";
    const seen = failures.get(who);
    if (seen && now() - seen.since > WINDOW_MS) failures.delete(who);
    if ((failures.get(who)?.count ?? 0) >= MAX_FAILURES)
      return void res.status(429).set("Retry-After", "600").type("text/plain").send("Too many wrong passwords. Wait ten minutes and try again.");
    const header = req.headers.authorization ?? "";
    const given = header.startsWith("Basic ") ? Buffer.from(header.slice(6), "base64").toString("utf8") : null;
    // Everything after the first colon is the password; the name in front of it does not matter.
    const sent = given === null ? null : given.slice(given.indexOf(":") + 1);
    if (sent !== null && timingSafeEqual(digest(sent), expected)) {
      failures.delete(who);
      return next();
    }
    if (sent !== null) {
      const f = failures.get(who) ?? { count: 0, since: now() };
      failures.set(who, { count: f.count + 1, since: f.since });
      // Keep the list small whatever is thrown at it.
      if (failures.size > 10_000) failures.delete(failures.keys().next().value!);
    }
    res
      .status(401)
      .set({ "WWW-Authenticate": 'Basic realm="Vendor management sample version", charset="UTF-8"', "Cache-Control": "no-store" })
      .type("text/plain")
      .send("This sample version needs its password.");
  };
}
