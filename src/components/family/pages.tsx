import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Car, ChevronRight, TrendingUp } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getCarpoolBoard, getCarpoolEvents, getFamilyPanels, getJourneyAthletes, getJourneyDetail, getPrivacyPanel, getSplitFamilies } from "@/lib/family/data";
import { getMyPreferences } from "@/lib/messaging/data";
import { effectiveChannels } from "@/lib/messaging/preferences";
import { uuid } from "@/lib/family/validation";
import { PreferencesForm } from "@/components/messaging/settings";
import { FamilyPanels } from "./family-panel";
import { PrivacyPanelView } from "./privacy-panel";
import { PushOptIn } from "./push-opt-in";
import { CarpoolBoardPanel } from "./carpool-board";
import { JourneyPanel } from "./journey-panel";
import { SplitNowButton } from "./split-now-button";

type App = "admin" | "coach" | "parent";
const ROLES: Record<App, ("admin" | "finance" | "coach" | "parent")[]> = {
  admin: ["admin", "finance"],
  coach: ["coach", "admin"],
  parent: ["parent", "admin"],
};
const BASE = { admin: "/admin", coach: "/coach", parent: "/parent" } as const;

async function member(app: App) {
  const me = await requireRole(ROLES[app]);
  if (!me.orgId) notFound();
  return me as typeof me & { orgId: string };
}

// ---------------------------------------------------------------------------
export async function FamilyPage() {
  const me = await member("parent");
  const { t } = await getI18n();
  const families = await getFamilyPanels(me);
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={t("family.pages.family.title")} description={t("family.pages.family.description")} />
      {families.length === 0 ? <EmptyState title={t("family.pages.family.empty")} /> : <FamilyPanels families={families} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function PrivacyPage() {
  const me = await member("parent");
  const { t } = await getI18n();
  const [panel, prefs] = await Promise.all([getPrivacyPanel(me), getMyPreferences(me)]);
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={t("family.pages.privacy.title")} description={t("family.pages.privacy.description")} />
      {panel.familyId ? <PrivacyPanelView panel={panel} /> : <EmptyState title={t("family.pages.family.empty")} />}
      <h2 className="pt-2 font-display text-xl text-text">{t("family.pages.privacy.notifications")}</h2>
      <PushOptIn />
      <PreferencesForm
        initial={{ channels: effectiveChannels(prefs.channels), quietStart: prefs.quietStart, quietEnd: prefs.quietEnd }}
        categories={["messages", "alerts", "announcements", "events", "payments"]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function CarpoolIndexPage({ app }: { app: App }) {
  const me = await member(app);
  const { t, f } = await getI18n();
  const events = await getCarpoolEvents(me);
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={t("family.pages.carpool.title")} description={t(app === "parent" ? "family.pages.carpool.description" : "family.pages.carpool.staffDescription")} />
      {events.length === 0 ? <EmptyState icon={<Car />} title={t("family.pages.carpool.empty")} /> : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id}>
              <Link href={`${BASE[app]}/carpool/${e.id}` as never} className="block focus-visible:outline-none focus-visible:shadow-focus">
                <Card className="transition-colors hover:border-brand-primary">
                  <CardBody className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-text">{e.title ?? t.dynamic(`family.push.event.types.${e.type}`, {}, e.type)}</span>
                        {e.teamName && <Badge tone="brand">{e.teamName}</Badge>}
                        {e.away && <Badge tone="info">{t("family.carpool.away")}</Badge>}
                      </div>
                      <p className="text-xs text-text-muted">{f.dateTime(e.startsAt)}{e.location ? ` · ${e.location}` : ""}</p>
                      <p className="text-xs text-text-muted">{t("family.carpool.counts", { offers: e.offers, requests: e.requests })}</p>
                    </div>
                    <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-text-muted" />
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function CarpoolEventPage({ app, eventId }: { app: App; eventId: string }) {
  const me = await member(app);
  if (!uuid.safeParse(eventId).success) notFound();
  const { t, f } = await getI18n();
  const view = await getCarpoolBoard(me, eventId);
  if (!view) notFound();
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader
        eyebrow={<Link href={`${BASE[app]}/carpool` as never} className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /> {t("family.pages.carpool.title")}</Link>}
        title={view.event.title ?? t.dynamic(`family.push.event.types.${view.event.type}`, {}, view.event.type)}
        description={[f.dateTime(view.event.startsAt), view.event.location, view.event.teamName].filter(Boolean).join(" · ")}
      />
      {view.event.status === "cancelled" && <Badge tone="danger">{t("family.carpool.cancelledEvent")}</Badge>}
      <CarpoolBoardPanel view={view} app={app} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function JourneyIndexPage({ app }: { app: App }) {
  const me = await member(app);
  const { t, f } = await getI18n();
  const athletes = await getJourneyAthletes(me, app);
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={t("family.pages.journey.title")} description={t("family.pages.journey.description")} />
      {athletes.length === 0 ? <EmptyState icon={<TrendingUp />} title={t("family.pages.journey.empty")} /> : (
        <Card>
          <CardBody>
            <ul className="divide-y divide-border">
              {athletes.map((a) => (
                <li key={a.id}>
                  <Link href={`${BASE[app]}/journey/${a.id}` as never} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand-primary">
                    <span className="text-text">{a.name}{a.dob && <span className="ml-2 text-xs text-text-muted">{f.date(a.dob)}</span>}</span>
                    <ChevronRight aria-hidden className="h-4 w-4 text-text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export async function JourneyDetailPage({ app, athleteId }: { app: App; athleteId: string }) {
  const me = await member(app);
  if (!uuid.safeParse(athleteId).success) notFound();
  const { t } = await getI18n();
  const detail = await getJourneyDetail(me, athleteId);
  if (!detail) notFound();
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader
        eyebrow={<Link href={`${BASE[app]}/journey` as never} className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /> {t("family.pages.journey.title")}</Link>}
        title={detail.athlete.name}
        description={t("family.pages.journey.detailDescription")}
      />
      <JourneyPanel detail={detail} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export async function FamilyBillingAdminPage() {
  const me = await member("admin");
  const { t } = await getI18n();
  const rows = await getSplitFamilies(me);
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader title={t("family.pages.billing.title")} description={t("family.pages.billing.description")} />
      {rows.length === 0 ? <EmptyState title={t("family.pages.billing.empty")} /> : (
        <Card>
          <CardHeader><CardTitle>{t("family.pages.billing.families")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-border text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <Link href={`/admin/families/${r.id}` as never} className="font-medium text-text hover:text-brand-primary">{r.name}</Link>
                    <p className="text-xs text-text-muted">{r.shares.map((s) => `${s.name} ${s.pct}%`).join(" · ")}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-text-muted">{t("family.pages.billing.openUnsplit", { count: r.openUnsplit })}</span>
                    {r.openUnsplit > 0 && <SplitNowButton familyId={r.id} />}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
