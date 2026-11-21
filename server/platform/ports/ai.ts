import { standInAnswer } from "./ai-fake";
import { explain, limit } from "./explain";
import type { AiMode, AiPort, AiRequest, AiResponse } from "./types";

export type Script = (req: AiRequest) => string | undefined;

/**
 * Local stand-in: answers from a script so tests are repeatable. It proves the flow around
 * the AI works; it says nothing about how good a real model's answers are.
 */
export function scriptedAi(script: Script = standInAnswer): AiPort {
  let mode: AiMode = "working";
  return {
    kind: "stand-in",
    async complete(req): Promise<AiResponse> {
      if (mode === "unavailable") throw new Error("The stand-in AI is switched to unavailable.");
      const text = mode === "nonsense" ? "I am not sure what you mean." : (script(req) ?? (req.user.trim() === "ping" ? "pong" : req.json ? "{}" : "This is a stand-in answer."));
      return { text, model: `scripted-${req.tier}` };
    },
    check: async () => ({ ok: true, detail: "Stand-in AI that answers from a script. Real answers come from Databricks after deployment." }),
    simulate: (next) => void (mode = next),
  };
}

type Target = { url: string; headers: Record<string, string>; model?: string; name: string };

/** One question to a model that speaks the chat-completions format. */
async function chat(target: Target, req: AiRequest): Promise<AiResponse> {
  const res = await fetch(target.url, {
    method: "POST",
    headers: { ...target.headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(target.model ? { model: target.model } : {}),
      messages: [
        { role: "system", content: req.system + (req.json ? "\nAnswer with one JSON object and nothing else." : "") },
        { role: "user", content: req.user },
      ],
      max_tokens: req.maxTokens ?? 2000,
    }),
    signal: limit(120_000),
  });
  if (!res.ok) throw Object.assign(new Error(`The model endpoint answered ${res.status} ${res.statusText}`), { status: res.status });
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[]; model?: string };
  const content = data.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "";
  if (!text) throw new Error("The model returned an empty answer.");
  return { text, model: data.model ?? target.name };
}

/**
 * For judging the quality of answers while building: any model reachable with an API key
 * over the chat-completions format. Only the evaluation sets use it; the app itself never does.
 */
export function keyedAi(url: string, key: string, model: string): AiPort {
  return {
    kind: "real",
    complete: (req) => chat({ url, headers: { Authorization: `Bearer ${key}` }, model, name: model }, req),
    check: async () => ({ ok: true, detail: `Evaluation model ${model}.` }),
  };
}

/**
 * Deployed: a Databricks model serving endpoint, called in the chat-completions shape.
 * UNPROVEN until first deployment.
 */
export function servingAi(host: string, endpoints: { strong: string; fast: string }, getToken: () => Promise<string>): AiPort {
  return {
    kind: "real",
    async complete(req): Promise<AiResponse> {
      const endpoint = endpoints[req.tier];
      return chat(
        {
          url: `${host.replace(/\/$/, "")}/serving-endpoints/${encodeURIComponent(endpoint)}/invocations`,
          headers: { Authorization: `Bearer ${await getToken()}` },
          name: endpoint,
        },
        req,
      );
    },
    async check() {
      try {
        const strong = await this.complete({ tier: "strong", system: "Reply with the single word pong.", user: "ping", maxTokens: 20 });
        const fast = await this.complete({ tier: "fast", system: "Reply with the single word pong.", user: "ping", maxTokens: 20 });
        return { ok: true, detail: `Both models answered (${strong.model} and ${fast.model}).` };
      } catch (e) {
        const status = (e as { status?: number }).status;
        console.error("AI check failed:", (e as Error).message);
        return {
          ok: false,
          detail: `The AI model did not answer. ${explain(e).cause}`,
          fix:
            status === 403 || status === 401
              ? "Give the app permission to query the serving endpoints (add them as app resources with 'Can query')."
              : "Check the endpoint names in AI_STRONG_ENDPOINT and AI_FAST_ENDPOINT.",
        };
      }
    },
  };
}
