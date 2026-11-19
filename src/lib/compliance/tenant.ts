import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getComplianceProfile } from "./profile";
import { getEntitlements } from "@/lib/platform/features";
import { addonEntitlesAssistant, assistantActiveForClub, clubOptedIn, isAssistantConfigured, type AddonRow } from "@/lib/ai/access";
import type { LegalSubprocessor, LegalTenant } from "./legal-templates";

type S = Record<string, unknown>;
const obj = (v: unknown): S => (v && typeof v === "object" && !Array.isArray(v) ? (v as S) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Loads the PUBLIC variables needed to render a tenant's legal pages.
 * Service-role read, but only non-sensitive org-level fields are returned
 * (org name, published contact details, compliance config, sub-processors).
 */
export const getLegalTenant = cache(async (slug: string): Promise<LegalTenant | null> => {
  if (!hasSupabaseEnv() || !/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const admin = createAdminClient();

  const { data: org } = await admin.from("organizations").select("id,name,slug,country,plan,updated_at").eq("slug", slug).maybeSingle();
  if (!org) return null;

  const [{ data: settings }, { data: cs }, { data: subs }, ent, { data: addons }] = await Promise.all([
    admin.from("app_settings").select("settings,updated_at").eq("org_id", org.id).maybeSingle(),
    admin.from("compliance_settings").select("*").eq("org_id", org.id).maybeSingle(),
    admin
      .from("subprocessors")
      .select("name,service,processing_location,transfer_mechanism,org_id,is_active")
      .or(`org_id.is.null,org_id.eq.${org.id}`)
      .eq("is_active", true)
      .order("name"),
    getEntitlements(org.id),
    admin.from("ai_assistant_addons").select("scope,source,status,starts_at,ends_at").eq("org_id", org.id).eq("scope", "org"),
  ]);

  const s = obj(settings?.settings);
  const profileSettings = obj(s.profile);
  // Opt-in per club: unset means OFF. Listed only when the platform is
  // configured, the club holds the add-on and a club admin switched it on.
  const aiEnabled = assistantActiveForClub({
    configured: isAssistantConfigured(process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL),
    entitled: addonEntitlesAssistant((addons ?? []) as AddonRow[], { live: ent.live, suspended: ent.suspended }),
    enabled: clubOptedIn(s),
  });

  const profile = getComplianceProfile({
    country: org.country,
    data_region: cs?.data_region ?? null,
    org_type: cs?.org_type ?? null,
    jurisdiction_subdivision: cs?.jurisdiction_subdivision ?? null,
    us_state_laws: cs?.us_state_laws ?? null,
    coppa_applies: cs?.coppa_applies ?? null,
    ferpa_applies: cs?.ferpa_applies ?? null,
  });
  if (cs?.supervisory_authority) profile.supervisoryAuthority = cs.supervisory_authority;

  const subprocessors: LegalSubprocessor[] = (subs ?? [])
    .filter((x) => aiEnabled || !/assistant/i.test(x.name))
    .map((x) => ({ name: x.name, service: x.service, location: x.processing_location, mechanism: x.transfer_mechanism }));

  const overrides = Object.fromEntries(
    Object.entries(obj(cs?.legal_overrides)).filter(([, v]) => typeof v === "string"),
  ) as Record<string, string>;

  const updated = [cs?.updated_at, settings?.updated_at, org.updated_at].filter(Boolean).sort().pop() ?? new Date().toISOString();

  return {
    slug: org.slug,
    clubName: org.name,
    legalName: cs?.legal_entity_name || str(profileSettings.legal_name) || org.name,
    address: cs?.registered_address || str(profileSettings.address),
    contactEmail: cs?.privacy_contact_email || str(profileSettings.contact_email),
    contactPhone: str(profileSettings.contact_phone),
    website: str(profileSettings.website),
    country: org.country ?? "",
    companyRegisterId: cs?.company_register_id ?? "",
    vatId: cs?.vat_id || str(obj(s.tax).vat_number),
    representative: str(profileSettings.representative),
    dpoName: cs?.dpo_name ?? "",
    dpoEmail: cs?.dpo_email ?? "",
    euRepresentative: cs?.eu_representative ?? "",
    chRepresentative: cs?.ch_representative ?? "",
    ferpaAnnualNoticeUrl: cs?.ferpa_annual_notice_url ?? "",
    aiAssistantEnabled: aiEnabled,
    lastUpdated: String(updated).slice(0, 10),
    subprocessors,
    overrides,
    profile,
  };
});

/** Default tenant for platform-level links (single-club deployments). */
export function defaultLegalSlug(): string {
  return process.env.NEXT_PUBLIC_DEFAULT_ORG_SLUG ?? process.env.DEFAULT_ORG_SLUG ?? "dlang";
}
