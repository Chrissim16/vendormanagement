import { createApp } from "./app";
import { loadConfig } from "./platform/config";
import { buildPorts } from "./platform/ports";

const config = loadConfig();
const ports = await buildPorts(config);
await ports.database.migrate();
if (config.seedOnStart && config.platform === "local") {
  const { seed } = await import("../db/seed/run");
  await seed(ports.database.db);
}

const server = createApp(config, ports).listen(config.port, config.host, () => {
  console.log(`vendorapp is running at http://${config.host}:${config.port} (${config.platform})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void ports.database.close().finally(() => process.exit(0)));
  });
}
