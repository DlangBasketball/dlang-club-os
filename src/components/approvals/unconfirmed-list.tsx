import { Card, CardBody, CardHeader, CardMeta, CardTitle, Badge } from "@/components/ui";
import type { UnconfirmedParticipant } from "@/lib/approvals/data";
import type { Translator } from "@/lib/i18n/translator";

const REASON_STEP: Record<string, string> = {
  pending_club_approval: "nextStep.pending_club_approval",
  information_requested: "nextStep.information_requested",
  pending_camp_approval: "nextStep.pending_camp_approval",
  awaiting_payment: "nextStep.awaiting_payment",
  awaiting_guardian_consent: "nextStep.awaiting_guardian_consent",
  pending: "nextStep.awaiting_confirmation",
};

/**
 * "Not yet confirmed" participants of a session (pending approval / awaiting
 * consent / awaiting payment): names and the reason only, never markable on
 * the attendance sheet.
 */
export function UnconfirmedList({ rows, t }: { rows: UnconfirmedParticipant[]; t: Translator }) {
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("approvals.roster.title", { count: rows.length })}</CardTitle>
          <CardMeta>{t("approvals.roster.hint")}</CardMeta>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <ul>
          {rows.map((r) => (
            <li key={`${r.athleteId}-${r.reason}`} className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5 text-sm last:border-0">
              <span className="text-text-secondary">{r.fullName}</span>
              <Badge tone={r.reason === "awaiting_payment" ? "warning" : "info"}>{t.dynamic(REASON_STEP[r.reason] ?? "nextStep.awaiting_confirmation")}</Badge>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
