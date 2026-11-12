"use server";
/**
 * Admin server actions for the compliance registers. All writes go through the
 * signed-in user's session client, so the database RLS policy
 * (is_org_admin(org_id)) is the authoritative check; the role check here is
 * a fast-fail only.
 */
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { safeError } from "@/lib/log";
import { DSAR_STATUSES, DSAR_TYPES } from "./dsar";
import { DATA_CATEGORIES } from "./retention";

export type ComplianceActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const REGION = z.enum(["CH", "EU", "UK", "US", "OTHER"]);
const PATH = "/admin/settings/privacy";

async function adminContext() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  return { me, supabase: await createClient() };
}

function fail(e: unknown, where: string): ComplianceActionResult<never> {
  return { ok: false, error: safeError(where, e) };
}

// --- Compliance settings ----------------------------------------------------
const settingsSchema = z.object({
  data_region: REGION,
  org_type: z.enum(["club", "team", "school", "school_district", "federation", "academy", "camp_provider", "organization", "other"]),
  jurisdiction_subdivision: z.string().max(10).nullable().optional(),
  legal_entity_name: z.string().max(200).nullable().optional(),
  registered_address: z.string().max(500).nullable().optional(),
  company_register_id: z.string().max(100).nullable().optional(),
  vat_id: z.string().max(100).nullable().optional(),
  privacy_contact_email: z.string().email().max(200).nullable().optional(),
  dpo_name: z.string().max(200).nullable().optional(),
  dpo_email: z.string().email().max(200).nullable().optional(),
  eu_representative: z.string().max(500).nullable().optional(),
  ch_representative: z.string().max(500).nullable().optional(),
  coppa_applies: z.boolean().optional(),
  ferpa_applies: z.boolean().optional(),
  ferpa_school_official_designated: z.boolean().optional(),
  ferpa_annual_notice_url: z.string().url().max(500).nullable().optional(),
  us_state_laws: z.array(z.string().length(2)).max(60).optional(),
  cookie_banner_enabled: z.boolean().optional(),
});

export async function saveComplianceSettings(input: z.input<typeof settingsSchema>): Promise<ComplianceActionResult> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Admins only" };
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    const v = parsed.data;
    const { error } = await ctx.supabase.from("compliance_settings").upsert({
      org_id: ctx.me.orgId,
      ...v,
      ferpa_designation_date: v.ferpa_school_official_designated ? new Date().toISOString().slice(0, 10) : null,
      last_reviewed_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) { return fail(e, "saveComplianceSettings"); }
}

// --- Retention ----------------------------------------------------------------
export async function updateRetentionPolicy(category: string, months: number, action: "delete" | "anonymise" | "archive" | "review"): Promise<ComplianceActionResult> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Admins only" };
  if (!(DATA_CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: "Unknown category" };
  if (!Number.isInteger(months) || months < 0 || months > 600) return { ok: false, error: "Months must be 0-600" };
  try {
    const { error } = await ctx.supabase.from("data_retention_policies")
      .upsert({ org_id: ctx.me.orgId, data_category: category, retention_months: months, expiry_action: action, is_default: false }, { onConflict: "org_id,data_category" });
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) { return fail(e, "updateRetentionPolicy"); }
}

// --- DSAR -------------------------------------------------------------------------
const dsarSchema = z.object({
  requester_name: z.string().min(1).max(200),
  requester_email: z.string().email().max(200).nullable().optional(),
  relationship: z.enum(["self", "parent_guardian", "authorized_agent", "eligible_student", "other"]).default("parent_guardian"),
  request_type: z.enum(DSAR_TYPES),
  jurisdiction: REGION,
  channel: z.enum(["email", "web_form", "in_app", "post", "phone", "in_person"]).default("email"),
  family_id: z.string().uuid().nullable().optional(),
  athlete_id: z.string().uuid().nullable().optional(),
  received_at: z.string().datetime().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export async function createDsar(input: z.input<typeof dsarSchema>): Promise<ComplianceActionResult<{ id: string; due_at: string | null }>> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Admins only" };
  const parsed = dsarSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    const { data, error } = await ctx.supabase.from("dsar_requests")
      .insert({ org_id: ctx.me.orgId, handled_by: ctx.me.id, ...parsed.data })
      .select("id,due_at").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };
    revalidatePath(PATH);
    return { ok: true, data };
  } catch (e) { return fail(e, "createDsar"); }
}

