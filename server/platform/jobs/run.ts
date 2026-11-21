import { performanceContext, scorecardContext } from "../../app";
import { runMonthlyProposals } from "../../features/scorecards/proposals";
import { syncAll } from "../../features/performance/service";
import { loadConfig } from "../config";
import { buildPorts } from "../ports";

/**
 * Scheduled work can also be started by name: `npm run job -- <name>`. The app runs the
 * same work by itself on a timer; the command is for running it by hand or from a
 * scheduler outside the app. Each job is safe to run twice.
 */
const jobs: Record<string, () => Promise<void>> = {
  /** Fetches every linked board's tickets from Jira (J-2). */
  "jira-sync": async () => {
    const config = loadConfig();
    const ports = await buildPorts(config);
    try {
      await ports.database.migrate();
      const done = await syncAll(performanceContext(config, ports));
      if (!done.length) console.log("No Jira boards are linked yet.");
      for (const r of done) console.log(`${r.vendorName} (${r.projectKey}): ${r.ok ? `${r.updated} tickets updated` : r.message}`);
      if (done.some((r) => !r.ok)) process.exitCode = 1;
    } finally {
      await ports.database.close();
    }
  },
  /** Asks the AI for last month's proposal for every helpdesk vendor that has none yet (P-1). */
  "monthly-proposals": async () => {
    const config = loadConfig();
    const ports = await buildPorts(config);
    try {
      await ports.database.migrate();
      const done = await runMonthlyProposals(scorecardContext(config, ports));
      if (!done.length) console.log("Every helpdesk vendor already has last month's proposal, or there was nothing to measure.");
      for (const r of done) console.log(`${r.vendorName}, ${r.month}: ${r.ok ? "proposal written" : r.message}`);
      if (done.some((r) => !r.ok)) process.exitCode = 1;
    } finally {
      await ports.database.close();
    }
  },
};

const jobName = process.argv[2];
const job = jobName ? jobs[jobName] : undefined;
if (!job) {
  console.error(`Unknown job "${jobName ?? ""}". Known jobs: ${Object.keys(jobs).join(", ")}.`);
  process.exit(1);
}
await job();

export {};
