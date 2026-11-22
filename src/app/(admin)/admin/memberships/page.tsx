import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, DataTable, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { clubToday } from "@/lib/plans/data";
import { expiring, familyAndAthleteOptions, getClubAdminSettings, listMemberships, listMembershipTypes, type MembershipView } from "@/lib/club-admin/data";
import { CreateMembershipForm, MembershipRowActions, MembershipTypeForm, RenewalCampaign, type TypeFormValue } from "@/components/club-admin/membership-forms";
import { MEMBERSHIP_STATUSES } from "@/lib/club-admin/membership";
import { ClubAdminSettingsForm } from "@/components/club-admin/settings-form";
import { DeletePersonButton } from "@/components/people/delete-person";
import { getMembershipFormOptions, isUuid, listSeasonMemberships, listSeasonTeams } from "@/lib/data/player-billing";
import { parsePaymentFilter } from "@/lib/billing/player-billing";
import { SeasonMemberships } from "@/components/player-billing/season-memberships";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.membership.title") };
}

const tone = (s: string) => (s === "active" ? "success" : s === "pending_payment" ? "warning" : s === "expired" ? "danger" : "neutral");

/**
 * Club membership: season memberships (club fee, per season, filters),
 * typed memberships, types, renewal campaign. Admin (finance reads).
 */
