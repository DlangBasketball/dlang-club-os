import { parseChannels, resolveDelivery, type NotificationCategory } from "@/lib/messaging/preferences";

/**
 * Push payloads and preference filtering (pure, unit-tested).
 * A payload carries only a title, a short body and a same-origin path: never
 * contact details, medical data or the text of a sensitive message thread.
 */
export type PushMessage = { title: string; body?: string | null; path: string; tag?: string; urgent?: boolean };

export const PUSH_TITLE_MAX = 120;
export const PUSH_BODY_MAX = 240;
/** Push services accept ~4 KB; stay well below after encryption overhead. */
export const PUSH_PAYLOAD_MAX = 3000;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Only same-origin absolute paths ("/parent/..."); anything else falls back to "/". */
export function safePath(path: string): string {
  return /^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@/?%#]*$/.test(path) ? path : "/";
}

export function buildPushPayload(m: PushMessage): string {
  const out = {
    title: clip(m.title.trim(), PUSH_TITLE_MAX),
    body: m.body ? clip(m.body.trim(), PUSH_BODY_MAX) : "",
    url: safePath(m.path),
    tag: m.tag ? m.tag.replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 64) : undefined,
    urgent: m.urgent ? true : undefined,
  };
  let json = JSON.stringify(out);
  if (new TextEncoder().encode(json).length > PUSH_PAYLOAD_MAX) json = JSON.stringify({ ...out, body: "" });
  return json;
}

export type PrefRow = { profile_id: string; channels: unknown; quiet_start: string | null; quiet_end: string | null };

/**
 * Which recipients may get a push for this category right now: the user's
 * per-category push switch, then quiet hours (theirs, else the club's), with
 * urgent alerts going through.
 */
export function pushAllowedFor(opts: {
  profileIds: string[];
  category: NotificationCategory;
  prefs: PrefRow[];
  orgQuiet?: { start: string | null; end: string | null } | null;
  timeZone: string;
  now: Date;
  urgent?: boolean;
}): string[] {
  const byId = new Map(opts.prefs.map((p) => [p.profile_id, p]));
  return Array.from(new Set(opts.profileIds)).filter((id) => {
    const p = byId.get(id);
    const d = resolveDelivery({
      category: opts.category,
      prefs: parseChannels(p?.channels),
      quiet: p ? { start: p.quiet_start, end: p.quiet_end } : null,
      orgQuiet: opts.orgQuiet ?? null,
      now: opts.now,
      timeZone: opts.timeZone,
      urgent: opts.urgent,
    });
    return d.push;
  });
}
