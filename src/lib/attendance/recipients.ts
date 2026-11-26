/**
 * No-show alert recipients — the rule, as pure code (client + server safe).
 * The database applies the same rule in ta_alert_recipients() /
 * ta_alert_family_email() / ta_sync_mark_alerts()
 * (migration 20250420104300_family_attendance_ui.sql); this module documents
 * it and is what the unit tests pin down.
 *
 *  1. Guardians of the athlete's family (family_members) whose login is
 *     active and not suspended in the club: one alert each (recipient key
 *     "g:<profile id>"). Their own preferences decide the channels.
 *  2. Only when the family has NO such guardian: the family's contact e-mail
 *     (families.contact_email), as an e-mail-only recipient keyed by the
 *     family ("f:<family id>"), so a changed address never creates a second
 *     alert. Never an address that belongs to a player login of the family:
 *     minors are never e-mailed directly.
 *  3. Neither: one "none" row with status no_contact for staff follow-up.
 *
 * Players never receive no-show alerts.
 */
export type GuardianCandidate = { profileId: string; active: boolean; suspendedInClub: boolean; isPrimary?: boolean };
export type FamilyCandidate = { id: string; contactEmail: string | null; status?: string | null };

export type AlertRecipient =
  | { kind: "guardian"; key: string; profileId: string }
  | { kind: "family_email"; key: string; familyId: string; email: string }
  | { kind: "none"; key: "none" };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isPlausibleEmail(v: string | null | undefined): v is string {
  return Boolean(v && EMAIL_RE.test(v.trim()));
}

export function recipientKey(r: { guardianProfileId?: string | null; familyId?: string | null }): string {
  if (r.guardianProfileId) return `g:${r.guardianProfileId}`;
  if (r.familyId) return `f:${r.familyId}`;
  return "none";
}

export function resolveAlertRecipients(input: {
  guardians: GuardianCandidate[];
  family: FamilyCandidate | null;
  /** E-mail addresses of player logins of the family (never used). */
  playerLoginEmails?: (string | null | undefined)[];
}): AlertRecipient[] {
  const seen = new Set<string>();
  const guardians = input.guardians
    .filter((g) => g.active && !g.suspendedInClub)
    .sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)))
    .filter((g) => (seen.has(g.profileId) ? false : (seen.add(g.profileId), true)));
  if (guardians.length) {
    return guardians.map((g) => ({ kind: "guardian" as const, key: recipientKey({ guardianProfileId: g.profileId }), profileId: g.profileId }));
  }
  const f = input.family;
  const email = f?.contactEmail?.trim().toLowerCase() ?? "";
  const playerEmails = new Set((input.playerLoginEmails ?? []).map((e) => (e ?? "").trim().toLowerCase()).filter(Boolean));
  if (f && (f.status ?? "active") === "active" && isPlausibleEmail(email) && !playerEmails.has(email)) {
    return [{ kind: "family_email", key: recipientKey({ familyId: f.id }), familyId: f.id, email }];
  }
  return [{ kind: "none", key: "none" }];
}