export default async function MembershipsPage({ searchParams }: { searchParams: Promise<{ status?: string; season?: string; team?: string; payment?: string; q?: string }> }) {
  const [me, { t, f, ctx }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const isAdmin = me.roles.includes("admin");
  const today = await clubToday(me.orgId);
  const status = MEMBERSHIP_STATUSES.includes(sp.status as never) ? sp.status! : null;
  const [types, all, settings, opts] = await Promise.all([
    listMembershipTypes(me.orgId), listMemberships(me.orgId, today), getClubAdminSettings(me.orgId),
    isAdmin ? familyAndAthleteOptions(me.orgId) : Promise.resolve({ families: [], athletes: [] }),
  ]);
  const rows = status ? all.filter((m) => m.effective === status) : all;
  const formOpts = await getMembershipFormOptions();
  const seasons = formOpts.data?.seasons ?? [];
  const seasonId = isUuid(sp.season) && seasons.some((s) => s.id === sp.season) ? sp.season : seasons.find((s) => s.isCurrent)?.id ?? seasons[0]?.id ?? null;
  const teamId = isUuid(sp.team) ? sp.team : null;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 80);
  const [seasonRows, seasonTeams] = await Promise.all([listSeasonMemberships({ seasonId, teamId, q }), listSeasonTeams(seasonId)]);
  const soon = expiring(all, today, settings.membershipRenewalWindowDays);
  const active = all.filter((m) => m.effective === "active");
  const blank: TypeFormValue = {
    id: null, name: "", description: "", kind: "player", scope: "person", price: "", currency: ctx.currency, period: "season",
    seasonStartMonth: "8", minAge: "", maxAge: "", isActive: true, sort: "0",
  };
  const label = (m: MembershipView) => `${m.athleteName ?? m.familyName} · ${m.typeName}`;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("clubadmin.membership.title")} description={t("clubadmin.membership.description")} />

      {seasons.length > 0 && (
        <SeasonMemberships rows={seasonRows.data ?? []} error={seasonRows.error} seasons={seasons} teams={seasonTeams}
          filters={{ seasonId, teamId, payment: parsePaymentFilter(sp.payment), q }} />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("clubadmin.membership.stats.active")} value={String(active.length)} />
        <StatCard label={t("clubadmin.membership.stats.pending")} value={String(all.filter((m) => m.effective === "pending_payment").length)} />
        <StatCard label={t("clubadmin.membership.stats.expiring")} value={String(soon.length)} />
        <StatCard label={t("clubadmin.membership.stats.types")} value={String(types.filter((x) => x.is_active).length)} />
      </div>

      {isAdmin && soon.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("clubadmin.membership.campaignTitle", { days: settings.membershipRenewalWindowDays })}</CardTitle></CardHeader>
          <CardBody>
            <p className="mb-3 text-sm text-ink-3">{t("clubadmin.membership.campaignHint")}</p>
            <RenewalCampaign rows={soon.map((m) => ({ id: m.id, label: label(m), until: m.valid_until, reminded: m.renewal_reminded_at }))} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("clubadmin.membership.members")}</CardTitle>
          <nav aria-label={t("clubadmin.common.filter")} className="flex flex-wrap gap-2 text-sm">
            <Link href="/admin/memberships" className={!status ? "font-semibold text-maroon" : "text-ink-3 hover:text-ink"}>{t("clubadmin.common.all")}</Link>
            {MEMBERSHIP_STATUSES.map((s) => (
              <Link key={s} href={`/admin/memberships?status=${s}`} className={status === s ? "font-semibold text-maroon" : "text-ink-3 hover:text-ink"}>
                {t.dynamic(`clubadmin.membership.statuses.${s}`, undefined, s)}
              </Link>
            ))}
          </nav>
        </CardHeader>
        <CardBody>
          <DataTable caption={t("clubadmin.membership.members")} rows={rows as (MembershipView & Record<string, unknown>)[]} getRowKey={(r) => r.id}
            empty={<EmptyState title={t("clubadmin.membership.noMembers")} description={t("clubadmin.membership.noMembersHint")} />}
            columns={[
              { key: "who", header: t("clubadmin.membership.holder"), render: (r) => <span>{r.athlete_id ? <Link href={`/admin/athletes/${r.athlete_id}?tab=membership`} className="hover:text-maroon">{r.athleteName ?? r.familyName}</Link> : <Link href={`/admin/families/${r.family_id}`} className="hover:text-maroon">{r.familyName}</Link>}{r.athleteName && <span className="block text-xs text-ink-3">{r.familyName}</span>}</span> },
              { key: "type", header: t("clubadmin.membership.type"), render: (r) => r.typeName },
              { key: "valid", header: t("clubadmin.membership.validity"), render: (r) => f.dateRange(r.valid_from, r.valid_until) },
              { key: "amount", header: t("clubadmin.membership.price"), align: "right", render: (r) => <span className="tnum">{f.money(Number(r.price_amount), r.currency)}</span> },
              { key: "invoice", header: t("clubadmin.common.invoice"), render: (r) => r.invoice_id ? <Link href={`/admin/invoices/${r.invoice_id}`} className="tnum text-maroon hover:underline">{r.invoiceNumber ?? "—"}</Link> : "—" },
              { key: "status", header: t("clubadmin.common.status"), render: (r) => <Badge tone={tone(r.effective)}>{t.dynamic(`clubadmin.membership.statuses.${r.effective}`, undefined, r.effective)}</Badge> },
              ...(isAdmin ? [{ key: "actions", header: "", render: (r: MembershipView) => (
                <span className="inline-flex items-center gap-1">
                  <MembershipRowActions id={r.id} canRenew={!r.renewed && (r.effective === "active" || r.effective === "expired")} canCancel={r.effective !== "cancelled"} />
                  {r.athlete_id
                    ? <DeletePersonButton kind="athlete" id={r.athlete_id} name={r.athleteName ?? r.familyName} variant="icon" />
                    : <DeletePersonButton kind="family" id={r.family_id} name={r.familyName} variant="icon" />}
                </span>
              ) }] : []),
            ]} />
        </CardBody>
      </Card>

      {isAdmin && types.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("clubadmin.membership.enrolTitle")}</CardTitle></CardHeader>
          <CardBody>
            <CreateMembershipForm types={types.filter((x) => x.is_active).map((x) => ({ id: x.id, name: x.name, scope: x.scope }))}
              families={opts.families} athletes={opts.athletes} today={today} />
          </CardBody>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader><CardTitle>{t("clubadmin.membership.types")}</CardTitle></CardHeader>
          <CardBody className="space-y-6">
            {types.map((x) => (
              <details key={x.id} className="rounded-md border border-line p-3">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-ink">{x.name}</span>
                  <span className="flex items-center gap-2 text-ink-3">
                    <span className="tnum">{f.money(Number(x.price), x.currency ?? ctx.currency)}</span>
                    <Badge tone="neutral">{t.dynamic(`clubadmin.membership.periods.${x.period}`, undefined, x.period)}</Badge>
                    {!x.is_active && <Badge tone="neutral">{t("clubadmin.membership.inactive")}</Badge>}
                  </span>
                </summary>
                <div className="pt-3">
                  <MembershipTypeForm initial={{
                    id: x.id, name: x.name, description: x.description ?? "", kind: x.kind as TypeFormValue["kind"], scope: x.scope,
                    price: String(x.price), currency: x.currency ?? "", period: x.period, seasonStartMonth: String(x.season_start_month),
                    minAge: x.min_age != null ? String(x.min_age) : "", maxAge: x.max_age != null ? String(x.max_age) : "", isActive: x.is_active, sort: String(x.sort),
                  }} />
                </div>
              </details>
            ))}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink">{t("clubadmin.membership.newType")}</h3>
              <MembershipTypeForm initial={blank} />
            </div>
            <p className="text-xs text-ink-3">{t("clubadmin.membership.memberPriceHint")}</p>
          </CardBody>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader><CardTitle>{t("clubadmin.settings.renewalWindow")}</CardTitle></CardHeader>
          <CardBody><ClubAdminSettingsForm initial={settings} section="membership" /></CardBody>
        </Card>
      )}
    </div>
  );
}
