import Link from "next/link";
import QRCode from "qrcode";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { clubToday } from "@/lib/plans/data";
import { shopDb } from "@/lib/shop/db";
import { getClubAdminSettings, parentMembershipView } from "@/lib/club-admin/data";
import { isExpiringSoon } from "@/lib/club-admin/membership";
import { MembershipRowActions } from "@/components/club-admin/membership-forms";
import { JoinClubRequestForm } from "@/components/approvals/club-request-forms";
import { FamilyClubRequests } from "@/components/approvals/family-club-requests";
import { NextStepBadge } from "@/components/approvals/next-step-badge";
import { listFamilyClubRequests } from "@/lib/approvals/data";
import { nextStep } from "@/lib/status/next-step";
import { getParticipantChoices } from "@/lib/participants/server";
import { getActiveAthleteState } from "@/lib/participants/my-athletes";
import { ALL_ATHLETES } from "@/lib/participants/active-athlete";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.membership.parentTitle") };
}

/**
 * Parent: memberships of the family, digital membership card (the child's
 * member-card QR token, no personal data in the code), one-click renewal,
 * joining the club ("Join the club" is a request pending club approval:
 * the membership and its invoice are created only once the club confirms).
 */
export default async function ParentMembershipPage() {
  const [me, { t, f, ctx }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("parent")) redirect("/");
  const today = await clubToday(me.orgId);
  const [view, settings, requests, choices, state] = await Promise.all([
    parentMembershipView(me.orgId, me.id, today), getClubAdminSettings(me.orgId), listFamilyClubRequests(),
    getParticipantChoices({ id: me.id, orgId: me.orgId, fullName: me.fullName ?? null }), getActiveAthleteState(),
  ]);
  const activeAthlete = state.active && state.active !== ALL_ATHLETES ? state.active : null;
  const membershipRequests = requests.filter((r) => r.subject_kind === "membership");
  const openRequests = membershipRequests.filter((r) => r.status === "pending" || r.status === "info_requested");
  const current = view.memberships.filter((m) => m.effective === "active" || m.effective === "pending_payment");
  const past = view.memberships.filter((m) => !current.includes(m));

  // Member card QR per child with an active membership (token via the existing member-card RPC).
  const db = await shopDb();
  const qr = new Map<string, string>();
  for (const m of current) {
    if (m.effective !== "active") continue;
    const kids = m.athlete_id ? [m.athlete_id] : view.children.filter((c) => c.family_id === m.family_id).map((c) => c.id);
    for (const id of kids) {
      if (qr.has(id)) continue;
      const { data: token } = await db.rpc("member_card_token", { p_athlete: id });
      if (typeof token === "string") qr.set(id, await QRCode.toDataURL(token, { margin: 1, width: 168 }));
    }
  }
  const childName = new Map(view.children.map((c) => [c.id, `${c.first_name} ${c.last_name}`]));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("clubadmin.membership.parentTitle")} description={t("clubadmin.membership.parentDescription")} />

      {current.length === 0 && openRequests.length === 0 && <EmptyState title={t("clubadmin.membership.notMember")} description={t("clubadmin.membership.notMemberHint")} />}

      <FamilyClubRequests rows={membershipRequests} t={t} f={f} title={t("approvals.join.myRequests")} />

      {current.map((m) => {
        const kids = m.athlete_id ? [m.athlete_id] : view.children.filter((c) => c.family_id === m.family_id).map((c) => c.id);
        const soon = isExpiringSoon({ status: m.effective, valid_until: m.valid_until, renewed: m.renewed }, today, settings.membershipRenewalWindowDays);
        return (
          <Card key={m.id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>{m.typeName}</CardTitle>
              <NextStepBadge step={nextStep({ status: m.effective })} t={t} />
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-sm text-ink-2">
                {(m.athleteName ?? m.familyName)} · {t("clubadmin.membership.validUntil", { date: f.date(m.valid_until) })}
              </p>
              {m.effective === "pending_payment" && m.invoice_id && (
                <p className="text-sm text-ink-2">{t("clubadmin.membership.payToActivate")}{" "}
                  <Link href={`/parent/invoices/${m.invoice_id}`} className="text-maroon hover:underline">{t("clubadmin.membership.openInvoice")}</Link></p>
              )}
              {m.effective === "active" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {kids.map((id) => (
                    <figure key={id} className="flex items-center gap-4 rounded-lg border border-line bg-surface-elevated p-4">
                      {qr.get(id) && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={qr.get(id)} alt={t("clubadmin.membership.cardQrAlt")} width={96} height={96} className="rounded bg-white p-1" />
                      )}
                      <figcaption className="space-y-1 text-sm">
                        <span className="block text-xs uppercase tracking-wider text-ink-3">{t("clubadmin.membership.cardTitle")}</span>
                        <span className="block font-medium text-ink">{childName.get(id) ?? "—"}</span>
                        <span className="block text-xs text-ink-3">{m.typeName} · {f.dateRange(m.valid_from, m.valid_until)}</span>
                        <Link href={`/parent/children/${id}/card`} className="text-xs text-maroon hover:underline">{t("clubadmin.membership.cardPdf")}</Link>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {soon && !m.renewed && (
                <div className="space-y-2">
                  <p className="text-sm text-ink-2">{t("clubadmin.membership.renewPrompt", { date: f.date(m.valid_until) })}</p>
                  <MembershipRowActions id={m.id} canRenew canCancel={false} />
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}

      {past.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("clubadmin.membership.history")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-line text-sm">
              {past.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{m.typeName} · {m.athleteName ?? m.familyName} · <span className="text-ink-3">{f.dateRange(m.valid_from, m.valid_until)}</span></span>
                  <span className="flex items-center gap-2">
                    <Badge tone="neutral">{t.dynamic(`clubadmin.membership.statuses.${m.effective}`, undefined, m.effective)}</Badge>
                    {m.effective === "expired" && !m.renewed && <MembershipRowActions id={m.id} canRenew canCancel={false} />}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.membership.joinTitle")}</CardTitle></CardHeader>
        <CardBody>
          <JoinClubRequestForm
            types={view.types.map((x) => ({
              id: x.id, name: x.name, scope: x.scope, price: f.money(Number(x.price), x.currency ?? ctx.currency),
              maxAge: (x as { max_age?: number | null }).max_age ?? null,
            }))}
            families={view.families}
            choices={choices} active={activeAthlete} today={today} />
        </CardBody>
      </Card>
    </div>
  );
}
