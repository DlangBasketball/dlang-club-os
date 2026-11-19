import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getComplianceProfile, type ComplianceProfile } from "./profile";
import type { Database } from "@/types/database";

type T = Database["public"]["Tables"];

export type ComplianceOverview = {
  profile: ComplianceProfile;
  settings: T["compliance_settings"]["Row"] | null;
  retention: T["data_retention_policies"]["Row"][];
  activities: T["processing_activities"]["Row"][];
  subprocessors: T["subprocessors"]["Row"][];
  openDsars: T["dsar_requests"]["Row"][];
  overdueDsarCount: number;
  openBreaches: T["breach_incidents"]["Row"][];
  pendingParentalConsents: number;
};

/**
 * Admin compliance dashboard data. Uses the USER's session client so RLS
 * (admins of the current org only) is enforced by the database.
 */
export async function getComplianceOverview(): Promise<ComplianceOverview | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [org, settings, retention, activities, subs, dsars, breaches, vpc] = await Promise.all([
    supabase.from("organizations").select("country").eq("id", me.orgId).maybeSingle(),
    supabase.from("compliance_settings").select("*").eq("org_id", me.orgId).maybeSingle(),
    supabase.from("data_retention_policies").select("*").eq("org_id", me.orgId).order("data_category"),
    supabase.from("processing_activities").select("*").eq("org_id", me.orgId).eq("is_active", true).order("name"),
    supabase.from("subprocessors").select("*").eq("is_active", true).order("name"),
    supabase.from("dsar_requests").select("*").eq("org_id", me.orgId).not("status", "in", "(completed,rejected,withdrawn)").order("due_at"),
    supabase.from("breach_incidents").select("*").eq("org_id", me.orgId).neq("status", "closed").order("detected_at", { ascending: false }),
    supabase.from("parental_consents").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("status", "pending"),
  ]);

  const cs = settings.data ?? null;
  const profile = getComplianceProfile({
    country: org.data?.country ?? null,
    data_region: cs?.data_region ?? null,
    org_type: cs?.org_type ?? null,
    jurisdiction_subdivision: cs?.jurisdiction_subdivision ?? null,
    us_state_laws: cs?.us_state_laws ?? null,
    coppa_applies: cs?.coppa_applies ?? null,
    ferpa_applies: cs?.ferpa_applies ?? null,
  });
  const openDsars = dsars.data ?? [];

  return {
    profile,
    settings: cs,
    retention: retention.data ?? [],
    activities: activities.data ?? [],
    subprocessors: subs.data ?? [],
    openDsars,
    overdueDsarCount: openDsars.filter((d) => (d.extended_due_at ?? d.due_at ?? nowIso) < nowIso).length,
    openBreaches: breaches.data ?? [],
    pendingParentalConsents: vpc.count ?? 0,
  };
}
