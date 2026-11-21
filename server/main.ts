import { createApp, performanceContext } from "./app";
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
  await seed(ports.database.db, config.today ?? todayIn(config.timeZone), performanceContext(config, ports));
}

const server = createApp(config, ports).listen(config.port, config.host, () => {
  console.log(`vendorapp is running at http://${config.host}:${config.port} (${config.platform})`);
});

// Tickets are fetched from Jira on a schedule, for as long as the app is running (J-2).
const stopSync = every(config.jiraSyncMinutes, async () => {
  const done = await syncAll(performanceContext(config, ports), { dueOnly: true });
  for (const r of done) console.log(`Jira sync ${r.projectKey}: ${r.ok ? `${r.updated} tickets updated` : r.message}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopSync();
    server.close(() => void ports.database.close().finally(() => process.exit(0)));
  });
}
