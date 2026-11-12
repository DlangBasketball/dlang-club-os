"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateTenantCache, tenantMatchesOrg } from "@/lib/tenant/server";
import { brandingToJson } from "@/lib/tenant/normalize";
import { brandingContrastChecks } from "@/lib/tenant/theme";
import { TERM_KEYS } from "@/lib/tenant/types";

export type BrandingActionResult = { ok: true } | { ok: false; error: string };

const hex = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Colors must be hex values like #DA2627");
const font = z.string().trim().regex(/^[A-Za-z0-9 ]{1,60}$/, "Font names may only contain letters, digits and spaces");
const url = z
  .string()
  .trim()
  .refine((v) => v === "" || /^(https:\/\/[^\s"'<>()]+|\/[^\s"'<>()]*)$/.test(v), "Use an https:// URL (or leave empty)")
  .transform((v) => (v === "" ? null : v));
const word = z.string().trim().min(1).max(40).regex(/^[^<>{}]+$/, "Terms cannot contain < > { }");

const Schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  sport: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/).nullable(),
  branding: z.object({
    logoUrl: url,
    faviconUrl: url,
    darkMode: z.boolean(),
    colors: z.object({ primary: hex, primaryDark: hex, accent: hex, background: hex, surface: hex, text: hex }),
    fonts: z.object({ display: font, ui: font, mono: font }),
  }),
  terminology: z.record(z.enum(TERM_KEYS), z.object({ one: word, other: word })),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Country must be an ISO 3166 code like CH or US"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Currency must be an ISO 4217 code like CHF"),
  defaultLocale: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/),
  supportedLocales: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)).min(1).max(12),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
  /** Admin explicitly accepted failing contrast checks. */
  acceptLowContrast: z.boolean().default(false),
});
export type BrandingInput = z.input<typeof Schema>;

export async function saveTenantBranding(input: BrandingInput): Promise<BrandingActionResult> {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return { ok: false, error: "Admins only" };
  if (!(await tenantMatchesOrg(me.orgId))) {
    return { ok: false, error: "You are signed in to a different organization than this site." };
  }

  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  const locales = Array.from(new Set(v.supportedLocales));
  if (!locales.includes(v.defaultLocale)) locales.unshift(v.defaultLocale);

  const failing = brandingContrastChecks(v.branding.colors).filter((c) => !c.ok);
  if (failing.length && !v.acceptLowContrast) {
    return { ok: false, error: `Low contrast: ${failing.map((c) => c.label).join(", ")}. Adjust colors or confirm to save anyway.` };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      // slug / custom_domain / plan / status / data_region are platform-managed
      name: v.name,
      sport: v.sport,
      branding: brandingToJson(v.branding),
      terminology: v.terminology,
      country: v.country,
      currency: v.currency,
      default_locale: v.defaultLocale,
      supported_locales: locales,
      timezone: v.timezone,
    })
    .eq("id", me.orgId);
  if (error) return { ok: false, error: error.message };

  // Keep legacy app_settings consumers (invoices, emails) in sync.
  const { data: as } = await admin.from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  const settings = ((as?.settings ?? {}) as Record<string, unknown>) || {};
  const brand = (settings.brand && typeof settings.brand === "object" ? settings.brand : {}) as Record<string, unknown>;
  await admin
    .from("app_settings")
    .update({
      currency: v.currency,
      default_locale: v.defaultLocale,
      settings: {
        ...settings,
        brand: { ...brand, primary_color: v.branding.colors.primary, logo_url: v.branding.logoUrl ?? "" },
        languages: locales,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", me.orgId);

  await admin.from("audit_logs").insert({
    org_id: me.orgId,
    actor_id: me.id,
    action: "settings.tenant_branding",
    target_table: "organizations",
    target_id: me.orgId,
    new_data: { name: v.name, colors: v.branding.colors, currency: v.currency, locale: v.defaultLocale, timezone: v.timezone },
  });

  invalidateTenantCache();
  revalidatePath("/", "layout");
  return { ok: true };
}
