/**
 * No-show alert dispatcher — the delivery logic, with the store (database)
 * and transport (in-app / e-mail / push) injected so it is unit-testable.
 * The server wiring lives in ./alerts.ts.
 *
 * Idempotency, in layers:
 *   1. the database creates at most one alert per (event, athlete, guardian,
 *      kind) — unique indexes; re-finalizing / retrying never duplicates
 *   2. claim() hands an alert to one run only (row lock + 10 min claim)
 *   3. per channel: a channel that succeeded on an earlier attempt
 *      (channel_results.<channel>.ok) is never sent again on a retry; the
 *      in-app notification is reused through notification_id
 * Retries: a failed alert stays 'failed' with a back-off (5 min × attempts²)
 * until ALERT_MAX_ATTEMPTS; then it shows in the staff follow-up list.
 * No channel at all (in-app switched off, no e-mail, no device) -> 'no_contact'.
 */
export type ChannelName = "in_app" | "email" | "push";
export type ChannelResult = {
  ok: boolean; at?: string; error?: string; count?: number; notification_id?: string;
  /** E-mail provider id: a later bounce (webhook) is matched on it. */
  provider_id?: string;
};
export type ChannelResults = Partial<Record<ChannelName, ChannelResult>>;

export type ClaimedAlert = {
  alertId: string;
  orgId: string;
  kind: "initial" | "correction";
  markStatus: string;
  attempts: number;
  channelResults: ChannelResults;
  notificationId: string | null;
  /**
   * "guardian": a guardian login (in-app, e-mail, push by their preferences).
   * "family_email": no guardian login in the family; e-mail only, to the
   * family contact address (guardianProfileId null). See ./recipients.ts.
   */
  recipientKind: "guardian" | "family_email";
  guardianProfileId: string | null;
  /** The guardian's login e-mail, or the family contact address (family_email). */
  guardianEmail: string | null;
  guardianName: string | null;
  guardianLocale: string | null;
  receivesEmails: boolean;
  eventId: string;
  athleteId: string;
  athleteFirstName: string;
  athleteLastName: string;
  teamName: string | null;
  eventType: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
};

export type AlertOutcome = { status: "sent" | "failed" | "no_contact"; channels: ChannelResults; error: string | null; notificationId: string | null };

export interface AlertStore {
  /** Create the alerts of sessions that ended after being finalized. */
  createDue(): Promise<number>;
  claim(limit: number, orgId?: string | null): Promise<ClaimedAlert[]>;
  record(alertId: string, outcome: AlertOutcome): Promise<void>;
}

export type Wanted = { inApp: boolean; email: boolean; push: boolean };

export interface AlertTransport {
  /** Which channels the recipient wants for this alert (preferences, e-mail flag, quiet hours). */
  wanted(a: ClaimedAlert): Promise<Wanted>;
  inApp(a: ClaimedAlert): Promise<{ ok: boolean; notificationId?: string; error?: string }>;
  email(a: ClaimedAlert): Promise<{ ok: boolean; error?: string; providerId?: string }>;
  push(a: ClaimedAlert): Promise<{ ok: boolean; count: number; error?: string }>;
  now?(): Date;
}

/** Deliver one claimed alert; never throws. */
export async function deliverAlert(a: ClaimedAlert, t: AlertTransport): Promise<AlertOutcome> {
  const now = () => (t.now ? t.now() : new Date()).toISOString();
  const prior = a.channelResults ?? {};
  const channels: ChannelResults = { ...prior };
  let notificationId = a.notificationId ?? prior.in_app?.notification_id ?? null;
  let error: string | null = null;
  let wanted: Wanted;
  try {
    wanted = await t.wanted(a);
  } catch (e) {
    return { status: "failed", channels, error: msg(e), notificationId };
  }
  // An e-mail-only recipient has no login: no in-app notice, no device.
  if (a.recipientKind === "family_email") wanted = { inApp: false, email: wanted.email && Boolean(a.guardianEmail), push: false };
  const anyWanted = wanted.inApp || wanted.email || wanted.push;
  const anyEarlier = Object.values(prior).some((c) => c?.ok);
  if (!anyWanted && !anyEarlier) return { status: "no_contact", channels, error: null, notificationId };

  if (wanted.inApp && !prior.in_app?.ok && !notificationId) {
    try {
      const r = await t.inApp(a);
      channels.in_app = { ok: r.ok, at: now(), ...(r.notificationId ? { notification_id: r.notificationId } : {}), ...(r.error ? { error: r.error } : {}) };
      if (r.ok && r.notificationId) notificationId = r.notificationId;
      if (!r.ok) error ??= r.error ?? "in_app failed";
    } catch (e) {
      channels.in_app = { ok: false, at: now(), error: msg(e) };
      error ??= msg(e);
    }
  } else if (notificationId && !prior.in_app?.ok) {
    channels.in_app = { ok: true, at: prior.in_app?.at ?? now(), notification_id: notificationId };
  }

  if (wanted.email && !prior.email?.ok) {
    try {
      const r = await t.email(a);
      channels.email = { ok: r.ok, at: now(), ...(r.providerId ? { provider_id: r.providerId } : {}), ...(r.error ? { error: r.error } : {}) };
      if (!r.ok) error ??= r.error ?? "email failed";
    } catch (e) {
      channels.email = { ok: false, at: now(), error: msg(e) };
      error ??= msg(e);
    }
  }

  // Push is best effort: no registered device is not a failure.
  if (wanted.push && !prior.push?.ok) {
    try {
      const r = await t.push(a);
      channels.push = { ok: r.ok, count: r.count, at: now(), ...(r.error ? { error: r.error } : {}) };
    } catch (e) {
      channels.push = { ok: false, count: 0, at: now(), error: msg(e) };
    }
  }

  const failed = (wanted.inApp && !channels.in_app?.ok) || (wanted.email && !channels.email?.ok);
  const delivered = Object.values(channels).some((c) => c?.ok && (c.count === undefined || c.count > 0));
  if (failed) return { status: "failed", channels, error: (error ?? "delivery failed").slice(0, 500), notificationId };
  if (!delivered) return { status: "no_contact", channels, error: null, notificationId };
  return { status: "sent", channels, error: null, notificationId };
}

export type RunSummary = { created: number; claimed: number; sent: number; failed: number; noContact: number };

/** One dispatcher run: create due alerts, claim, deliver, record. */
export async function runDispatcher(store: AlertStore, transport: AlertTransport, opts: { limit?: number; orgId?: string | null; createDue?: boolean } = {}): Promise<RunSummary> {
  const summary: RunSummary = { created: 0, claimed: 0, sent: 0, failed: 0, noContact: 0 };
  if (opts.createDue !== false) {
    try {
      summary.created = await store.createDue();
    } catch {
      // A failure to create due alerts must not stop delivery of the others.
    }
  }
  const batch = await store.claim(opts.limit ?? 100, opts.orgId ?? null);
  summary.claimed = batch.length;
  for (const a of batch) {
    const outcome = await deliverAlert(a, transport);
    await store.record(a.alertId, outcome);
    if (outcome.status === "sent") summary.sent += 1;
    else if (outcome.status === "failed") summary.failed += 1;
    else summary.noContact += 1;
  }
  return summary;
}

function msg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}
