"use server";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildAdminContext } from "@/lib/ai/context";
import { buildSystemPrompt, fallbackFor, FALLBACK } from "@/lib/ai/prompts";
import { callClaude } from "@/lib/ai/client";
import { getAssistantAccess } from "@/lib/ai/settings";
import { getTranslations } from "@/lib/i18n/server";
import { tenantMatchesOrg } from "@/lib/tenant/server";

export type Scope = "parent" | "admin" | "coach";
export type AskResult = { answer: string; grounded: boolean; escalate: boolean };

/**
 * Club-staff assistant. Opt-in per club: the platform must be configured, the
 * club's plan must include it, a club admin must have switched it on, and the
 * caller must be club admin/finance (src/lib/ai/access.ts). Parent and coach
 * scopes are not offered while the assistant is a staff-only feature.
 */
export async function askAssistant(question: string, scope: Scope): Promise<AskResult> {
  const t = await getTranslations();
  const me = await getSessionUser();
  if (!me?.orgId) return { answer: FALLBACK, grounded: false, escalate: true };

  const access = await getAssistantAccess(me);
  if (scope !== "admin" || !access.allowed || !(await tenantMatchesOrg(me.orgId))) {
    return { answer: t("aiAssistant.noAccess"), grounded: false, escalate: false };
  }

  const q = question.trim().slice(0, 1000);
  if (!q) return { answer: t("aiAssistant.emptyQuestion"), grounded: false, escalate: false };

  // Tenant-scoped, minimal context: org-wide aggregates for the caller's own
  // org only (no names, no medical notes, no card data).
  const bundle = await buildAdminContext();
  const admin = createAdminClient();
  const { data: org } = await admin.from("organizations").select("name").eq("id", me.orgId).maybeSingle();
  const clubName = org?.name ?? undefined;
  const fallback = fallbackFor(clubName);
  const system = buildSystemPrompt("admin", bundle.text, clubName);
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
