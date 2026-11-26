import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { clubToday } from "@/lib/plans/data";
import { complianceOverview, getClubAdminSettings, myCoach } from "@/lib/club-admin/data";
import { certState, certTone, coachRow } from "@/lib/club-admin/compliance";
import { CertificateActions, CertificateForm } from "@/components/club-admin/compliance-forms";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("clubadmin.compliance.myTitle") };
}

/** Coach: my certificates and checks, what the club requires, upload a new one (verified by an admin). */
export default async function CoachCompliancePage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("coach")) redirect("/");
  const coach = await myCoach(me.orgId, me.id);
  if (!coach) return <EmptyState title={t("clubadmin.compliance.noCoachRecord")} />;
  const today = await clubToday(me.orgId);
  const [{ certs }, settings] = await Promise.all([complianceOverview(me.orgId, coach.id), getClubAdminSettings(me.orgId)]);
  const row = coachRow(certs, settings.complianceMandatoryKinds, today);
  const kindLabel = (k: string) => t.dynamic(`clubadmin.compliance.kinds.${k}`, undefined, k);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("clubadmin.compliance.myTitle")} description={t("clubadmin.compliance.myDescription")} />
      <Card>
        <CardHeader><CardTitle>{t("clubadmin.compliance.required")}</CardTitle></CardHeader>
        <CardBody>
          <ul className="flex flex-wrap gap-3 text-sm">
            {row.kinds.map((k) => (
              <li key={k.kind} className="flex items-center gap-2">{kindLabel(k.kind)}
                <Badge tone={certTone(k.state)}>{t.dynamic(`clubadmin.compliance.states.${k.state}`, undefined, k.state)}</Badge></li>
            ))}
          </ul>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("clubadmin.compliance.myCertificates")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {certs.length === 0 && <p className="text-sm text-ink-3">{t("clubadmin.compliance.none")}</p>}
          <ul className="divide-y divide-line text-sm">
            {certs.map((c) => {
              const st = certState(c, today);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{kindLabel(c.kind)}{c.title ? ` · ${c.title}` : ""}
                    <span className="block text-xs text-ink-3">{c.valid_until ? t("clubadmin.compliance.validUntilDate", { date: f.date(c.valid_until) }) : t("clubadmin.compliance.noExpiry")}</span></span>
                  <span className="flex items-center gap-2">
                    <Badge tone={certTone(st)}>{t.dynamic(`clubadmin.compliance.states.${st}`, undefined, st)}</Badge>
                    <CertificateActions id={c.id} status={c.status} hasFile={!!c.file_path} admin={false} />
                  </span>
                </li>
              );
            })}
          </ul>
          <details>
            <summary className="cursor-pointer text-sm text-maroon">{t("clubadmin.compliance.add")}</summary>
            <div className="pt-3">
              <CertificateForm initial={{ id: null, coachId: coach.id, kind: "first_aid", title: "", reference: "", issuedOn: "", validUntil: "", notes: "" }} />
            </div>
          </details>
        </CardBody>
      </Card>
    </div>
  );
}
