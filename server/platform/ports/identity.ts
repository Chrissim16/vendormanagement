import type { Request } from "express";
import type { IdentityPort } from "./types";

const clean = (v: unknown) => (typeof v === "string" && v.includes("@") ? v.trim().toLowerCase() : null);

/**
 * Local stand-in. The user is DEV_USER_EMAIL, or whoever the `dev_user` cookie or
 * `x-dev-user` header names, so roles can be tried out. Never used when deployed.
 */
export function devIdentity(defaultEmail: string): IdentityPort {
  return {
    kind: "stand-in",
    resolve(req: Request) {
      const email = clean(req.cookies?.dev_user) ?? clean(req.header("x-dev-user")) ?? clean(defaultEmail);
      return email ? { email, name: null } : null;
    },
    async check(req) {
      const id = this.resolve(req);
      return id
        ? { ok: true, detail: `Stand-in sign-in. You are ${id.email}.` }
        : { ok: false, detail: "No stand-in user is set.", fix: "Set DEV_USER_EMAIL in the .env file." };
    },
  };
}

/** Deployed: the Databricks Apps proxy signs the user in with Entra ID and adds these headers. */
export function headerIdentity(): IdentityPort {
  return {
    kind: "real",
    resolve(req: Request) {
      const email = clean(req.header("x-forwarded-email"));
      if (!email) return null;
      const name = req.header("x-forwarded-preferred-username") || null;
      return { email, name: name && !name.includes("@") ? name : null };
    },
    async check(req) {
      const id = this.resolve(req);
      return id
        ? { ok: true, detail: `Databricks signed you in as ${id.email}.` }
        : {
            ok: false,
            detail: "Databricks did not tell the app who you are.",
            fix: "Open the app through its Databricks Apps address, not a direct link to the server.",
          };
    },
  };
}
