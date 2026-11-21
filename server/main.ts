import { createApp, performanceContext, scorecardContext } from "./app";
import { readMissingText } from "./features/chat/service";
import { runMonthlyProposals } from "./features/scorecards/proposals";
import { syncAll } from "./features/performance/service";
import { every } from "./platform/jobs/schedule";
import { loadConfig } from "./platform/config";
import { buildPorts } from "./platform/ports";

const config = loadConfig();
const ports = await buildPorts(config);
await ports.database.migrate();
if (config.seedOnStart && config.platform === "local") {
  const { seed } = await import("../db/seed/run");
  const { todayIn } = await import("../shared/dates");
  await seed(ports.database.db, config.today ?? todayIn(config.timeZone), scorecardContext(config, ports), ports.storage);
}

const server = createApp(config, ports).listen(config.port, config.host, () => {
  console.log(`vendorapp is running at http://${config.host}:${config.port} (${config.platform})`);
});

// Documents attached before the app could read them are read once, in the background (C-1).
void readMissingText(ports.database.db, ports.storage)
  .then((r) => (r.read || r.failed) && console.log(`Document text: ${r.read} read${r.failed ? `, ${r.failed} could not be fetched and will be tried again` : ""}`))
  .catch((e) => console.error("Reading document text failed:", (e as Error).message));

// Tickets are fetched from Jira on a schedule, for as long as the app is running (J-2).
const stopSync = every(config.jiraSyncMinutes, async () => {
  const done = await syncAll(performanceContext(config, ports), { dueOnly: true });
  for (const r of done) console.log(`Jira sync ${r.projectKey}: ${r.ok ? `${r.updated} tickets updated` : r.message}`);
});

// Once a month is over, the AI writes its proposal for each helpdesk vendor (P-1). The app looks every few hours
// whether any are still missing; only missing ones are asked for, so looking often costs nothing.
let proposalsTriedAt = Date.now() - (config.proposalMinutes - 2) * 60_000;
const stopProposals = every(config.proposalMinutes, async () => {
  if (Date.now() - proposalsTriedAt < config.proposalMinutes * 60_000) return;
  proposalsTriedAt = Date.now();
  for (const r of await runMonthlyProposals(scorecardContext(config, ports))) console.log(`AI proposal for ${r.vendorName}, ${r.month}: ${r.ok ? "written" : r.message}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopSync();
    stopProposals();
    server.close(() => void ports.database.close().finally(() => process.exit(0)));
  });
}
