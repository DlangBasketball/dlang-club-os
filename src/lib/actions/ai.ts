"use server";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildParentContext, buildAdminContext, buildCoachContext } from "@/lib/ai/context";
import { buildSystemPrompt, fallbackFor, FALLBACK } from "@/lib/ai/prompts";
import { callClaude } from "@/lib/ai/client";

export type Scope = "parent" | "admin" | "coach";
export type AskResult = { answer: string; grounded: boolean; escalate: boolean };

export async function askAssistant(question: string, scope: Scope): Promise<AskResult> {
  const me = await getSessionUser();
  if (!me?.orgId) return { answer: FALLBACK, grounded: false, escalate: true };

  // Authorise the requested scope against the caller's real roles.
  const allowed = scope === "admin" ? me.roles.includes("admin") : scope === "coach" ? me.roles.includes("coach") : me.roles.includes("parent");
  if (!allowed) return { answer: "You don't have access to this assistant.", grounded: false, escalate: false };

  const q = question.trim().slice(0, 1000);
  if (!q) return { answer: "Please type a question.", grounded: false, escalate: false };

  // Permission-aware retrieval: each builder uses an RLS-scoped client, so the
  // model can only ever see data this user is allowed to see.
  const bundle = scope === "admin" ? await buildAdminContext() : scope === "coach" ? await buildCoachContext() : await buildParentContext();
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("name").eq("id", me.orgId).maybeSingle();
  const clubName = org?.name ?? undefined;
  const fallback = fallbackFor(clubName);
  const system = buildSystemPrompt(scope, bundle.text, clubName);
  const res = await callClaude(system, q);

  let answer: string;
  let grounded: boolean;
  if (!res.ok) { answer = fallback; grounded = false; }
  else { answer = res.text; grounded = bundle.hasData && !answer.includes(fallback); }
  const escalate = !grounded;

  // Audit — service role; we store the question + a short preview, never the context.
  await admin.from("ai_queries").insert({ org_id: me.orgId, actor_id: me.id, role: scope, question: q, answer_preview: answer.slice(0, 280), grounded, escalated: escalate });

  return { answer, grounded, escalate };
}

export async function logEscalation(question: string): Promise<{ ok: true }> {
  const me = await getSessionUser();
  if (me?.orgId) {
    const admin = createAdminClient();
    await admin.from("ai_queries").insert({ org_id: me.orgId, actor_id: me.id, role: "escalation", question: question.slice(0, 1000), answer_preview: "escalated to human support", grounded: false, escalated: true });
  }
  return { ok: true };
}
