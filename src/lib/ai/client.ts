import "server-only";
import { env } from "@/lib/env";

/**
 * Minimal Anthropic Messages API wrapper. Server-only. If ANTHROPIC_API_KEY is
 * unset the assistant is treated as unconfigured and callers fall back to the
 * human-support message — the app never fabricates answers.
 */
export type AIResult = { ok: true; text: string } | { ok: false; reason: "unconfigured" | "error" };

export async function callClaude(system: string, userMessage: string): Promise<AIResult> {
  const key = env.anthropicApiKey();
  if (!key) return { ok: false, reason: "unconfigured" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: env.anthropicModel(),
        max_tokens: 600,
        temperature: 0,            // deterministic, grounded answers
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!res.ok) return { ok: false, reason: "error" };
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
    return text ? { ok: true, text } : { ok: false, reason: "error" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
