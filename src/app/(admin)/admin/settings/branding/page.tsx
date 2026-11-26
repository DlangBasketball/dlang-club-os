import { ErrorState } from "@/components/ui";
import { getClubSettings } from "@/lib/data/settings";
import { VenuesEditor } from "@/components/admin/settings-forms";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { rowToTenant } from "@/lib/tenant/normalize";
import type { PublicTenantRow } from "@/lib/tenant/types";
import { BrandingEditor, type PlatformInfo } from "./branding-editor";

export const metadata = { title: "Branding" };

export default async function BrandingPage() {
  const me = await getSessionUser();
  if (!me?.orgId) return <ErrorState title="Unavailable" message="Could not load settings." />;

  const admin = createAdminClient();
  const [{ data: org }, s] = await Promise.all([
    admin
      .from("organizations")
      .select("id,slug,name,custom_domain,branding,terminology,sport,country,default_locale,supported_locales,currency,timezone,status,plan,data_region")
      .eq("id", me.orgId)
      .maybeSingle(),
    getClubSettings(),
  ]);
  if (!org) return <ErrorState title="Unavailable" message="Could not load your organization." />;

  const tenant = rowToTenant(org as unknown as PublicTenantRow, "default");
  const platform: PlatformInfo = {
    slug: org.slug,
    customDomain: org.custom_domain ?? null,
    plan: org.plan ?? "starter",
    status: org.status ?? "trial",
    dataRegion: org.data_region ?? "eu",
    rootDomain: process.env.PLATFORM_ROOT_DOMAIN ?? process.env.NEXT_PUBLIC_PLATFORM_ROOT_DOMAIN ?? null,
  };
  const canEdit = me.roles.includes("admin");

  return (
    <div className="space-y-6">
      <BrandingEditor tenant={tenant} platform={platform} canEdit={canEdit} />
      {s && <VenuesEditor s={s} />}
    </div>
  );
}
