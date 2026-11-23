import type { BookingNotificationKind, RecipientKind } from "./types";

/*
 * Booking notifications — delivery logic without I/O (unit-tested). The
 * server wiring (./notify.ts) claims queued rows with the service role,
 * renders them through the shared notification dispatcher and records the
 * outcome per recipient row (booking_notifications).
 *
 * Outcome per row:
 *   - no profile and no e-mail                      -> no_contact
 *   - in-app delivered, or the e-mail was accepted  -> sent (an e-mail error
 *     next to a delivered in-app notice is kept in last_error)
 *   - nothing delivered                             -> failed (retried by the
 *     next run until NOTIFICATION_MAX_ATTEMPTS, then listed for follow-up)
 */
export type ClaimedBookingNotification = {
  id: string; orgId: string; bookingId: string; kind: BookingNotificationKind; recipientKind: RecipientKind;
  recipientProfileId: string | null; recipientEmail: string | null; recipientName: string | null; attempts: number;
  serviceName: string; coachName: string | null; athleteFirstName: string; startsAt: string; endsAt: string | null;
  previousStartsAt: string | null; locationName: string | null; timeZone: string;
};

export type BookingTemplate = "booking_confirmation" | "booking_rescheduled" | "booking_cancellation";

export type BookingMessage = {
  template: BookingTemplate;
  recipientProfileId: string | null;
  toEmail: string | null;
  vars: {
    parent_name?: string; athlete_name: string; service_name: string; coach_name?: string; starts_at: string;
    previous_starts_at?: string; portal_path?: string; has_account: boolean;
  };
};

export type SendOutcome = { notificationId: string | null; emailLogId: string | null; emailAttempted: boolean; emailOk: boolean; error?: string | null };
export type RecordStatus = "sent" | "failed" | "no_contact";

export interface BookingNotificationStore {
  claim(limit: number, orgId?: string | null, bookingId?: string | null): Promise<ClaimedBookingNotification[]>;
  record(id: string, status: RecordStatus, error: string | null, notificationId: string | null, emailLogId: string | null): Promise<void>;
}
export interface BookingTransport {
  send(msg: BookingMessage, row: ClaimedBookingNotification): Promise<SendOutcome>;
}

export function templateFor(kind: BookingNotificationKind): BookingTemplate {
  return kind === "confirmed" ? "booking_confirmation" : kind === "rescheduled" ? "booking_rescheduled" : "booking_cancellation";
}

/**
 * Where the message links: the coach's trainings, the player's bookings, the
 * guardian's booking detail (a payer login only gets the bookings list: the
 * booking may belong to another family); nothing without an account.
 */
export function portalPathFor(kind: RecipientKind, hasAccount: boolean, bookingId?: string | null): string | undefined {
  if (!hasAccount) return undefined;
  if (kind === "coach") return "/coach/trainings";
  if (kind === "player") return "/player/bookings";
  if (kind === "guardian" && bookingId) return `/parent/bookings/${bookingId}`;
  return "/parent/bookings";
}

export function buildMessage(row: ClaimedBookingNotification): BookingMessage | null {
  if (!row.recipientProfileId && !row.recipientEmail) return null;
  const hasAccount = Boolean(row.recipientProfileId);
  return {
    template: templateFor(row.kind),
    recipientProfileId: row.recipientProfileId,
    toEmail: row.recipientEmail,
    vars: {
      ...(row.recipientName && row.recipientKind !== "coach" ? { parent_name: row.recipientName } : {}),
      athlete_name: row.athleteFirstName,
      service_name: row.serviceName,
      ...(row.coachName ? { coach_name: row.coachName } : {}),
      starts_at: row.startsAt,
      ...(row.kind === "rescheduled" && row.previousStartsAt ? { previous_starts_at: row.previousStartsAt } : {}),
      ...(portalPathFor(row.recipientKind, hasAccount, row.bookingId) ? { portal_path: portalPathFor(row.recipientKind, hasAccount, row.bookingId) } : {}),
      has_account: hasAccount,
    },
  };
}

export function outcomeStatus(o: SendOutcome): { status: RecordStatus; error: string | null } {
  if (o.notificationId || o.emailOk) return { status: "sent", error: o.emailAttempted && !o.emailOk ? o.error ?? "email_failed" : null };
  return { status: "failed", error: o.error ?? (o.emailAttempted ? "email_failed" : "not_delivered") };
}

export type BookingDispatchSummary = { claimed: number; sent: number; failed: number; noContact: number };

export async function runBookingDispatch(
  store: BookingNotificationStore, transport: BookingTransport,
  opts: { limit?: number; orgId?: string | null; bookingId?: string | null } = {},
): Promise<BookingDispatchSummary> {
  const rows = await store.claim(opts.limit ?? 50, opts.orgId ?? null, opts.bookingId ?? null);
  const summary: BookingDispatchSummary = { claimed: rows.length, sent: 0, failed: 0, noContact: 0 };
  for (const row of rows) {
    const msg = buildMessage(row);
    if (!msg) {
      await store.record(row.id, "no_contact", null, null, null);
      summary.noContact += 1;
      continue;
    }
    let outcome: SendOutcome;
    try {
      outcome = await transport.send(msg, row);
    } catch (e) {
      outcome = { notificationId: null, emailLogId: null, emailAttempted: Boolean(msg.toEmail), emailOk: false, error: e instanceof Error ? e.message : "send_failed" };
    }
    const { status, error } = outcomeStatus(outcome);
    await store.record(row.id, status, error ? error.slice(0, 500) : null, outcome.notificationId, outcome.emailLogId);
    if (status === "sent") summary.sent += 1; else summary.failed += 1;
  }
  return summary;
}
