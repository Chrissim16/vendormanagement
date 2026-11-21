import { performanceContext } from "../../server/app";
import { loadConfig } from "../../server/platform/config";
import { buildPorts } from "../../server/platform/ports";
import { todayIn } from "../../shared/dates";
import { seed } from "./run";

const config = loadConfig();
if (config.platform !== "local") throw new Error("Sample data is for local use only.");
const ports = await buildPorts(config);
await ports.database.migrate();
await seed(ports.database.db, config.today ?? todayIn(config.timeZone), performanceContext(config, ports));
await ports.database.close();
console.log("Sample data loaded.");
