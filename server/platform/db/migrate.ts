import { loadConfig } from "../config";
import { buildPorts } from "../ports";

const ports = await buildPorts(loadConfig());
await ports.database.migrate();
await ports.database.close();
console.log("Database is up to date.");
