import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader, StatCard } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { clubToday } from "@/lib/plans/data";
import { complianceOverview, getClubAdminSettings, youthTeamsWithCoaches } from "@/lib/club-admin/data";
import { certState, certTone, coachRow, missingKinds } from "@/lib/club-admin/compliance";
import { CertificateActions, CertificateForm, OverrideForm, type CertFormValue } from "@/components/club-admin/compliance-forms";
import { ClubAdminSettingsForm } from "@/components/club-admin/settings-form";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.compliance.title") };
}

/** Staff compliance dashboard: missing / expiring checks per coach, verification, youth-team overrides. Admin only. */
export default async function StaffCompliancePage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const today = await clubToday(me.orgId);
  const [{ coaches, certs }, settings, teams] = await Promise.all([complianceOverview(me.orgId), getClubAdminSettings(me.orgId), youthTeamsWithCoaches(me.orgId)]);
  const active = coaches.filter((c) => c.is_active);
  const rows = active.map((c) => ({ coach: c, certs: certs.filter((x) => x.coach_id === c.id), ...coachRow(certs.filter((x) => x.coach_id === c.id), settings.complianceMandatoryKinds, today) }));
  const pending = certs.filter((c) => c.status === "pending");
  const expiringSoon = certs.filter((c) => certState(c, today) === "expiring").length;
  const coachName = new Map(coaches.map((c) => [c.id, c.display_name]));
  const teamName = new Map(teams.teams.map((x) => [x.id, x.name]));
  // Youth-team assignments where the coach currently misses mandatory checks.
  const atRisk = teams.assignments
    .filter((a) => teams.teams.find((x) => x.id === a.team_id)?.is_youth)
    .map((a) => ({ ...a, missing: missingKinds(certs.filter((c) => c.coach_id === a.coach_id), settings.complianceMandatoryKinds, today) }))
    .filter((a) => a.missing.length > 0);
  const blank = (coachId: string): CertFormValue => ({ id: null, coachId, kind: "first_aid", title: "", reference: "", issuedOn: "", validUntil: "", notes: "" });
  const kindLabel = (k: string) => t.dynamic(`clubadmin.compliance.kinds.${k}`, undefined, k);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("clubadmin.compliance.title")} description={t("clubadmin.compliance.description")} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={t("clubadmin.compliance.stats.compliant")} value={`${rows.filter((r) => !r.blocked).length}/${rows.length}`} />
        <StatCard label={t("clubadmin.compliance.stats.missing")} value={String(rows.filter((r) => r.blocked).length)} />
        <StatCard label={t("clubadmin.compliance.stats.expiring")} value={String(expiringSoon)} />
        <StatCard label={t("clubadmin.compliance.stats.pending")} value={String(pending.length)} />
      </div>

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.compliance.matrix")}</CardTitle></CardHeader>
        <CardBody className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t("clubadmin.compliance.matrix")}</caption>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-ink-3">
                <th scope="col" className="py-2 pr-3">{t("clubadmin.compliance.coach")}</th>
                {settings.complianceMandatoryKinds.map((k) => <th key={k} scope="col" className="py-2 pr-3">{kindLabel(k)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.coach.id}>
                  <th scope="row" className="py-2 pr-3 font-medium text-ink">{r.coach.display_name}</th>
                  {r.kinds.map((k) => (
                    <td key={k.kind} className="py-2 pr-3">
                      <Badge tone={certTone(k.state)}>{t.dynamic(`clubadmin.compliance.states.${k.state}`, undefined, k.state)}</Badge>
                      {k.cert?.valid_until && <span className="block text-xs text-ink-3">{f.date(k.cert.valid_until)}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {atRisk.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("clubadmin.compliance.atRiskTitle")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-line text-sm">
              {atRisk.map((a) => (
                <li key={`${a.team_id}-${a.coach_id}`} className="py-1.5">
                  {coachName.get(a.coach_id)} · {teamName.get(a.team_id)} — <span className="text-danger">{a.missing.map(kindLabel).join(", ")}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {rows.map((r) => (
        <Card key={r.coach.id}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{r.coach.display_name}</CardTitle>
            <Badge tone={r.blocked ? "danger" : r.attention ? "warning" : "success"}>
              {r.blocked ? t("clubadmin.compliance.missingChecks") : r.attention ? t("clubadmin.compliance.attention") : t("clubadmin.compliance.allGood")}
            </Badge>
          </CardHeader>
          <CardBody className="space-y-4">
            {r.certs.length > 0 && (
              <ul className="divide-y divide-line text-sm">
                {r.certs.map((c) => {
                  const st = certState(c, today);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{kindLabel(c.kind)}{c.title ? ` · ${c.title}` : ""}
                        <span className="block text-xs text-ink-3">
                          {c.valid_until ? t("clubadmin.compliance.validUntilDate", { date: f.date(c.valid_until) }) : t("clubadmin.compliance.noExpiry")}
                          {c.rejection_reason ? ` · ${c.rejection_reason}` : ""}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={certTone(st)}>{t.dynamic(`clubadmin.compliance.states.${st}`, undefined, st)}</Badge>
                        <CertificateActions id={c.id} status={c.status} hasFile={!!c.file_path} admin />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-maroon">{t("clubadmin.compliance.add")}</summary>
              <div className="pt-3"><CertificateForm initial={blank(r.coach.id)} /></div>
            </details>
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.compliance.overrideTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-ink-3">{t("clubadmin.compliance.overrideHint")}</p>
          <OverrideForm teams={teams.teams.filter((x) => x.is_youth).map((x) => ({ id: x.id, name: x.name }))} coaches={active.map((c) => ({ id: c.id, name: c.display_name }))} />
          {teams.overrides.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {teams.overrides.map((o) => (
                <li key={o.id} className="py-1.5">
                  {coachName.get(o.coach_id)} · {teamName.get(o.team_id)} · <span className="text-ink-3">{f.date(o.created_at)}</span>
                  <span className="block text-xs text-ink-3">{o.reason}{o.missing.length ? ` — ${o.missing.map(kindLabel).join(", ")}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("clubadmin.settings.complianceTitle")}</CardTitle></CardHeader>
        <CardBody><ClubAdminSettingsForm initial={settings} section="compliance" /></CardBody>
      </Card>
    </div>
  );
}
