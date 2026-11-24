import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getFamilyApplications, getMyChildren, getSelectionSetup } from "@/lib/selection/data";
import { todayIn } from "@/lib/payments/plans";
import { FamilyApplicationCard, ParentApplyForm } from "@/components/selection/family";
import { getParticipantChoices } from "@/lib/participants/server";
import { getActiveAthleteState } from "@/lib/participants/my-athletes";
import { ALL_ATHLETES } from "@/lib/participants/active-athlete";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("selection.family.title") };
}

/** Parent app: one selection programme — the family's applications (status, package, payment) and a two-tap application. */
export default async function ParentProgrammePage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !/^[0-9a-f-]{36}$/i.test(programId)) notFound();
  const setup = await getSelectionSetup(me.orgId, programId);
  if (!setup || !setup.program.selectionEnabled) notFound();
  const [kids, choices, state] = await Promise.all([
    getMyChildren(me.id, me.orgId),
    getParticipantChoices({ id: me.id, orgId: me.orgId, fullName: me.fullName ?? null }),
    getActiveAthleteState(),
  ]);
  const active = state.active && state.active !== ALL_ATHLETES ? state.active : null;
  const apps = await getFamilyApplications(me.orgId, Array.from(new Set(kids.map((k) => k.familyId))), programId);
  if (!setup.program.open && apps.length === 0) notFound();
  const p = setup.program;
  const currency = p.currency ?? f.currency;
  const today = todayIn(f.timeZone);
  const packages = setup.packages.filter((x) => x.isActive);
  const divName = new Map(setup.divisions.map((d) => [d.id, d.name]));
  const pkgName = new Map(setup.packages.map((x) => [x.id, x.name]));
  const live = apps.filter((a) => a.status !== "declined" && a.status !== "withdrawn").map((a) => a.athleteId);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/parent/programmes" className="hover:underline">{t("selection.family.title")}</Link>} title={p.name}
        description={p.requiresApproval ? t("selection.family.approvalNote") : undefined} />
      {p.description && <p className="max-w-2xl whitespace-pre-wrap text-sm text-text-muted">{p.description}</p>}
      {apps.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-lg text-text">{t("selection.family.myApplications")}</h2>
          {apps.map((a) => (
            <FamilyApplicationCard key={a.id} today={today} packages={packages.length ? packages : setup.packages}
              app={{
                id: a.id, status: a.status, athleteName: a.athleteName, divisionName: a.divisionId ? divName.get(a.divisionId) ?? null : null,
                packageId: a.packageId, packageName: a.packageId ? pkgName.get(a.packageId) ?? null : null, decisionNote: a.decisionNote,
                invoiceId: a.invoiceId, invoiceStatus: a.invoiceStatus, currency: a.currency ?? currency, amountDue: a.amountDue, paid: a.paid,
                hasPlan: a.hasPlan, installmentCount: a.installmentCount,
              }} />
          ))}
        </section>
      )}
      {p.open && packages.length > 0 && (
        <ParentApplyForm programId={p.id} kids={kids} divisions={setup.divisions} packages={packages} currency={currency} today={today} appliedIds={live}
          choices={{ participants: choices.participants.filter((x) => x.kind === "child"), self: choices.self }} active={active} />
      )}
    </div>
  );
}
