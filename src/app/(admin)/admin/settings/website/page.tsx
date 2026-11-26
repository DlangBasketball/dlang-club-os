import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { getI18n, getTranslations } from "@/lib/i18n/server";
import { orgReturnOrigin } from "@/lib/tenant/return-origin";
import { getWebsiteSettings, type WebsiteDb } from "@/lib/website/server";
import { WebsiteSettingsForm } from "@/components/website/admin/website-settings-form";
import { EmbedGenerator } from "@/components/website/admin/embed-generator";
import { PublicFlags, type ClubEventRow, type CoachFlagRow, type TeamFlagRow } from "@/components/website/admin/public-flags";

export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("website.admin.tab") };
}

/**
 * Settings -> Website: connect the club's website (WordPress "DLang OS
 * Connect" plugin or any site) to the app. Reads go through the admin's RLS
 * session (admin-only policies); the signing secret is never read here.
 */
export default async function WebsiteSettingsPage() {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  if (!me?.orgId || !me.roles.includes("admin")) return <ErrorState message={t("website.errors.forbidden")} />;
  const db = (await createClient()) as unknown as WebsiteDb;
  const nowIso = new Date().toISOString();
  const [settings, appUrl, org, teams, coaches, events, deliveries] = await Promise.all([
    getWebsiteSettings(me.orgId, db),
    orgReturnOrigin(me.orgId),
    db.from("organizations").select("slug").eq("id", me.orgId).maybeSingle(),
    db.from("teams").select("id,name,slug,league,is_public,roster_public,cover_public").eq("org_id", me.orgId).eq("is_active", true).order("name"),
    db.from("coaches").select("id,display_name,is_public,photo_public,photo_path").eq("org_id", me.orgId).eq("is_active", true).order("display_name"),
    db.from("club_events").select("id,title,starts_at,is_public").eq("org_id", me.orgId).eq("audience", "everyone").gte("ends_at", nowIso).order("starts_at").limit(50),
    db.from("website_webhook_deliveries").select("id,resource,status,attempts,response_code,last_error,created_at,sent_at").eq("org_id", me.orgId).order("created_at", { ascending: false }).limit(10),
  ]);
  const slug = (org.data as { slug?: string } | null)?.slug ?? "";
  const teamRows: TeamFlagRow[] = ((teams.data ?? []) as { id: string; name: string; slug: string | null; league: string | null; is_public: boolean; roster_public: boolean; cover_public: boolean }[])
    .map((x) => ({ id: x.id, name: x.name, slug: x.slug, league: x.league, isPublic: x.is_public, rosterPublic: x.roster_public, coverPublic: x.cover_public }));
  const coachRows: CoachFlagRow[] = ((coaches.data ?? []) as { id: string; display_name: string; is_public: boolean; photo_public: boolean; photo_path: string | null }[])
    .map((x) => ({ id: x.id, name: x.display_name, isPublic: x.is_public, photoPublic: x.photo_public, hasPhoto: Boolean(x.photo_path) }));
  const eventRows: ClubEventRow[] = ((events.data ?? []) as { id: string; title: string; starts_at: string; is_public: boolean }[])
    .map((x) => ({ id: x.id, title: x.title, startsAt: x.starts_at, isPublic: x.is_public }));
  const recent = (deliveries.data ?? []) as { id: string; resource: string; status: string; attempts: number; response_code: number | null; last_error: string | null; created_at: string }[];

  return (
    <div className="space-y-6">
      <WebsiteSettingsForm settings={settings} appUrl={appUrl} />
      <EmbedGenerator club={slug} appUrl={appUrl} origins={settings.allowedOrigins} defaultTheme={settings.embedTheme} enabled={settings.enabled} />
      <PublicFlags teams={teamRows} coaches={coachRows} events={eventRows} rosterAllowed={settings.rosterPublic} />
      <Card>
        <CardHeader>
          <CardTitle>{t("website.admin.deliveries.title")}</CardTitle>
        </CardHeader>
        <CardBody>
          {recent.length === 0 ? (
            <p className="text-sm text-text-muted">{t("website.admin.webhook.never")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {recent.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-40 text-text-muted">{f.dateTime(d.created_at)}</span>
                  <span className="flex-1">{t.dynamic(`website.sections.${d.resource}`, {}, d.resource)}</span>
                  <Badge tone={d.status === "sent" ? "success" : d.status === "pending" ? "warning" : "danger"}>{t.dynamic(`website.deliveryStatus.${d.status}`, {}, d.status)}</Badge>
                  <span className="text-text-muted">{t("website.admin.deliveries.attempts", { count: d.attempts })}{d.response_code ? ` · HTTP ${d.response_code}` : d.last_error ? ` · ${d.last_error}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
