import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { todayIn } from "@/lib/payments/plans";
import { createClient } from "@/lib/supabase/server";
import { getEnrollmentMoney, getRoster, getSeasonPrograms, getTournaments, seasonsOf } from "@/lib/selection/roster";
import { programDivisionLabel } from "@/lib/selection/arrangement";
import { EnrollmentForm } from "@/components/selection/roster/enrollment-form";
import { EnrollmentMoney, EnrollNowButton, WithdrawControls } from "@/components/selection/roster/enrollment-money";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("roster.record.title") };
}

/**
 * One enrolment: the same form as "Add player" (admin: everything; finance:
 * fee arrangement), the agreement and its payments (separate records) with
 * "Record payment", and withdrawal (keeps paid history).
 */
export default async function EnrollmentRecordPage({ params }: { params: Promise<{ programId: string; applicationId: string }> }) {
  const { programId, applicationId } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(programId) || !/^[0-9a-f-]{36}$/i.test(applicationId)) notFound();
  const isAdmin = me.roles.includes("admin");
  const isFinance = isAdmin || me.roles.includes("finance");

  const [roster, all] = await Promise.all([getRoster(programId), getSeasonPrograms(me.orgId)]);
  if (roster.error || all.error) return <ErrorState title={t("roster.loadFailedTitle")} message={t("roster.loadFailed")} />;
  const entry = roster.data.find((r) => r.id === applicationId);
  if (!entry) notFound();
  const seasons = seasonsOf(all.data, programId);
  const program = seasons.find((s) => s.id === programId);
  if (!program) notFound();

  const db = await createClient();
  const [{ data: ath }, tournaments, money] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name,dob,licence_category").eq("id", entry.athleteId).eq("org_id", me.orgId).maybeSingle(),
    getTournaments(me.orgId, seasons.map((s) => s.id)),
    entry.invoiceId && isFinance ? getEnrollmentMoney(entry.invoiceId) : Promise.resolve(null),
  ]);
  const today = todayIn(f.timeZone);
  const currency = entry.currency ?? program.currency ?? f.currency;
  const withdrawn = entry.status === "withdrawn";

  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader eyebrow={<Link href={`/admin/selection/${programId}?tab=players`} className="hover:underline">{program.name}</Link>}
        title={entry.name} description={programDivisionLabel(program.name, entry.divisionName)}
        actions={<Link href={`/admin/athletes/${entry.athleteId}`} className="text-sm text-brand-primary hover:underline">{t("roster.record.profile")}</Link>} />
      <div className="flex flex-wrap gap-2">
        <Badge tone={withdrawn ? "neutral" : entry.status === "enrolled" ? "success" : "info"}>{t.dynamic(`selection.statuses.${entry.status}`, undefined, entry.status)}</Badge>
        {entry.registrationOk === false && <Badge tone="warning">{t("roster.health.rowMissing")}</Badge>}
      </div>

      {entry.status === "accepted" && (
        <Card><CardBody className="space-y-2 text-sm">
          <h2 className="font-display text-lg text-text">{t("roster.record.nextSteps")}</h2>
          <p className="text-text-secondary">{t("roster.acceptedVsEnrolled")}</p>
          <ul className="list-disc pl-5 text-text-secondary">
            <li>{t("roster.record.stepArrangement")}</li>
            {isFinance && <li>{t("roster.record.stepPayment")}</li>}
            {isAdmin && <li>{t("roster.record.stepEnrollNow")}</li>}
          </ul>
          {isAdmin && <EnrollNowButton applicationId={entry.id} />}
        </CardBody></Card>
      )}

      {withdrawn && (
        <Card><CardBody className="space-y-1 text-sm">
          <p className="font-medium text-text">{t("roster.record.withdrawnOn", { date: entry.withdrawnAt ? f.date(entry.withdrawnAt) : "—" })}</p>
          {entry.withdrawalReason && <p className="text-text-secondary">{entry.withdrawalReason}</p>}
          {entry.balanceAtWithdrawal != null && <p className="text-text-secondary">{t("roster.record.balanceAtWithdrawal", { amount: f.money(entry.balanceAtWithdrawal, currency) })}</p>}
          <p className="text-xs text-text-muted">{t("roster.record.withdrawnHint")}</p>
        </CardBody></Card>
      )}

      {isFinance && (
        <Card><CardBody className="space-y-3">
          <h2 className="font-display text-lg text-text">{t("roster.record.payments")}</h2>
          {!entry.invoiceId ? <p className="text-sm text-text-muted">{t("roster.record.noAgreement")}</p>
            : money?.error ? <ErrorState compact title={t("roster.loadFailedTitle")} message={t("roster.loadFailed")} /> : (
            <EnrollmentMoney applicationId={entry.id} currency={currency} agreedFee={entry.agreedFee} amountDue={entry.amountDue}
              received={entry.received} balance={entry.balance} nextDueOn={entry.nextDueOn} overdueAmount={entry.overdueAmount}
              status={entry.paymentStatus} payments={money?.payments ?? []} installments={money?.installments ?? []} today={today}
              canRecord invoiceHref={`/admin/invoices/${entry.invoiceId}`} />
          )}
        </CardBody></Card>
      )}

      {!withdrawn && (
        <Card><CardBody>
          <h2 className="mb-3 font-display text-lg text-text">{t("roster.record.enrollment")}</h2>
          <EnrollmentForm
            mode={{ kind: "edit", initial: {
              applicationId: entry.id,
              athlete: { id: entry.athleteId, name: entry.name, dob: ath?.dob ?? null, licenceCategory: (ath as { licence_category?: string | null } | null)?.licence_category ?? null },
              programId, divisionId: entry.divisionId, packageId: entry.packageId,
              tournamentIds: entry.tournaments.filter((x) => x.status === "covered").map((x) => x.id),
              tournamentOverrideReason: entry.tournamentOverrideReason, kind: entry.arrangementKind, agreedFee: entry.agreedFee ?? entry.amountDue,
              monthlyAmount: entry.monthlyAmount, firstDueOn: entry.firstDueOn, status: entry.status, jerseyNumber: entry.jerseyNumber,
              staffNotes: entry.staffNotes, received: entry.received ?? 0, currency,
            } }}
            seasons={seasons} tournaments={tournaments.data} canEditDetails={isAdmin} canEditFee={isFinance} today={today}
            defaultProgramId={programId} manageTournamentsHref={isAdmin ? "/admin/selection/{id}?tab=setup#tournaments" : null}
            recordHref="/admin/selection/{program}/players/{application}" />
        </CardBody></Card>
      )}

      {isAdmin && !withdrawn && (
        <Card><CardBody className="space-y-2">
          <h2 className="font-display text-lg text-text">{t("roster.withdraw.section")}</h2>
          <p className="text-sm text-text-secondary">{t("roster.withdraw.sectionHint")}</p>
          <WithdrawControls applicationId={entry.id} balance={entry.balance} currency={currency} today={today}
            tournaments={entry.tournaments.map((x) => ({ id: x.id, name: x.name, status: x.status }))} />
        </CardBody></Card>
      )}

      {entry.tournaments.some((x) => x.status === "withdrawn") && (
        <Card><CardBody className="space-y-1 text-sm">
          <h2 className="font-display text-lg text-text">{t("roster.record.tournamentHistory")}</h2>
          <ul>
            {entry.tournaments.filter((x) => x.status === "withdrawn").map((x) => (
              <li key={x.id} className="text-text-secondary">{t("roster.record.tournamentWithdrawn", { name: x.name, date: x.withdrawnAt ? f.date(x.withdrawnAt) : "—" })}{x.note ? ` · ${x.note}` : ""}</li>
            ))}
          </ul>
        </CardBody></Card>
      )}
    </div>
  );
}
