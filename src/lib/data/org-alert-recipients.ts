import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { pickAlertRecipients } from "@/lib/data/alert-recipients";

/**
 * Who receives a club's staff alerts (e.g. new registrations): the club's own
 * `app_settings.settings.notification_email`, else the club's active admins.
 * Always resolved per org — never a deployment-wide address, because alerts
 * carry parents' and children's names. Server only.
 */
export async function getOrgAlertRecipients(orgId: string | null | undefined): Promise<string[]> {
  if (!orgId) return [];
  const admin = createAdminClient();
  const [{ data: settings }, { data: roles }] = await Promise.all([
    admin.from("app_settings").select("settings").eq("org_id", orgId).maybeSingle(),
    admin.from("staff_roles").select("profile_id").eq("org_id", orgId).eq("role", "admin"),
  ]);
  const ids = ((roles ?? []) as { profile_id: string }[]).map((r) => r.profile_id);
  let admins: { email: string | null; org_id: string | null; is_active: boolean | null }[] = [];
  if (ids.length) {
    const { data } = await admin.from("profiles").select("email,org_id,is_active").in("id", ids).eq("org_id", orgId);
    admins = (data ?? []) as typeof admins;
  }
  return pickAlertRecipients(orgId, (settings as { settings?: unknown } | null)?.settings, admins);
}
