import { z } from "zod";

/**
 * Notification preferences: per user, per category, in-app and email.
 * Stored in public.notification_preferences (own row only, RLS). Resolution
 * order for one delivery:
 *   1. category default (everything on)
 *   2. the user's saved switch for that category
 *   3. in-app for messages is always on (the message board is the record)
 *   4. email off when the club disabled message emails (messages category)
 *   5. email suppressed during quiet hours (the user's, else the club's),
 *      except for urgent alerts; the in-app notification still appears
 */

export const NOTIFICATION_CATEGORIES = ["messages", "alerts", "leads", "announcements"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export type ChannelSwitch = { in_app?: boolean; email?: boolean };
export type ChannelPrefs = Partial<Record<NotificationCategory, ChannelSwitch>>;

/** Categories whose in-app channel cannot be turned off. */
export const IN_APP_LOCKED: readonly NotificationCategory[] = ["messages"];

export const DEFAULT_PREFS: Record<NotificationCategory, { inApp: boolean; email: boolean }> = {
  messages: { inApp: true, email: true },
  alerts: { inApp: true, email: true },
  leads: { inApp: true, email: true },
  announcements: { inApp: true, email: true },
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const preferencesSchema = z
  .object({
    channels: z.record(z.enum(NOTIFICATION_CATEGORIES), z.object({ in_app: z.boolean(), email: z.boolean() })),
    quietStart: hhmm.nullable(),
    quietEnd: hhmm.nullable(),
  })
  .refine((v) => (v.quietStart === null) === (v.quietEnd === null) && (v.quietStart === null || v.quietStart !== v.quietEnd), {
    path: ["quietEnd"],
  });
export type PreferencesInput = z.input<typeof preferencesSchema>;

/** Parse the jsonb column defensively (unknown keys and non-booleans dropped). */
export function parseChannels(raw: unknown): ChannelPrefs {
  const out: ChannelPrefs = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const c of NOTIFICATION_CATEGORIES) {
    const v = (raw as Record<string, unknown>)[c];
    if (!v || typeof v !== "object") continue;
    const s: ChannelSwitch = {};
    const r = v as Record<string, unknown>;
    if (typeof r.in_app === "boolean") s.in_app = r.in_app;
    if (typeof r.email === "boolean") s.email = r.email;
    out[c] = s;
  }
  return out;
}

/** "HH:MM[:SS]" -> minutes after midnight, or null. */
export function toMinutes(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = /^(\d{2}):(\d{2})/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Minutes after midnight of `now` on the wall clock of `timeZone`. */
export function wallMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

/** Is `now` inside [start, end) in the club's time zone? Handles overnight windows (22:00-07:00). */
export function inQuietHours(now: Date, timeZone: string, start: string | null | undefined, end: string | null | undefined): boolean {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null || s === e) return false;
  const n = wallMinutes(now, timeZone);
  return s < e ? n >= s && n < e : n >= s || n < e;
}

export type DeliveryInput = {
  category: NotificationCategory;
  prefs?: ChannelPrefs | null;
  /** The user's quiet hours ("HH:MM"), if set. */
  quiet?: { start: string | null; end: string | null } | null;
  /** The club's default quiet hours. */
  orgQuiet?: { start: string | null; end: string | null } | null;
  /** Club switch for message emails (messaging_settings.email_notifications). */
  orgEmailEnabled?: boolean;
  /** Does the recipient have an email address at all? */
  hasEmail?: boolean;
  now: Date;
  timeZone: string;
  /** Urgent alerts ignore quiet hours. */
  urgent?: boolean;
};

export type Delivery = { inApp: boolean; email: boolean; quietHours: boolean };

export function resolveDelivery(d: DeliveryInput): Delivery {
  const def = DEFAULT_PREFS[d.category];
  const saved = d.prefs?.[d.category] ?? {};
  const inApp = IN_APP_LOCKED.includes(d.category) ? true : saved.in_app ?? def.inApp;
  let email = saved.email ?? def.email;
  if (d.hasEmail === false) email = false;
  if (d.category === "messages" && d.orgEmailEnabled === false) email = false;
  const window = d.quiet?.start && d.quiet?.end ? d.quiet : d.orgQuiet;
  const quietHours = !d.urgent && !!window && inQuietHours(d.now, d.timeZone, window.start, window.end);
  if (quietHours) email = false;
  return { inApp, email, quietHours };
}

/** Effective switches for the preferences form (defaults filled in, locks applied). */
export function effectiveChannels(prefs: ChannelPrefs | null | undefined): Record<NotificationCategory, { in_app: boolean; email: boolean }> {
  const out = {} as Record<NotificationCategory, { in_app: boolean; email: boolean }>;
  for (const c of NOTIFICATION_CATEGORIES) {
    const s = prefs?.[c] ?? {};
    out[c] = {
      in_app: IN_APP_LOCKED.includes(c) ? true : s.in_app ?? DEFAULT_PREFS[c].inApp,
      email: s.email ?? DEFAULT_PREFS[c].email,
    };
  }
  return out;
}
