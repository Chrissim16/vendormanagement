// `npm run try`: starts the app on this computer with the invented sample data, fresh every
// time, on Windows, Mac and Linux alike. Nothing is kept when it stops, and nothing leaves
// this computer.
import { spawn } from "node:child_process";

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  console.error(`This needs Node.js 20 or newer; this computer has ${process.versions.node}. Install the current version from https://nodejs.org and try again.`);
  process.exit(1);
}
console.log("\nStarting the app with invented sample data. This takes about a minute.");
console.log('When you see "vendorapp is running", open  http://localhost:5173  in your browser.');
console.log("To stop it, press Ctrl+C in this window. Everything you entered is gone after that.\n");

const child = spawn("npm", ["run", "dev"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, SEED_ON_START: "1", DATABASE_MEMORY: "1", JIRA_SYNC_EVERY_MINUTES: "0" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));

export {};
