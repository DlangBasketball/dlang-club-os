import { createAdminClient } from "@/lib/supabase/admin";

export type PublicProgram = {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  kind: string;
  description: string | null;
  priceChf: number;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
};

export type PublicConsent = { key: string; title: string; version: number; required: boolean };

export type PublicRegistrationData = {
  program: PublicProgram;
  consents: PublicConsent[];
  siblingDiscountPct: number;
};

/**
 * Loads everything the public registration page needs. Uses the service-role
 * client (server-only) and only ever returns a program that is public + active,
 * so RLS doesn't need to be widened for anonymous visitors.
 */
export async function getPublicProgram(slug: string): Promise<PublicRegistrationData | null> {
  const supabase = createAdminClient();

  const { data: program } = await supabase
    .from("programs")
    .select("id,org_id,slug,name,kind,description,price_chf,location,starts_on,ends_on,is_public,is_active")
    .eq("slug", slug)
    .eq("is_public", true)
    .eq("is_active", true)
    .maybeSingle();
  if (!program) return null;

  const [{ data: forms }, { data: settings }] = await Promise.all([
    supabase
      .from("consent_forms")
      .select("key,title,version,is_required")
      .eq("org_id", program.org_id)
      .eq("is_active", true)
      .order("version", { ascending: false }),
    supabase.from("app_settings").select("settings").eq("org_id", program.org_id).maybeSingle(),
  ]);

  // keep latest version per key
  const byKey = new Map<string, PublicConsent>();
  for (const f of forms ?? []) {
    if (!byKey.has(f.key)) byKey.set(f.key, { key: f.key, title: f.title, version: f.version, required: f.is_required });
  }

  const raw = (settings?.settings ?? {}) as Record<string, unknown>;
  const pct = Number(raw.sibling_discount_pct ?? 10);

  return {
    program: {
      id: program.id,
      orgId: program.org_id,
      slug: program.slug ?? slug,
      name: program.name,
      kind: program.kind,
      description: program.description,
      priceChf: Number(program.price_chf ?? 0),
      location: program.location,
      startsOn: program.starts_on,
      endsOn: program.ends_on,
    },
    consents: Array.from(byKey.values()),
    siblingDiscountPct: Number.isFinite(pct) ? pct : 10,
  };
}
