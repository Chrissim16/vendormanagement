import { explain, limit } from "./explain";
import type { JiraPort, JiraProject } from "./types";

/** Local stand-in with invented helpdesk boards. Ticket data arrives in milestone M3. */
export function fakeJira(): JiraPort {
  const projects: JiraProject[] = [
    { key: "BLU", name: "Bluefinch Systems service desk (invented)" },
    { key: "MOS", name: "Mossgate IT service desk (invented)" },
    { key: "TAR", name: "Tarnwick Software support (invented)" },
  ];
  return {
    kind: "stand-in",
    listProjects: async () => projects,
    check: async () => ({ ok: true, detail: `Stand-in Jira with ${projects.length} invented boards.` }),
  };
}

/** Deployed: Jira Cloud REST API with a service account's email and API token. UNPROVEN until first deployment. */
export function cloudJira(baseUrl: string, email: string, token: string): JiraPort {
  const auth = "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
  const get = async (p: string) => {
    const res = await fetch(baseUrl.replace(/\/$/, "") + p, { headers: { Authorization: auth, Accept: "application/json" }, signal: limit() });
    if (!res.ok) throw Object.assign(new Error(`Jira answered ${res.status} ${res.statusText}`), { status: res.status });
    return res.json() as Promise<unknown>;
  };
  return {
    kind: "real",
    async listProjects() {
      const data = (await get("/rest/api/3/project/search?maxResults=100")) as { values: { key: string; name: string }[] };
      return data.values.map((p) => ({ key: p.key, name: p.name }));
    },
    async check() {
      try {
        const projects = await this.listProjects();
        return projects.length
          ? { ok: true, detail: `Connected to Jira. The account can see ${projects.length} boards.` }
          : { ok: false, detail: "Connected to Jira, but the account cannot see any boards.", fix: "Give the Jira service account access to each vendor's service desk." };
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 401 || status === 403) {
          return { ok: false, detail: "Jira refused the sign-in.", fix: "Check the Jira service account's email and API token in the app settings." };
        }
        console.error("Jira check failed:", (e as Error).message);
        return {
          ok: false,
          detail: `Jira did not respond as expected. ${explain(e).cause}`,
          fix: "Check JIRA_BASE_URL, and ask IT whether Databricks Apps are allowed to connect out to Atlassian.",
        };
      }
    },
  };
}
