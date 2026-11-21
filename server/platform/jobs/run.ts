/** Scheduled work is started by name: `npm run job -- <name>`. Jobs arrive from milestone M3. */
const jobs: Record<string, () => Promise<void>> = {};

const jobName = process.argv[2];
const job = jobName ? jobs[jobName] : undefined;
if (!job) {
  console.error(`Unknown job "${jobName ?? ""}". Known jobs: ${Object.keys(jobs).join(", ") || "none yet"}.`);
  process.exit(1);
}
await job();

export {};
