import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { render, ENUM_FOR, type NotifType } from "@/lib/notifications/templates";
import { pushOnly } from "@/lib/family/notify";
import { parseChannels, resolveDelivery } from "@/lib/messaging/preferences";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";
import {
  runDispatcher, type AlertOutcome, type AlertStore, type AlertTransport, type ChannelResults, type ClaimedAlert, type RunSummary,
} from "./dispatcher";

/*
 * No-show alerts — server wiring of the dispatcher (service role, server
 * only, always scoped by the alert's org). Called
 *   (a) right after a sheet is finalized / corrected (org of the caller),
 *   (b) by the daily cron /api/attendance/cron for due and failed alerts.
 * Messages carry only the recipient's own child: first + last name, team,
 * session date/time in the club time zone, and a link to the parent portal
 * record ("request a correction"). Category "events" of the notification
 * preferences decides the channels (quiet hours respected).
 */

type ClaimRow = {
  alert_id: string; org_id: string; kind: "initial" | "correction"; mark_status: string; attempts: number; channel_results: Json;
  notification_id: string | null; guardian_profile_id: string; guardian_email: string | null; guardian_name: string | null;
  guardian_locale: string | null; receives_emails: boolean; event_id: string; athlete_id: string; athlete_first_name: string;
  athlete_last_name: string; team_name: string | null; event_type: string; starts_at: string; ends_at: string; timezone: string;
};

export function databaseStore(): AlertStore {
  const admin = createAdminClient();
  return {
    async createDue() {
      const { data, error } = await admin.rpc("attendance_due_alerts");
      if (error) throw new Error(error.message);
      return Number(data ?? 0);
    },
    async claim(limit, orgId) {
      const { data, error } = await admin.rpc("attendance_alerts_claim", { p_limit: limit, p_org: orgId ?? null });
      if (error) throw new Error(error.message);
      return ((data ?? []) as ClaimRow[]).map((r): ClaimedAlert => ({
        alertId: r.alert_id, orgId: r.org_id, kind: r.kind, markStatus: r.mark_status, attempts: r.attempts,
        channelResults: (r.channel_results ?? {}) as ChannelResults, notificationId: r.notification_id,
        guardianProfileId: r.guardian_profile_id, guardianEmail: r.guardian_email, guardianName: r.guardian_name,
        guardianLocale: r.guardian_locale, receivesEmails: r.receives_emails, eventId: r.event_id, athleteId: r.athlete_id,
        athleteFirstName: r.athlete_first_name, athleteLastName: r.athlete_last_name, teamName: r.team_name,
        eventType: r.event_type, startsAt: r.starts_at, endsAt: r.ends_at, timeZone: r.timezone,
      }));
    },
    async record(alertId, o: AlertOutcome) {
      const { error } = await admin.rpc("attendance_alert_record", {
        p_alert: alertId, p_status: o.status, p_channel_results: o.channels as Json, p_error: o.error, p_notification_id: o.notificationId,
      });
      if (error) logError("attendance.alerts.record", error);
    },
  };
}

const typeOf = (a: ClaimedAlert): NotifType => (a.kind === "correction" ? "attendance_no_show_correction" : "attendance_no_show");

async function rendered(a: ClaimedAlert) {
  const org = await getOrgEmailContext(a.orgId, a.guardianLocale);
  return {
    org,
    r: render(typeOf(a), {
      parent_name: a.guardianName ?? undefined,
      athlete_name: `${a.athleteFirstName} ${a.athleteLastName}`.trim(),
      team_name: a.teamName ?? undefined,
      starts_at: a.startsAt,
      event_id: a.eventId,
      athlete_id: a.athleteId,
      attendance_status: a.markStatus,
      club_name: org.clubName ?? undefined,
    }, { ...org.brand, timeZone: a.timeZone || org.f.timeZone, baseUrl: org.baseUrl }),
  };
}

export function liveTransport(): AlertTransport {
  const admin = createAdminClient();
  return {
    async wanted(a) {
      const [{ data: pref }, { data: settings }] = await Promise.all([
        admin.from("notification_preferences" as never).select("channels,quiet_start,quiet_end").eq("profile_id", a.guardianProfileId).eq("org_id", a.orgId).maybeSingle(),
        admin.from("messaging_settings" as never).select("quiet_start,quiet_end").eq("org_id", a.orgId).maybeSingle(),
      ]);
      const p = pref as { channels: unknown; quiet_start: string | null; quiet_end: string | null } | null;
      const s = settings as { quiet_start: string | null; quiet_end: string | null } | null;
      const d = resolveDelivery({
        category: "events",
        prefs: parseChannels(p?.channels),
        quiet: p ? { start: p.quiet_start, end: p.quiet_end } : null,
        orgQuiet: s ? { start: s.quiet_start, end: s.quiet_end } : null,
        hasEmail: Boolean(a.guardianEmail) && a.receivesEmails,
        now: new Date(),
        timeZone: a.timeZone || "UTC",
      });
      return { inApp: d.inApp, email: d.email, push: d.push };
    },
    async inApp(a) {
      const { r } = await rendered(a);
      const { data, error } = await admin.from("notifications")
        .insert({ org_id: a.orgId, recipient_id: a.guardianProfileId, type: ENUM_FOR[typeOf(a)], title: r.title.slice(0, 200), body: r.body.slice(0, 500), link: r.link ?? null })
        .select("id").single();
      if (error || !data) return { ok: false, error: error?.message ?? "insert failed" };
      return { ok: true, notificationId: (data as { id: string }).id };
    },
    async email(a) {
      if (!a.guardianEmail) return { ok: false, error: "no email" };
      const { r, org } = await rendered(a);
      const { data: log } = await admin.from("email_logs")
        .insert({ org_id: a.orgId, recipient_id: a.guardianProfileId, to_email: a.guardianEmail, subject: r.subject, template: typeOf(a), html: r.html, status: "queued", attempts: 0 })
        .select("id").single();
      const sent = await sendEmail({ to: a.guardianEmail, subject: r.subject, html: r.html, fromName: org.senderName ?? org.clubName });
      const logId = (log as { id: string } | null)?.id;
      if (logId) {
        await admin.from("email_logs").update({
          status: sent.ok ? "sent" : "failed", attempts: 1, error: sent.ok ? null : sent.error ?? "unknown",
          sent_at: sent.ok ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
        }).eq("id", logId);
      }
      return sent.ok ? { ok: true } : { ok: false, error: sent.error ?? "send failed" };
    },
    async push(a) {
      const { r } = await rendered(a);
      const count = await pushOnly({
        orgId: a.orgId, profileIds: [a.guardianProfileId], category: "events", title: r.title, body: r.body,
        path: r.link ?? "/parent/attendance", tag: `att-${a.eventId}-${a.athleteId}`,
      });
      return { ok: true, count };
    },
  };
}

/** Run the dispatcher; never throws (errors are logged). */
export async function runAttendanceAlerts(opts: { orgId?: string | null; limit?: number; createDue?: boolean } = {}): Promise<RunSummary> {
  try {
    return await runDispatcher(databaseStore(), liveTransport(), opts);
  } catch (e) {
    logError("attendance.alerts.run", e);
    return { created: 0, claimed: 0, sent: 0, failed: 0, noContact: 0 };
  }
}
