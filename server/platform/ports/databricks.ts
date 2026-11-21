import { randomUUID } from "node:crypto";

/**
 * Access to the Databricks workspace as the app's own service principal.
 * UNPROVEN until first deployment: written from the SDK source and documentation.
 */
export function workspaceToken(host: string, clientId: string, clientSecret: string) {
  let cached: { token: string; expires: number } | null = null;
  let pending: Promise<string> | null = null;
  const base = host.replace(/\/$/, "");

  async function tokenEndpoint() {
    try {
      const cfg = (await (await fetch(`${base}/.well-known/databricks-config`)).json()) as { oidc_endpoint?: string };
      if (cfg.oidc_endpoint) {
        const meta = (await (await fetch(`${cfg.oidc_endpoint.replace(/\/$/, "")}/.well-known/oauth-authorization-server`)).json()) as { token_endpoint?: string };
        if (meta.token_endpoint) return meta.token_endpoint;
      }
    } catch {
      // fall through to the conventional address
    }
    return `${base}/oidc/v1/token`;
  }

  async function fetchToken() {
    const res = await fetch(await tokenEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64"),
      },
      body: "grant_type=client_credentials&scope=all-apis",
    });
    if (!res.ok) throw new Error(`Databricks refused the app's own sign-in (${res.status} ${res.statusText})`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    cached = { token: data.access_token, expires: Date.now() + ((data.expires_in ?? 3600) - 120) * 1000 };
    return data.access_token;
  }

  return async function getToken(): Promise<string> {
    if (cached && cached.expires > Date.now()) return cached.token;
    pending ??= fetchToken().finally(() => (pending = null));
    return pending;
  };
}

/** Database password for Lakebase Provisioned: a short-lived token from the credentials API. */
export function provisionedLakebasePassword(host: string, instance: string, getToken: () => Promise<string>) {
  return async () => {
    const res = await fetch(`${host.replace(/\/$/, "")}/api/2.0/database/credentials`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ instance_names: [instance], request_id: randomUUID() }),
    });
    if (!res.ok) throw new Error(`Databricks would not issue a database password (${res.status} ${res.statusText})`);
    return ((await res.json()) as { token: string }).token;
  };
}
