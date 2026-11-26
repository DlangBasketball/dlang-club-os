import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { logError } from "@/lib/log";
import {
  runBookingDispatch, type BookingDispatchSummary, type BookingNotificationStore, type BookingTransport, type ClaimedBookingNotification,
} from "./dispatch-core";

/*
 * Booking notifications — server wiring (service role, server only). Rows are
 * queued by the booking RPCs (bk_enqueue_notifications) in the same
 * transaction as the change; this sends them right after the action and on
 * retry. Each message carries only the recipient's own booking: the
 * athlete's first name, the service, the coach and the time in the club time
 * zone. No payer or money data.
 */
type ClaimRow = {
  id: string; org_id: string; booking_id: string; kind: ClaimedBookingNotification["kind"];
  recipient_kind: ClaimedBookingNotification["recipientKind"]; recipient_profile_id: string | null; recipient_email: string | null;
  recipient_name: string | null; attempts: number; service_name: string; coach_name: string | null; athlete_first_name: string;
  starts_at: string; ends_at: string | null; previous_starts_at: string | null; location_name: string | null; timezone: string;
  reason?: string | null;
};

export function bookingNotificationStore(): BookingNotificationStore {
  const admin = createAdminClient();
  return {
    async claim(limit, orgId, bookingId) {
      const { data, error } = await admin.rpc("booking_notifications_claim", { p_org: orgId ?? null, p_booking: bookingId ?? null, p_limit: limit });
      if (error) throw new Error(error.message);
      return ((data ?? []) as ClaimRow[]).map((r) => ({
        id: r.id, orgId: r.org_id, bookingId: r.booking_id, kind: r.kind, recipientKind: r.recipient_kind,
        recipientProfileId: r.recipient_profile_id, recipientEmail: r.recipient_email, recipientName: r.recipient_name,
        attempts: r.attempts, serviceName: r.service_name, coachName: r.coach_name, athleteFirstName: r.athlete_first_name,
        startsAt: r.starts_at, endsAt: r.ends_at, previousStartsAt: r.previous_starts_at, locationName: r.location_name, timeZone: r.timezone,
        reason: r.reason ?? null,
      }));
    },
    async record(id, status, error, notificationId, emailLogId) {
      const { error: e } = await admin.rpc("booking_notification_record", {
        p_id: id, p_status: status, p_error: error, p_notification: notificationId, p_email_log: emailLogId,
      });
      if (e) throw new Error(e.message);
    },
  };
}

export const bookingTransport: BookingTransport = {
  async send(msg, row) {
    const res = await dispatchNotification({
      orgId: row.orgId,
      type: msg.template,
      recipientProfileId: msg.recipientProfileId,
      toEmail: msg.toEmail,
      vars: msg.vars,
    });
    return { notificationId: res.notificationId, emailLogId: res.emailLogId, emailAttempted: Boolean(res.emailLogId), emailOk: res.emailOk };
  },
};

/** Send the queued notifications of one booking (or of the org). Never throws. */
export async function runBookingNotifications(opts: { orgId: string; bookingId?: string | null; limit?: number }): Promise<BookingDispatchSummary | null> {
  try {
    return await runBookingDispatch(bookingNotificationStore(), bookingTransport, opts);
  } catch (e) {
    logError("bookingWorkflow.notify", e);
    return null;
  }
}
