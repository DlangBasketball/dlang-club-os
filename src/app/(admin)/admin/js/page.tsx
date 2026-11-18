import { redirect } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle, DataTable, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { clubToday } from "@/lib/plans/data";
import { getClubAdminSettings, jsParticipants, listCoachesForJs, listJsPrograms } from "@/lib/club-admin/data";
import { loadJsOffer } from "@/lib/club-admin/js-server";
import { jsSummary, maskAhv, type JsSummary } from "@/lib/club-admin/js";
import { AhvForm, CoachNumberRow, JsExportForm, JsOfferRow } from "@/components/club-admin/js-forms";
import { ClubAdminSettingsForm } from "@/components/club-admin/settings-form";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.js.title") };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * J+S (Jeunesse+Sport): settings, which programmes are J+S offers, coach J+S
 * numbers, participants' AHV numbers (encrypted, with consent), a subsidy
 * ESTIMATE and the CSV export for manual upload to NDS [Verify with J+S/NDS].
 */
export default async function JsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const [me, { t, f, ctx }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const today = await clubToday(me.orgId);
  const from = ISO.test(sp.from ?? "") ? sp.from! : `${today.slice(0, 4)}-01-01`;
  const to = ISO.test(sp.to ?? "") ? sp.to! : today;
  const [settings, programs, coaches] = await Promise.all([getClubAdminSettings(me.orgId), listJsPrograms(me.orgId), listCoachesForJs(me.orgId)]);
  const offers = programs.filter((p) => p.js_offer || p.viaTeam);
  const summaries: (JsSummary & { id: string; name: string })[] = [];
  for (const p of offers) {
    const d = await loadJsOffer(me.orgId, p.id, from, to, ctx.timeZone);
    summaries.push({ id: p.id, name: p.name, ...jsSummary(d.sessions, d.participants, d.marks, { ageMin: settings.jsAgeMin, ageMax: settings.jsAgeMax, ratePerParticipantHour: settings.jsRatePerParticipantHour }) });
  }
  const people = await jsParticipants(me.orgId, offers.map((o) => o.id));
  const totals = summaries.reduce((a, s) => ({ hours: a.hours + s.hours, ph: a.ph + s.participantHours, est: a.est + (s.estimatedSubsidy ?? 0) }), { hours: 0, ph: 0, est: 0 });

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("clubadmin.js.title")} description={t("clubadmin.js.description")} />
      <p role="note" className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-warning">{t("clubadmin.js.verifyNote")}</p>

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.js.summaryTitle", { from: f.date(from), to: f.date(to) })}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <form className="flex flex-wrap items-end gap-2" action="/admin/js">
            <label htmlFor="js-from" className="text-sm text-ink-2">{t("clubadmin.common.from")}</label>
            <input id="js-from" name="from" type="date" defaultValue={from} className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
            <label htmlFor="js-to" className="text-sm text-ink-2">{t("clubadmin.common.to")}</label>
            <input id="js-to" name="to" type="date" defaultValue={to} className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
            <button type="submit" className="rounded-md border border-line px-3 py-1 text-sm text-ink hover:border-maroon">{t("clubadmin.common.apply")}</button>
          </form>
          <DataTable caption={t("clubadmin.js.summaryTitle", { from: f.date(from), to: f.date(to) })}
            rows={summaries as (typeof summaries[number] & Record<string, unknown>)[]} getRowKey={(r) => r.id}
            empty={<p className="text-sm text-ink-3">{t("clubadmin.js.noOffers")}</p>}
            columns={[
              { key: "name", header: t("clubadmin.js.offer"), render: (r) => r.name },
              { key: "sessions", header: t("clubadmin.js.sessions"), align: "right", render: (r) => <span className="tnum">{r.sessions}</span> },
              { key: "hours", header: t("clubadmin.js.hours"), align: "right", render: (r) => <span className="tnum">{f.number(r.hours)}</span> },
              { key: "participants", header: t("clubadmin.js.participants"), align: "right", render: (r) => <span className="tnum">{r.participants}{r.ineligibleParticipants ? ` (+${r.ineligibleParticipants})` : ""}</span> },
              { key: "ph", header: t("clubadmin.js.participantHours"), align: "right", render: (r) => <span className="tnum">{f.number(r.participantHours)}</span> },
              { key: "est", header: t("clubadmin.js.estimate"), align: "right", render: (r) => <span className="tnum">{r.estimatedSubsidy != null ? f.money(r.estimatedSubsidy) : "—"}</span> },
            ]} />
          <p className="text-xs text-ink-3">{t("clubadmin.js.totals", { hours: f.number(totals.hours), ph: f.number(totals.ph), est: settings.jsRatePerParticipantHour != null ? f.money(totals.est) : "—" })}</p>
          <p className="text-xs text-ink-3">{t("clubadmin.js.estimateHint", { min: settings.jsAgeMin, max: settings.jsAgeMax })}</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.js.exportTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-3">{t("clubadmin.js.exportHint")}</p>
          <JsExportForm programs={offers.map((o) => ({ id: o.id, name: o.name }))} from={from} to={to} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.js.offersTitle")}</CardTitle></CardHeader>
        <CardBody>
          <p className="mb-2 text-sm text-ink-3">{t("clubadmin.js.offersHint")}</p>
          <div className="divide-y divide-line">{programs.map((p) => <JsOfferRow key={p.id} p={p} />)}</div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.js.coachesTitle")}</CardTitle></CardHeader>
        <CardBody><div className="divide-y divide-line">{coaches.filter((c) => c.is_active).map((c) => <CoachNumberRow key={c.id} c={c} />)}</div></CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.js.ahvTitle")}</CardTitle></CardHeader>
        <CardBody>
          <p className="mb-3 text-sm text-ink-3">{t("clubadmin.js.ahvHint")}</p>
          <ul className="divide-y divide-line text-sm">
            {people.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{a.name} <span className="text-xs text-ink-3">· {f.date(a.dob)}</span></span>
                <AhvForm athleteId={a.id} masked={a.ahvLast4 ? maskAhv(a.ahvLast4) : null} />
              </li>
            ))}
            {people.length === 0 && <li className="py-2 text-ink-3">{t("clubadmin.js.noParticipants")}</li>}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.settings.jsTitle")}</CardTitle></CardHeader>
        <CardBody><ClubAdminSettingsForm initial={settings} section="js" /></CardBody>
      </Card>
    </div>
  );
}
