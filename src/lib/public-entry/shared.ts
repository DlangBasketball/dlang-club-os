/**
 * Public entry + guardian consent — pure helpers (client, server, unit tests).
 *
 * Entry points: "Book a camp", "Book personal training", "Join the club".
 * The sign-up page (/join) keeps the activity the visitor chose in a safe,
 * same-origin `next` path and returns there after authentication.
 */

export const ENTRY_INTENTS = ["camp", "training", "join"] as const;
export type EntryIntent = (typeof ENTRY_INTENTS)[number];

/** Where Workstream C's membership request lives (Join the club). */
export const MEMBERSHIP_REQUEST_PATH = "/parent/membership";

/** Guardian consent hold (hours) — mirrors public.gc_hold_hours(). */
export const CONSENT_HOLD_HOURS = 72;

export function parseIntent(v: string | null | undefined): EntryIntent {
  return (ENTRY_INTENTS as readonly string[]).includes(v ?? "") ? (v as EntryIntent) : "camp";
}

/**
 * Only same-origin absolute paths into the app or the public booking pages:
 * "/x", never "//host", "/\\host", a scheme, a control character, or more
 * than 512 characters.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.length > 512) return null;
  if (!/^\/(?![\/\\])/.test(next)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\\\u0000-\u001f\u007f]/.test(next)) return null;
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(next)) return null;
  return next;
}

/** Default destination after sign-up for an intent. */
export function intentDestination(intent: EntryIntent): string {
  switch (intent) {
    case "training":
      return "/parent/bookings/request";
    case "join":
      return MEMBERSHIP_REQUEST_PATH;
    default:
      return "/parent/camps";
  }
}

/** Public club slug shape (organizations.slug). */
export function safeSlug(v: string | null | undefined): string | null {
  return v && /^[a-z0-9][a-z0-9-]{0,62}$/.test(v) ? v : null;
}

/**
 * /join/complete?intent=…&next=…&club=… (the auth callback's `next`). The
 * club slug is only a hint for the platform host; the server resolves the
 * club from the host first and never from a client org id.
 */
export function completePath(intent: EntryIntent, next: string | null, club?: string | null): string {
  const qs = new URLSearchParams({ intent });
  const n = safeNext(next);
  if (n) qs.set("next", n);
  const s = safeSlug(club ?? null);
  if (s) qs.set("club", s);
  return `/join/complete?${qs.toString()}`;
}

/** /join link for an entry point (keeps the chosen activity). */
export function joinHref(intent: EntryIntent, next?: string | null): string {
  const qs = new URLSearchParams({ intent });
  const n = safeNext(next ?? null);
  if (n) qs.set("next", n);
  return `/join?${qs.toString()}`;
}

/** Error codes of the consent RPCs (consentRequest.errors.<CODE>). */
export const CONSENT_ERROR_CODES = [
  "NOT_AUTHENTICATED", "NOT_FOUND", "EXPIRED", "CONSENT_NOT_PENDING", "BOOKER_CANNOT_CONSENT", "NOT_GUARDIAN",
  "EMAIL_MISMATCH", "CONSENT_REQUIRED", "GUARDIAN_IS_BOOKER", "GUARDIAN_EMAIL_REQUIRED", "GUARDIAN_NAME_REQUIRED",
  "CONSENT_PENDING", "AGE_OUT_OF_RANGE", "EDITION_FULL", "ALREADY_REGISTERED", "MIXED_PARTICIPANTS", "CLUB_NOT_FOUND",
  "MEMBERSHIP_SUSPENDED", "CLUB_APPROVAL_REQUIRED",
] as const;
export type ConsentErrorCode = (typeof CONSENT_ERROR_CODES)[number];

export function consentErrorCode(message: string | null | undefined): ConsentErrorCode | null {
  const m = message ?? "";
  return (CONSENT_ERROR_CODES as readonly string[]).find((c) => new RegExp(`\\b${c}\\b`).test(m)) as ConsentErrorCode | undefined ?? null;
}

/** Item consent column -> next-step consent state (src/lib/status/next-step.ts). */
export function consentState(v: string | null | undefined): "pending" | "granted" | "declined" | "expired" | null {
  switch (v) {
    case "awaiting":
      return "pending";
    case "accepted":
      return "granted";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    default:
      return null;
  }
}

/** One row of booker_booking_status() — the only fields a booker ever sees. */
export type BookerStatusRow = {
  consent_request_id: string;
  kind: "camp" | "training";
  item_id: string;
  participant_name: string;
  activity: string;
  edition: string | null;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  consent: string | null;
  camp_approval: "pending" | "approved" | "declined" | "withdrawn" | null;
  consent_expires_at: string | null;
  invoice: { number: string; status: string; currency: string; total: number; balance: number } | null;
};

export const BOOKER_STATUS_KEYS = [
  "activity", "camp_approval", "consent", "consent_expires_at", "consent_request_id", "edition", "ends_at", "ends_on",
  "invoice", "item_id", "kind", "participant_name", "sort", "starts_at", "starts_on", "status",
] as const;

/** Keep only the whitelisted keys (defence in depth on top of the RPC). */
export function whitelistBookerRow(row: Record<string, unknown>): BookerStatusRow {
  const out: Record<string, unknown> = {};
  for (const k of BOOKER_STATUS_KEYS) if (k !== "sort") out[k] = row[k] ?? null;
  return out as BookerStatusRow;
}
