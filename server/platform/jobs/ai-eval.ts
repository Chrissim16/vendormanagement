import { runEvals } from "../../ai/evals";
import { loadConfig } from "../config";
import { buildPorts } from "../ports";
import { keyedAi, scriptedAi } from "../ports/ai";
import type { AiPort } from "../ports/types";

/**
 * `npm run ai:eval`: runs every evaluation case and says which answers were good enough.
 * Uses, in this order: the Databricks model (when run inside the workspace), a model
 * reached with AI_EVAL_URL, AI_EVAL_KEY and AI_EVAL_MODEL, or the stand-in.
 */
const env = process.env;
let ai: AiPort;
let close = async () => {};
if (env.PLATFORM === "databricks") {
  const ports = await buildPorts(loadConfig());
  ai = ports.ai;
  close = () => ports.database.close();
} else if (env.AI_EVAL_URL && env.AI_EVAL_KEY && env.AI_EVAL_MODEL) ai = keyedAi(env.AI_EVAL_URL, env.AI_EVAL_KEY, env.AI_EVAL_MODEL);
else {
  ai = scriptedAi();
  console.log("No real model is configured (AI_EVAL_URL, AI_EVAL_KEY, AI_EVAL_MODEL), so this runs against the stand-in.");
  console.log("That proves the checks work. It says nothing about how good a real model's answers are.\n");
}

const results = await runEvals(ai);
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.model ? `  [${r.model}]` : ""}`);
  for (const p of r.problems) console.log(`      ${p}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} passed.`);
await close();
if (failed) process.exitCode = 1;

export {};
