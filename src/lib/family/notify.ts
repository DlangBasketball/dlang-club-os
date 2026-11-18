import "server-only";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";
import { logError } from "@/lib/log";
import { appFor, type MessagingApp } from "@/lib/messaging/paths";
import type { MessagingRole } from "@/lib/messaging/permissions";
import { parseChannels, resolveDelivery, type NotificationCategory } from "@/lib/messaging/preferences";
import { deliverPush } from "@/lib/push/send";
import { familyAdminDb } from "./db";

/**
 * In-app notification + Web Push for family features (event changes,
 * carpool matches, payment notices, privacy requests). Translated per
 * recipient, respecting their per-category switches and quiet hours.
 * Recipients must be members of the org. Service role, server only, always
 * filtered by org_id. Never throws.
 */
export type NotifyBuild = (ctx: { t: Translator; f: Formatter; app: MessagingApp }) => { title: string; body?: string | null; path: string };

type NotifType = "practice" | "payment" | "system" | "other";

export async function notifyMembers(opts: {
  orgId: string;
  profileIds: string[];
  category: NotificationCategory;
  type: NotifType;
  urgent?: boolean;
  /** Force the app the links open in (e.g. "parent" for guardian notices). */
  app?: MessagingApp;
  tag?: string;
  build: NotifyBuild;
}): Promise<{ inApp: number; push: number }> {
  const ids = Array.from(new Set(opts.profileIds.filter(Boolean)));
  if (!ids.length) return { inApp: 0, push: 0 };
  try {
    const db = familyAdminDb();
    const [{ data: members }, { data: roles }, { data: profs }, { data: prefs }, { data: settings }, { data: orgRow }] = await Promise.all([
      db.from("org_memberships").select("profile_id").eq("org_id", opts.orgId).eq("status", "active").in("profile_id", ids),
      db.from("staff_roles").select("profile_id,role").eq("org_id", opts.orgId).in("profile_id", ids),
      db.from("profiles").select("id,locale,locale_set_at,is_active").in("id", ids),
      db.from("notification_preferences").select("profile_id,channels,quiet_start,quiet_end").in("profile_id", ids),
      db.from("messaging_settings").select("quiet_start,quiet_end").eq("org_id", opts.orgId).maybeSingle(),
      db.from("organizations").select("default_locale,country,currency,timezone").eq("id", opts.orgId).maybeSingle(),
    ]);
    const memberIds = new Set((members ?? []).map((m) => m.profile_id));
    const roleMap = new Map<string, MessagingRole[]>();
    for (const r of roles ?? []) roleMap.set(r.profile_id, [...(roleMap.get(r.profile_id) ?? []), r.role as MessagingRole]);
    const prefMap = new Map((prefs ?? []).map((p) => [p.profile_id, p]));
    const org = await getOrgEmailContext(opts.orgId);
    const o = orgRow as { default_locale: string | null; country: string | null; currency: string | null; timezone: string | null } | null;
    const now = new Date();
    type P = { id: string; locale: string | null; locale_set_at?: string | null; is_active: boolean };

    let inApp = 0;
    const pushes: { profileId: string; title: string; body: string | null; path: string; urgent?: boolean; tag?: string }[] = [];
    for (const p of (profs ?? []) as unknown as P[]) {
      if (!p.is_active || !memberIds.has(p.id)) continue;
      const pref = prefMap.get(p.id);
      const d = resolveDelivery({
        category: opts.category,
        prefs: parseChannels(pref?.channels),
        quiet: pref ? { start: pref.quiet_start, end: pref.quiet_end } : null,
        orgQuiet: settings ? { start: settings.quiet_start, end: settings.quiet_end } : null,
        now,
        timeZone: org.f.timeZone,
        urgent: opts.urgent,
      });
      const { t, f } = getStandaloneI18n({
        locale: (p.locale_set_at ? p.locale : null) ?? o?.default_locale ?? null,
        country: o?.country, currency: o?.currency, timeZone: o?.timezone,
      });
      const app = opts.app ?? appFor(roleMap.get(p.id) ?? ["parent"]);
      const built = opts.build({ t, f, app });
      if (d.inApp) {
        const { error } = await db.from("notifications").insert({
          org_id: opts.orgId, recipient_id: p.id, type: opts.type,
          title: built.title.slice(0, 200), body: built.body?.slice(0, 500) ?? null, link: built.path,
        });
        if (error) logError("family.notify.inApp", error);
        else inApp += 1;
      }
      if (d.push) pushes.push({ profileId: p.id, title: built.title, body: built.body ?? null, path: built.path, urgent: opts.urgent, tag: opts.tag });
    }
    const push = await deliverPush(opts.orgId, pushes);
    return { inApp, push };
  } catch (e) {
    logError("family.notify", e);
    return { inApp: 0, push: 0 };
  }
}

