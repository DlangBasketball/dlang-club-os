/**
 * Family-facing "next step" of any participation record (club request,
 * programme registration, camp week, training booking, membership).
 *
 * Pure and derived on read: callers pass the CURRENT state of the source
 * records (approval / consent / invoice / status), nothing is stored, so the
 * label stays right when any one step changes.
 *
 * Precedence (the first that applies wins):
 *   1. declined                     a club / camp decision, or a refused consent
 *   2. cancelled                    cancelled, withdrawn or expired
 *   3. awaiting_guardian_consent    another guardian still has to consent
 *   4. pending_club_approval        club review (information_requested while the
 *      information_requested        club waits for the family's answer)
 *   5. pending_camp_approval        camp age-band review
 *   6. awaiting_confirmation        a training request the coach has to confirm
 *   7. waitlisted
 *   8. awaiting_payment             an open invoice balance (> 0)
 *   9. confirmed
 */
export const NEXT_STEPS = [
  "declined",
  "cancelled",
  "awaiting_guardian_consent",
  "information_requested",
  "pending_club_approval",
  "pending_camp_approval",
  "awaiting_confirmation",
  "waitlisted",
  "awaiting_payment",
  "confirmed",
] as const;
export type NextStep = (typeof NEXT_STEPS)[number];

export type ClubApprovalState = "pending" | "info_requested" | "approved" | "declined" | "withdrawn";
export type CampApprovalState = "pending" | "approved" | "declined" | "withdrawn";
export type ConsentState = "pending" | "granted" | "declined" | "expired";

export type NextStepInput = {
  /**
   * Status of the source record: registration (pending, confirmed, waitlist,
   * cancelled, completed, pending_approval), booking (requested, booked,
   * completed, no_show, cancelled, declined, withdrawn), membership
   * (pending_payment, active, expired, cancelled) or a club request status.
   */
  status?: string | null;
  clubApproval?: ClubApprovalState | null;
  campApproval?: CampApprovalState | null;
  consent?: ConsentState | null;
  /** Open amount of the linked invoice(s); null / undefined = no invoice. */
  balance?: number | null;
};

const CANCELLED = new Set(["cancelled", "canceled", "withdrawn", "expired", "void"]);
const DECLINED = new Set(["declined", "rejected"]);

export function nextStep(i: NextStepInput): NextStep {
  const status = (i.status ?? "").toLowerCase();
  if (i.clubApproval === "declined" || i.campApproval === "declined" || i.consent === "declined" || DECLINED.has(status)) {
    return "declined";
  }
  if (i.clubApproval === "withdrawn" || i.campApproval === "withdrawn" || i.consent === "expired" || CANCELLED.has(status)) {
    return "cancelled";
  }
  if (i.consent === "pending") return "awaiting_guardian_consent";
  if (i.clubApproval === "info_requested" || status === "info_requested") return "information_requested";
  if (i.clubApproval === "pending") return "pending_club_approval";
  if (i.campApproval === "pending" || status === "pending_approval") return "pending_camp_approval";
  if (status === "requested") return "awaiting_confirmation";
  if (status === "waitlist" || status === "waitlisted") return "waitlisted";
  if ((i.balance ?? 0) > 0 || status === "pending_payment") return "awaiting_payment";
  // A registration still 'pending' without an open invoice waits for the club.
  if (status === "pending") return i.balance === null || i.balance === undefined ? "awaiting_confirmation" : "confirmed";
  return "confirmed";
}

/** Badge tone of a next step (theme tokens through the Badge component). */
export function nextStepTone(s: NextStep): "success" | "warning" | "danger" | "neutral" | "info" {
  switch (s) {
    case "confirmed":
      return "success";
    case "declined":
      return "danger";
    case "cancelled":
      return "neutral";
    case "awaiting_payment":
    case "information_requested":
    case "waitlisted":
      return "warning";
    default:
      return "info";
  }
}

/** Catalog key of the label ("nextStep.<step>"). */
export function nextStepKey(s: NextStep): `nextStep.${NextStep}` {
  return `nextStep.${s}`;
}

/** True when the participant counts as confirmed (on rosters, attendance). */
export function isConfirmedStep(s: NextStep): boolean {
  return s === "confirmed";
}
