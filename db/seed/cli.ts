import { loadConfig } from "../../server/platform/config";
import { buildPorts } from "../../server/platform/ports";
import { seed } from "./run";

const config = loadConfig();
if (config.platform !== "local") throw new Error("Sample data is for local use only.");
const ports = await buildPorts(config);
await ports.database.migrate();
await seed(ports.database.db);
await ports.database.close();
console.log("Sample data loaded.");
