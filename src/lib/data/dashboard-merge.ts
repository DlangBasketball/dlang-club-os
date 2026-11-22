/**
 * Pure helpers for the admin dashboard (unit-tested in
 * tests/unit/open-invoices.test.ts): the "Upcoming sessions" card lists
 * programme sessions AND team events (trainings, games ... from the schedule),
 * soonest first.
 */
export type UpcomingItem = {
  id: string;
  kind: "session" | "event";
  startsAt: string;
  location: string | null;
  /** Programme name (session) or event title / team name; null = unnamed. */
  title: string | null;
  /** team_event_type of an event (training, game ...); null for a session. */
  eventType: string | null;
  teamName?: string | null;
  coachName: string | null;
  coachId: string | null;
  href: string;
};

export function mergeUpcoming(sessions: UpcomingItem[], events: UpcomingItem[], limit: number): UpcomingItem[] {
  return [...sessions, ...events]
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}
