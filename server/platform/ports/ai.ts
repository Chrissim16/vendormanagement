import type { AiPort, AiRequest, AiResponse } from "./types";

export type Script = (req: AiRequest) => string | undefined;

/**
 * Local stand-in: answers from a script so tests are repeatable. It proves the flow around
 * the AI works; it says nothing about how good a real model's answers are.
 */
export function scriptedAi(script: Script = () => undefined): AiPort {
  return {
    kind: "stand-in",
    async complete(req): Promise<AiResponse> {
      const text = script(req) ?? (req.user.trim() === "ping" ? "pong" : req.json ? "{}" : "This is a stand-in answer.");
      return { text, model: `scripted-${req.tier}` };
    },
    check: async () => ({ ok: true, detail: "Stand-in AI that answers from a script. Real answers come from Databricks after deployment." }),
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
      const res = await fetch(`${host.replace(/\/$/, "")}/serving-endpoints/${encodeURIComponent(endpoint)}/invocations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await getToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: req.system + (req.json ? "\nAnswer with one JSON object and nothing else." : "") },
            { role: "user", content: req.user },
          ],
          max_tokens: req.maxTokens ?? 2000,
        }),
      });
      if (!res.ok) throw Object.assign(new Error(`The model endpoint answered ${res.status} ${res.statusText}`), { status: res.status });
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[]; model?: string };
      const content = data.choices?.[0]?.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (c as { text?: string }).text ?? "").join("") : "";
      if (!text) throw new Error("The model returned an empty answer.");
      return { text, model: data.model ?? endpoint };
    },
    async check() {
      try {
        const strong = await this.complete({ tier: "strong", system: "Reply with the single word pong.", user: "ping", maxTokens: 20 });
        const fast = await this.complete({ tier: "fast", system: "Reply with the single word pong.", user: "ping", maxTokens: 20 });
        return { ok: true, detail: `Both models answered (${strong.model} and ${fast.model}).` };
      } catch (e) {
        const status = (e as { status?: number }).status;
        return {
          ok: false,
          detail: `The AI model did not answer: ${(e as Error).message}`,
          fix:
            status === 403 || status === 401
              ? "Give the app permission to query the serving endpoints (add them as app resources with 'Can query')."
              : "Check the endpoint names in AI_STRONG_ENDPOINT and AI_FAST_ENDPOINT.",
        };
      }
    },
  };
}
