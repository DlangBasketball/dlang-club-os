import Link from "next/link";
import { Medal } from "lucide-react";
import { Badge, Card, CardBody, ErrorState } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getAthleteEnrollments } from "@/lib/selection/roster";

const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral"> = { enrolled: "success", accepted: "info", waitlisted: "warning", withdrawn: "neutral" };
const PAY_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { paid: "success", partial: "warning", unpaid: "danger", none: "neutral" };

/**
 * "Programmes" card on an athlete profile: selection enrolments (current and
 * history) with age group, tournaments and status. The payment summary comes
 * only when the database says the caller may see it (finance, the athlete's
 * guardians); coaches see the enrolment without amounts.
 */
export async function AthleteProgrammesCard({ athleteId, recordHref }: { athleteId: string; recordHref?: (programId: string, applicationId: string) => string }) {
  const [{ t, f }, res] = await Promise.all([getI18n(), getAthleteEnrollments(athleteId)]);
  if (res.error) {
    return <ErrorState title={t("roster.card.title")} message={t("roster.card.loadFailed")} compact />;
  }
  if (!res.data.length) return null;
  return (
    <Card>
      <CardBody className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-lg text-text"><Medal className="h-4 w-4" /> {t("roster.card.title")}</h2>
        <ul className="divide-y divide-border">
          {res.data.map((e) => {
            const covered = e.tournaments.filter((x) => x.status === "covered");
            const cur = e.currency ?? f.currency;
            const head = recordHref
              ? <Link href={recordHref(e.programId, e.id)} className="font-medium text-text hover:underline">{e.label}</Link>
              : <span className="font-medium text-text">{e.label}</span>;
            return (
              <li key={e.id} className="space-y-1 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {head}
                  <span className="text-xs text-text-muted">{e.programName}</span>
                  <Badge tone={STATUS_TONE[e.status] ?? "neutral"}>{t.dynamic(`selection.statuses.${e.status}`, undefined, e.status)}</Badge>
                  {e.showMoney && e.paymentStatus && <Badge tone={PAY_TONE[e.paymentStatus] ?? "neutral"}>{t.dynamic(`roster.paymentStatus.${e.paymentStatus}`, undefined, e.paymentStatus)}</Badge>}
                  {e.showMoney && e.overdue && <Badge tone="danger" dot>{t("roster.overdue")}</Badge>}
                </div>
                <p className="text-text-secondary">
                  {t("roster.card.tournaments")}: {covered.length ? covered.map((x) => x.name).join(", ") : t("roster.tournamentsNotAssigned")}
                </p>
                {e.status === "withdrawn" && (
                  <p className="text-xs text-text-muted">{t("roster.card.withdrawn", { date: e.withdrawnAt ? f.date(e.withdrawnAt) : "—" })}{e.withdrawalReason ? ` · ${e.withdrawalReason}` : ""}</p>
                )}
                {e.showMoney && (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                    <div><dt className="text-text-muted">{t("roster.money.agreedFee")}</dt><dd className="tnum text-text">{e.agreedFee == null ? "—" : f.money(e.agreedFee, cur)}</dd></div>
                    <div><dt className="text-text-muted">{t("roster.money.received")}</dt><dd className="tnum text-text">{e.received == null ? "—" : f.money(e.received, cur)}</dd></div>
                    <div><dt className="text-text-muted">{t("roster.money.balance")}</dt><dd className="tnum text-text">{e.balance == null ? "—" : f.money(e.balance, cur)}</dd></div>
                    <div><dt className="text-text-muted">{t("roster.money.nextDue")}</dt><dd className="tnum text-text">{e.nextDueOn ? f.date(e.nextDueOn) : "—"}</dd></div>
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
