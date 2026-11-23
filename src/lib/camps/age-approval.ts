/**
 * Camp age approval band — pure helpers (unit-tested in
 * tests/unit/camp-age-approval.test.ts). Mirrors the SQL functions of
 * migration 20250420105100_camp_age_approval.sql:
 *   camp_age_on_start(dob, starts_on)  -> campAgeOnStart()
 *   camp_age_band(age, min, max, band_min, band_max) -> campAgeBand()
 */
import { ageOn } from "./logic";

export type CampAgeBand = "standard" | "approval" | "too_young" | "too_old";

export type ApprovalBand = { min: number; max: number };

export type CampAgeRules = {
  minAge: number | null;
  maxAge: number | null;
  approvalAgeMin: number | null;
  approvalAgeMax: number | null;
};

/** Age in whole years on the camp week's first day (null when the date of birth is unknown). */
export function campAgeOnStart(dob: string | null | undefined, startsOn: string | null | undefined): number | null {
  if (!dob || !startsOn) return null;
  return ageOn(dob, startsOn);
}

/** Same cases, same order as public.camp_age_band(). */
export function campAgeBand(age: number | null, rules: CampAgeRules): CampAgeBand {
  if (age === null) return "standard";
  if (rules.maxAge !== null && age > rules.maxAge) return "too_old";
  if (rules.minAge === null || age >= rules.minAge) return "standard";
  if (rules.approvalAgeMin !== null && rules.approvalAgeMax !== null && age >= rules.approvalAgeMin && age <= rules.approvalAgeMax) return "approval";
  return "too_young";
}

/** The band of a camp, or null when the approval workflow is off. */
export function approvalBand(rules: Pick<CampAgeRules, "approvalAgeMin" | "approvalAgeMax">): ApprovalBand | null {
  if (rules.approvalAgeMin === null || rules.approvalAgeMax === null) return null;
  return { min: rules.approvalAgeMin, max: rules.approvalAgeMax };
}

/** Classifies one child for one camp week. */
export function classifyCamper(dob: string | null | undefined, startsOn: string | null | undefined, rules: CampAgeRules): { age: number | null; band: CampAgeBand } {
  const age = campAgeOnStart(dob, startsOn);
  return { age, band: campAgeBand(age, rules) };
}

/**
 * Admin settings: both empty (off) or both set, 0..99, min <= max and below
 * the camp's minimum age. Returns a message key under camps.approval.errors.
 */
export function validateApprovalBand(min: number | null, max: number | null, campMinAge: number | null): string | null {
  if (min === null && max === null) return null;
  if (min === null || max === null) return "camps.approval.errors.bothRequired";
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 99 || min > 99 || max < 0) return "camps.approval.errors.range";
  if (max < min) return "camps.approval.errors.order";
  if (campMinAge === null) return "camps.approval.errors.needsMinAge";
  if (max >= campMinAge) return "camps.approval.errors.belowMinAge";
  return null;
}

/** Message variables for "Children aged {min} and {max} can apply…" (one age -> the single form). */
export function bandMessage(band: ApprovalBand): { key: "camps.approval.parent.intro" | "camps.approval.parent.introOne" | "camps.approval.parent.introRange"; values: Record<string, number> } {
  if (band.min === band.max) return { key: "camps.approval.parent.introOne", values: { min: band.min } };
  if (band.max === band.min + 1) return { key: "camps.approval.parent.intro", values: { min: band.min, max: band.max } };
  return { key: "camps.approval.parent.introRange", values: { min: band.min, max: band.max } };
}

export type CampRegistrationState =
  | "pending_approval"
  | "approved_awaiting_payment"
  | "declined"
  | "withdrawn"
  | "pending"
  | "confirmed"
  | "waitlist"
  | "cancelled"
  | "completed";

/**
 * What a family / the admin roster shows for a camp registration: the
 * approval workflow states first, then the registration status.
 */
export function campRegistrationState(r: { status: string; approvalStatus: string | null }): CampRegistrationState {
  if (r.status === "pending_approval") return "pending_approval";
  if (r.approvalStatus === "declined") return "declined";
  if (r.approvalStatus === "withdrawn") return "withdrawn";
  if (r.approvalStatus === "approved" && r.status === "pending") return "approved_awaiting_payment";
  const known: CampRegistrationState[] = ["pending", "confirmed", "waitlist", "cancelled", "completed"];
  return (known as string[]).includes(r.status) ? (r.status as CampRegistrationState) : "pending";
}

/** Badge tone of a state (theme tokens via the Badge component). */
export function campStateTone(s: CampRegistrationState): "success" | "warning" | "danger" | "neutral" | "info" {
  switch (s) {
    case "confirmed":
    case "completed":
      return "success";
    case "pending_approval":
      return "info";
    case "approved_awaiting_payment":
    case "pending":
    case "waitlist":
      return "warning";
    case "declined":
      return "danger";
    default:
      return "neutral";
  }
}

/** Counters of one camp week: requests and payment holds apart from confirmed places. */
export function campEditionCounters(rows: { status: string; approvalStatus: string | null }[]): {
  confirmed: number; awaitingPayment: number; approvedAwaitingPayment: number; pendingApproval: number; holdingPlaces: number;
} {
  let confirmed = 0, awaitingPayment = 0, approvedAwaitingPayment = 0, pendingApproval = 0;
  for (const r of rows) {
    const s = campRegistrationState(r);
    if (s === "confirmed") confirmed += 1;
    else if (s === "pending") awaitingPayment += 1;
    else if (s === "approved_awaiting_payment") approvedAwaitingPayment += 1;
    else if (s === "pending_approval") pendingApproval += 1;
  }
  return { confirmed, awaitingPayment, approvedAwaitingPayment, pendingApproval, holdingPlaces: confirmed + awaitingPayment + approvedAwaitingPayment };
}