export async function updateDsarStatus(id: string, status: (typeof DSAR_STATUSES)[number], opts: { responseSummary?: string; extensionReason?: string; extendDays?: number; identityVerified?: boolean } = {}): Promise<ComplianceActionResult> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Admins only" };
  if (!z.string().uuid().safeParse(id).success || !(DSAR_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Invalid input" };
  try {
    const patch: Record<string, unknown> = { status, handled_by: ctx.me.id };
    if (opts.responseSummary) patch.response_summary = opts.responseSummary.slice(0, 4000);
    if (opts.identityVerified) patch.identity_verified_at = new Date().toISOString();
    if (status === "extended") {
      if (!opts.extensionReason || !opts.extendDays) return { ok: false, error: "Extension needs a reason and a number of days" };
      const { data: cur } = await ctx.supabase.from("dsar_requests").select("due_at").eq("id", id).maybeSingle();
      if (!cur?.due_at) return { ok: false, error: "Request not found" };
      const d = new Date(cur.due_at);
      d.setUTCDate(d.getUTCDate() + Math.min(Math.max(opts.extendDays, 1), 60));
      patch.extended_due_at = d.toISOString();
      patch.extension_reason = opts.extensionReason.slice(0, 1000);
    }
    const { error } = await ctx.supabase.from("dsar_requests").update(patch).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) { return fail(e, "updateDsarStatus"); }
}

// --- Breach log ------------------------------------------------------------------
const breachSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(8000).nullable().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  occurred_at: z.string().datetime().nullable().optional(),
  detected_at: z.string().datetime().optional(),
  data_categories: z.array(z.string().max(60)).max(30).default([]),
  subjects_affected_estimate: z.number().int().min(0).nullable().optional(),
  involves_minors: z.boolean().default(false),
  involves_special_category: z.boolean().default(false),
  jurisdictions: z.array(z.string().max(10)).max(30).default([]),
});

export async function logBreachIncident(input: z.input<typeof breachSchema>): Promise<ComplianceActionResult<{ id: string; authority_notify_by: string | null }>> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Admins only" };
  const parsed = breachSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  try {
    const { data, error } = await ctx.supabase.from("breach_incidents")
      .insert({ org_id: ctx.me.orgId, reported_by: ctx.me.id, ...parsed.data })
      .select("id,authority_notify_by").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };
    revalidatePath(PATH);
    return { ok: true, data };
  } catch (e) { return fail(e, "logBreachIncident"); }
}

const breachUpdateSchema = z.object({
  status: z.enum(["open", "investigating", "contained", "notified", "closed"]).optional(),
  risk_assessment: z.enum(["undetermined", "unlikely_risk", "risk", "high_risk"]).optional(),
  authority_notification_required: z.boolean().nullable().optional(),
  authority_notified_at: z.string().datetime().nullable().optional(),
  authority_reference: z.string().max(200).nullable().optional(),
  subjects_notified_at: z.string().datetime().nullable().optional(),
  contained_at: z.string().datetime().nullable().optional(),
  root_cause: z.string().max(8000).nullable().optional(),
  remediation: z.string().max(8000).nullable().optional(),
});

export async function updateBreachIncident(id: string, input: z.input<typeof breachUpdateSchema>): Promise<ComplianceActionResult> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Admins only" };
  const parsed = breachUpdateSchema.safeParse(input);
  if (!parsed.success || !z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid input" };
  try {
    const { error } = await ctx.supabase.from("breach_incidents").update(parsed.data).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) { return fail(e, "updateBreachIncident"); }
}

// --- COPPA verifiable parental consent ------------------------------------------
const vpcSchema = z.object({
  athlete_id: z.string().uuid(),
  guardian_profile_id: z.string().uuid().nullable().optional(),
  guardian_name: z.string().min(1).max(200),
  guardian_email: z.string().email().max(200).nullable().optional(),
  method: z.enum(["signed_form", "payment_transaction", "government_id_check", "video_conference", "toll_free_call", "knowledge_based_auth", "facial_match_id", "email_plus", "school_authorization"]),
  verified: z.boolean().default(false),
  third_party_disclosure_consented: z.boolean().default(false),
  /** Reference only (e.g. payment id). Never pass ID-document images or numbers. */
  evidence_reference: z.string().max(200).nullable().optional(),
});

export async function recordParentalConsent(input: z.input<typeof vpcSchema>): Promise<ComplianceActionResult<{ id: string }>> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Admins only" };
  const parsed = vpcSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { verified, ...v } = parsed.data;
  try {
    const now = new Date().toISOString();
    const { data, error } = await ctx.supabase.from("parental_consents").insert({
      org_id: ctx.me.orgId,
      ...v,
      scope: v.third_party_disclosure_consented ? ["collection_use", "third_party_disclosure"] : ["collection_use"],
      status: verified ? "verified" : "pending",
      verified_at: verified ? now : null,
      verified_by: verified ? ctx.me.id : null,
    }).select("id").single();
    if (error || !data) return { ok: false, error: error?.message ?? "Insert failed" };
    revalidatePath(PATH);
    return { ok: true, data };
  } catch (e) { return fail(e, "recordParentalConsent"); }
}

export async function revokeParentalConsent(id: string): Promise<ComplianceActionResult> {
  const ctx = await adminContext();
  if (!ctx) return { ok: false, error: "Admins only" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Invalid id" };
  try {
    const { error } = await ctx.supabase.from("parental_consents").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) { return fail(e, "revokeParentalConsent"); }
}
