import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { clubToday } from "@/lib/plans/data";
import { familyAndAthleteOptions, getClubAdminSettings, listWaitlists, waitlistTargets } from "@/lib/club-admin/data";
import { hoursLeft, waitlistTone, type WaitlistStatus } from "@/lib/club-admin/waitlist";
import { AdminAddForm, EntryActions, RunWaitlistsButton, type TargetOpt } from "@/components/club-admin/waitlist-widgets";
import { ClubAdminSettingsForm } from "@/components/club-admin/settings-form";
import { DeletePersonButton } from "@/components/people/delete-person";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.waitlist.title") };
}

/** Waiting lists: order, manual reorder / skip / offer, automatic offers with a time-limited link. Admin only. */
export default async function WaitlistsPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const today = await clubToday(me.orgId);
  const [groups, targets, opts, settings] = await Promise.all([
    listWaitlists(me.orgId), waitlistTargets(me.orgId, today), familyAndAthleteOptions(me.orgId), getClubAdminSettings(me.orgId),
  ]);
  const now = new Date();
  const label = (name: string, detail: string | null) => {
    if (!detail) return name;
    const [a, b] = detail.split("/");
    return b ? `${name} · ${f.dateRange(a, b)}` : `${name} · ${f.dateTime(a)}`;
  };
  const targetOpts: TargetOpt[] = targets.targets.map((x) => ({ kind: x.kind, id: x.id, programId: x.programId, full: x.full, label: label(x.name, x.detail) }));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("clubadmin.waitlist.title")} description={t("clubadmin.waitlist.description", { hours: settings.waitlistOfferHours })}
        actions={<RunWaitlistsButton />} />

      {groups.length === 0 && <EmptyState title={t("clubadmin.waitlist.empty")} description={t("clubadmin.waitlist.emptyHint")} />}

      {groups.map((g) => {
        const list = g.entries.filter((e) => e.status === "waiting" || e.status === "offered")
          .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
        return (
          <Card key={g.key}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>{label(g.name, g.detail)}</CardTitle>
              <span className="flex items-center gap-2 text-sm text-ink-3">
                <Badge tone="neutral">{t.dynamic(`clubadmin.waitlist.kinds.${g.kind}`, undefined, g.kind)}</Badge>
                {g.capacity != null && <span className="tnum">{t("clubadmin.waitlist.spots", { taken: g.taken, capacity: g.capacity })}</span>}
              </span>
            </CardHeader>
            <CardBody>
              <ol className="divide-y divide-line text-sm">
                {list.map((e, i) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="flex items-center gap-3">
                      <span className="tnum w-6 text-right text-ink-3">{i + 1}.</span>
                      <span>{e.athleteName} <span className="block text-xs text-ink-3">{e.familyName} · {t("clubadmin.waitlist.since", { date: f.date(e.created_at) })}</span></span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={waitlistTone(e.status as WaitlistStatus)}>{t.dynamic(`clubadmin.waitlist.statuses.${e.status}`, undefined, e.status)}</Badge>
                      {e.status === "offered" && <span className="text-xs text-ink-3">{t("clubadmin.waitlist.hoursLeft", { hours: hoursLeft(e.offer_expires_at, now) })}</span>}
                      <EntryActions id={e.id} position={i + 1} last={i === list.length - 1} status={e.status} />
                      <DeletePersonButton kind="athlete" id={e.athlete_id} name={e.athleteName} variant="icon" />
                    </span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.waitlist.addTitle")}</CardTitle></CardHeader>
        <CardBody>
          <AdminAddForm targets={targetOpts} athletes={opts.athletes} options={targets.options} groups={targets.groups} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.settings.waitlistTitle")}</CardTitle></CardHeader>
        <CardBody><ClubAdminSettingsForm initial={settings} section="waitlist" /></CardBody>
      </Card>
    </div>
  );
}
