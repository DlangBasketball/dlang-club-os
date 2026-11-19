import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { clubToday } from "@/lib/plans/data";
import { parentMembershipView, parentWaitlist, waitlistTargets } from "@/lib/club-admin/data";
import { hoursLeft, waitlistTone, type WaitlistStatus } from "@/lib/club-admin/waitlist";
import { LeaveWaitlistButton, ParentJoinWaitlist, type TargetOpt } from "@/components/club-admin/waitlist-widgets";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.waitlist.parentTitle") };
}

/** Parent: our waiting-list places, open offers (link in the email), join a full programme / camp week. */
export default async function ParentWaitlistPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("parent")) redirect("/");
  const today = await clubToday(me.orgId);
  const [entries, targets, view] = await Promise.all([parentWaitlist(me.orgId), waitlistTargets(me.orgId, today), parentMembershipView(me.orgId, me.id, today)]);
  const label = (name: string, detail: string | null) => {
    if (!detail) return name;
    const [a, b] = detail.split("/");
    return b ? `${name} · ${f.dateRange(a, b)}` : `${name} · ${f.dateTime(a)}`;
  };
  const full: TargetOpt[] = targets.targets.filter((x) => x.full).map((x) => ({ kind: x.kind, id: x.id, programId: x.programId, full: true, label: label(x.name, x.detail) }));
  const now = new Date();

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("clubadmin.waitlist.parentTitle")} description={t("clubadmin.waitlist.parentDescription")} />

      {entries.length === 0 && <EmptyState title={t("clubadmin.waitlist.parentEmpty")} description={t("clubadmin.waitlist.parentEmptyHint")} />}
      {entries.length > 0 && (
        <Card>
          <CardBody>
            <ul className="divide-y divide-line text-sm">
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{e.athleteName} · {label(e.name, e.detail)}
                    {e.place != null && <span className="block text-xs text-ink-3">{t("clubadmin.waitlist.place", { place: e.place })}</span>}
                    {e.status === "offered" && <span className="block text-xs text-warning">{t("clubadmin.waitlist.offerOpen", { hours: hoursLeft(e.offer_expires_at, now) })}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge tone={waitlistTone(e.status as WaitlistStatus)}>{t.dynamic(`clubadmin.waitlist.statuses.${e.status}`, undefined, e.status)}</Badge>
                    {e.status === "accepted" && e.invoice_id && <Link href={`/parent/invoices/${e.invoice_id}`} className="text-maroon hover:underline">{t("clubadmin.common.invoice")}</Link>}
                    {(e.status === "waiting" || e.status === "offered") && <LeaveWaitlistButton id={e.id} />}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.waitlist.joinTitle")}</CardTitle></CardHeader>
        <CardBody>
          <ParentJoinWaitlist targets={full} options={targets.options} groups={targets.groups}
            kids={view.children.map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}` }))} />
        </CardBody>
      </Card>
    </div>
  );
}
