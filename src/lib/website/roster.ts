/**
 * Public roster rule (pure mirror of public.website_public_roster(), used by
 * the API to post-filter and by the unit tests): a child appears on a public
 * page only when the club enabled rosters, the team is public with a public
 * roster AND the child's media consent is recorded; and then only as first
 * name + last initial, with the jersey number. Never a photo, never a full
 * name, never a date of birth.
 */

export type RosterSource = { firstName: string; lastName: string; jerseyNumber: number | null; mediaConsent: boolean; active: boolean };
export type PublicRosterEntry = { name: string; number: number | null };

export function publicRosterName(firstName: string, lastName: string): string {
  const first = firstName.trim();
  const initial = lastName.trim().charAt(0).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}

export function publicRoster(
  members: RosterSource[],
  flags: { clubRosterPublic: boolean; teamPublic: boolean; teamRosterPublic: boolean },
): PublicRosterEntry[] {
  if (!flags.clubRosterPublic || !flags.teamPublic || !flags.teamRosterPublic) return [];
  return members
    .filter((m) => m.active && m.mediaConsent === true && m.firstName.trim())
    .map((m) => ({ name: publicRosterName(m.firstName, m.lastName), number: m.jerseyNumber }))
    .sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.name.localeCompare(b.name));
}

/** Sanitise rows coming back from the database function (defence in depth: the name keeps one initial at most). */
export function sanitizeRosterRows(rows: { display_name: string | null; jersey_number: number | null }[]): PublicRosterEntry[] {
  return rows
    .map((r) => {
      const parts = (r.display_name ?? "").trim().split(/\s+/);
      const first = parts[0] ?? "";
      const initial = (parts[1] ?? "").replace(/[^\p{L}]/gu, "").charAt(0);
      return { name: initial ? `${first} ${initial.toUpperCase()}.` : first, number: r.jersey_number };
    })
    .filter((r) => r.name);
}
