import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldQuestion } from "lucide-react";
import { Badge, Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { ApprovalDecision } from "@/components/camps/approval-decision";
import { getSessionUser } from "@/lib/auth/get-user";
import { listApprovalQueue } from "@/lib/camps/approval-data";
import { displayAnswer } from "@/lib/forms/logic";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("camps.approval.admin.title") };
}

/**
 * Camps → Pending approval: camp registrations of children in a camp's age
 * approval band. Admins only (finance cannot decide; the queue shows form
 * answers and consents, no medical data).
 */
export default async function CampApprovalsPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const items = await listApprovalQueue(me.orgId);
  const labels = { yes: t("common.yes"), no: t("common.no"), accepted: t("forms.view.accepted") };

  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader title={t("camps.approval.admin.title")} description={t("camps.approval.admin.description")}
        actions={<Badge tone="info">{t("camps.approval.admin.count", { count: items.length })}</Badge>} />
      {items.length === 0 ? <EmptyState icon={<ShieldQuestion className="h-5 w-5" />} title={t("camps.approval.admin.empty")} /> : (
        <div className="space-y-4">
          {items.map((r) => {
            const full = r.edition.capacity !== null && r.edition.taken >= r.edition.capacity;
            return (
              <Card key={r.id}><CardBody className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/athletes/${r.athleteId}`} className="text-base font-semibold text-ink hover:text-maroon">{r.athleteName}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-2">
                      <Badge tone="info">{t("camps.approval.status.pending_approval")}</Badge>
                      {r.ageOnStart !== null && <span>{t("camps.approval.admin.ageOnStart", { age: r.ageOnStart })}</span>}
                      {r.submittedAt && <span className="text-xs text-ink-3">{t("camps.approval.admin.submittedOn", { date: f.dateTime(r.submittedAt) })}</span>}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <Link href={`/admin/programs/${r.programId}/editions/${r.edition.id}`} className="font-medium text-ink hover:text-maroon">
                      {r.programName} · {r.edition.name || f.dateRange(r.edition.startsOn, r.edition.endsOn)}
                    </Link>
                    <div className="text-xs text-ink-3">{f.dateRange(r.edition.startsOn, r.edition.endsOn)}</div>
                    <div className={`text-xs ${full ? "text-warning" : "text-ink-3"}`}>
                      {r.edition.capacity !== null
                        ? t("camps.approval.admin.capacity", { taken: r.edition.taken, capacity: r.edition.capacity })
                        : t("camps.approval.admin.noCapacity", { taken: r.edition.taken })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <section className="space-y-1 text-sm">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t("camps.approval.admin.parentContact")}</h3>
                    {r.family.name && <div className="text-ink">{r.family.name}</div>}
                    {r.submittedBy?.name && <div className="text-ink-2">{t("camps.approval.admin.submittedBy", { name: r.submittedBy.name })}</div>}
                    {(r.submittedBy?.email ?? r.family.email) && <div><a className="text-maroon hover:underline" href={`mailto:${r.submittedBy?.email ?? r.family.email}`}>{r.submittedBy?.email ?? r.family.email}</a></div>}
                    {r.family.phone && <div className="tnum text-ink-2">{r.family.phone}</div>}
                  </section>
                  <section className="space-y-1 text-sm">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t("camps.approval.admin.choices")}</h3>
                    {r.ageGroup && <div className="text-ink-2">{t("camps.register.ageGroup")}: {r.ageGroup}</div>}
                    {r.optionLabel && <div className="text-ink-2">{r.optionLabel}{r.amount !== null && r.currency ? ` · ${f.money(r.amount, r.currency)}` : ""}</div>}
                    {r.days.length > 0 && <div className="text-xs text-ink-3">{r.days.map((d) => f.date(d, { weekday: true, style: "short" })).join(", ")}</div>}
                  </section>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <section className="space-y-1 text-sm">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t("camps.approval.admin.answers")}</h3>
                    {r.answers.length === 0 ? <p className="text-ink-3">{t("forms.regForm.noAnswers")}</p> : (
                      <dl className="space-y-1">
                        {r.answers.map((a) => (
                          <div key={a.field.id}><dt className="text-xs text-ink-3">{a.label}</dt>
                            <dd className="whitespace-pre-wrap text-ink">{a.field.type === "date" && typeof a.value === "string" ? f.date(a.value) : displayAnswer(a.field, a.value, labels)}</dd></div>
                        ))}
                      </dl>
                    )}
                  </section>
                  <section className="space-y-1 text-sm">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{t("camps.approval.admin.consents")}</h3>
                    {r.consents.length === 0 ? <p className="text-ink-3">{t("camps.approval.admin.noConsents")}</p> : (
                      <ul className="space-y-0.5">
                        {r.consents.map((c, i) => <li key={i} className="text-ink-2">{t("camps.approval.admin.consentLine", { title: c.title, version: c.version, date: f.date(c.acceptedAt) })}</li>)}
                      </ul>
                    )}
                  </section>
                </div>

                <div className="border-t border-line-soft pt-3">
                  {full && <p className="mb-2 text-xs text-warning">{t("camps.approval.admin.fullHint")}</p>}
                  <ApprovalDecision registrationId={r.id} />
                </div>
              </CardBody></Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
