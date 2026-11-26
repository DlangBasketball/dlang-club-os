import "server-only";
import { getStandaloneI18n } from "@/lib/i18n/messages";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";
import { logError } from "@/lib/log";
import { opsAdminDb } from "./db";

/**
 * In-app notifications for the operations module (kit sizes requested,
 * equipment overdue, venue closures, sponsor renewals). Each recipient gets
 * the text in their own language (org default otherwise), with the club's
 * currency and time zone. Service role, always filtered by org_id; only
 * active profiles of that org receive anything. No personal data of other
 * people goes into the text beyond what the recipient already sees.
 */
export type Built = { title: string; body: string | null; link: string | null };

type Org = { country: string | null; currency: string | null; timezone: string | null; default_locale: string | null };

export async function notifyProfiles(
  orgId: string,
  profileIds: string[],
  build: (t: Translator, f: Formatter) => Built,
  type: "system" | "practice" | "payment" | "other" = "system",
): Promise<number> {
  const ids = Array.from(new Set(profileIds.filter(Boolean)));
  if (!ids.length) return 0;
  try {
    const db = opsAdminDb();
    const [{ data: org }, { data: profs }] = await Promise.all([
      db.from("organizations").select("country,currency,timezone,default_locale").eq("id", orgId).maybeSingle(),
      db.from("profiles").select("id,locale,locale_set_at,is_active").eq("org_id", orgId).in("id", ids),
    ]);
    const o = (org ?? {}) as Partial<Org>;
    type P = { id: string; locale: string | null; locale_set_at: string | null; is_active: boolean };
    const rows = ((profs ?? []) as unknown as P[]).filter((p) => p.is_active).map((p) => {
      const { t, f } = getStandaloneI18n({
        locale: p.locale_set_at ? p.locale : o.default_locale ?? null,
        country: o.country ?? null, currency: o.currency ?? null, timeZone: o.timezone ?? null,
      });
      const b = build(t, f);
      return { org_id: orgId, recipient_id: p.id, type, title: b.title.slice(0, 200), body: b.body, link: b.link };
    });
    if (!rows.length) return 0;
    const { error } = await db.from("notifications").insert(rows as never);
    if (error) {
      logError("operations.notify", error);
      return 0;
    }
    return rows.length;
  } catch (e) {
    logError("operations.notify", e);
    return 0;
  }
}

/** Profiles of the guardians of these athletes (same org). */
export async function guardianProfileIds(orgId: string, athleteIds: string[]): Promise<string[]> {
  if (!athleteIds.length) return [];
  const db = opsAdminDb();
  const { data: athletes } = await db.from("athletes").select("id,family_id").eq("org_id", orgId).in("id", athleteIds);
  const familyIds = Array.from(new Set((athletes ?? []).map((a) => a.family_id).filter(Boolean)));
  if (!familyIds.length) return [];
  const { data: members } = await db.from("family_members").select("profile_id").in("family_id", familyIds);
  return Array.from(new Set((members ?? []).map((m) => m.profile_id).filter((x): x is string => !!x)));
}

/** Profiles linked to these coaches (same org). */
export async function coachProfileIds(orgId: string, coachIds: string[]): Promise<string[]> {
  if (!coachIds.length) return [];
  const { data } = await opsAdminDb().from("coaches").select("profile_id").eq("org_id", orgId).in("id", coachIds);
  return Array.from(new Set((data ?? []).map((c) => c.profile_id).filter((x): x is string => !!x)));
}

/** Admin profiles of the org. */
export async function adminProfileIds(orgId: string): Promise<string[]> {
  const { data } = await opsAdminDb().from("staff_roles").select("profile_id").eq("org_id", orgId).eq("role", "admin");
  return Array.from(new Set((data ?? []).map((r) => r.profile_id)));
}