/** Push only (the caller already wrote the in-app notification). */
export async function pushOnly(opts: {
  orgId: string; profileIds: string[]; category: NotificationCategory; urgent?: boolean; tag?: string;
  title: string; body?: string | null; path: string;
}): Promise<number> {
  try {
    const db = familyAdminDb();
    const ids = Array.from(new Set(opts.profileIds.filter(Boolean)));
    if (!ids.length) return 0;
    const [{ data: prefs }, { data: settings }] = await Promise.all([
      db.from("notification_preferences").select("profile_id,channels,quiet_start,quiet_end").in("profile_id", ids),
      db.from("messaging_settings").select("quiet_start,quiet_end").eq("org_id", opts.orgId).maybeSingle(),
    ]);
    const org = await getOrgEmailContext(opts.orgId);
    const { pushAllowedFor } = await import("@/lib/push/payload");
    const allowed = pushAllowedFor({
      profileIds: ids, category: opts.category, prefs: prefs ?? [],
      orgQuiet: settings ? { start: settings.quiet_start, end: settings.quiet_end } : null,
      timeZone: org.f.timeZone, now: new Date(), urgent: opts.urgent,
    });
    return await deliverPush(opts.orgId, allowed.map((profileId) => ({ profileId, title: opts.title, body: opts.body, path: opts.path, urgent: opts.urgent, tag: opts.tag })));
  } catch (e) {
    logError("family.pushOnly", e);
    return 0;
  }
}

/** Event cancelled / postponed / moved: tell the roster's guardians and the team's coaches. */
export async function notifyEventChange(orgId: string, eventIds: string[], kind: "cancelled" | "postponed" | "changed"): Promise<void> {
  try {
    const db = familyAdminDb();
    const { data: events } = await db.from("events").select("id,team_id,title,type,starts_at,status").eq("org_id", orgId).in("id", eventIds);
    for (const e of events ?? []) {
      const athleteIds = new Set<string>();
      const coachProfiles: string[] = [];
      if (e.team_id) {
        const [{ data: roster }, { data: tc }] = await Promise.all([
          db.from("team_memberships").select("athlete_id,status").eq("org_id", orgId).eq("team_id", e.team_id).neq("status", "inactive"),
          db.from("team_coaches").select("coach_id").eq("org_id", orgId).eq("team_id", e.team_id),
        ]);
        for (const r of roster ?? []) athleteIds.add(r.athlete_id);
        const coachIds = (tc ?? []).map((c) => c.coach_id);
        if (coachIds.length) {
          const { data: coaches } = await db.from("coaches").select("profile_id").eq("org_id", orgId).in("id", coachIds);
          for (const c of coaches ?? []) if (c.profile_id) coachProfiles.push(c.profile_id);
        }
      } else {
        const { data: rsvps } = await db.from("event_rsvps").select("athlete_id").eq("org_id", orgId).eq("event_id", e.id);
        for (const r of rsvps ?? []) athleteIds.add(r.athlete_id);
      }
      const guardianIds: string[] = [];
      if (athleteIds.size) {
        const { data: ath } = await db.from("athletes").select("family_id").eq("org_id", orgId).in("id", Array.from(athleteIds));
        const famIds = Array.from(new Set((ath ?? []).map((a) => a.family_id)));
        if (famIds.length) {
          const { data: fm } = await db.from("family_members").select("profile_id").in("family_id", famIds);
          for (const m of fm ?? []) guardianIds.push(m.profile_id);
        }
      }
      const build: NotifyBuild = ({ t, f, app }) => ({
        title: t.dynamic(`family.push.event.${kind}.title`, { name: e.title ?? t.dynamic(`family.push.event.types.${e.type}`, {}, e.type) }),
        body: t.dynamic(`family.push.event.${kind}.body`, { date: f.dateTime(e.starts_at) }),
        path: app === "parent" ? "/parent/schedule" : app === "coach" ? "/coach/schedule" : `/admin/schedule/${e.id}`,
      });
      await notifyMembers({ orgId, profileIds: guardianIds, category: "events", type: "practice", app: "parent", tag: `event-${e.id}`, urgent: kind === "cancelled", build });
      await notifyMembers({ orgId, profileIds: coachProfiles, category: "events", type: "practice", app: "coach", tag: `event-${e.id}`, build });
    }
  } catch (err) {
    logError("family.notifyEventChange", err);
  }
}
