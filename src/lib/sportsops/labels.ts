import type { EventStatus, EventType, MembershipStatus, RsvpStatus } from "./db";

/**
 * Neutral, sport-agnostic vocabulary for this module.
 * TODO(tenancy): route these through the tenant terminology helper (term())
 * so a school can say "Squad"/"Student" and a club "Team"/"Player".
 */
export const LABELS = {
  team: "Team",
  teams: "Teams",
  athlete: "Athlete",
  athletes: "Athletes",
  season: "Season",
  venue: "Venue",
  space: "Court / field",
  coach: "Coach",
  roster: "Roster",
} as const;

export const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: "training", label: "Training" },
  { value: "game", label: "Game" },
  { value: "tournament", label: "Tournament" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];
export const eventTypeLabel = (t: EventType) => EVENT_TYPES.find((x) => x.value === t)?.label ?? t;

export const EVENT_STATUSES: EventStatus[] = ["scheduled", "postponed", "cancelled", "completed"];
export const MEMBERSHIP_STATUSES: MembershipStatus[] = ["active", "trial", "injured", "inactive"];
export const RSVP_LABEL: Record<RsvpStatus, string> = { going: "Going", maybe: "Maybe", not_going: "Can't make it" };

export function eventTitle(e: { type: EventType; title: string | null; opponent: string | null; home_away?: string | null; teamName?: string | null }) {
  if (e.title) return e.title;
  if ((e.type === "game" || e.type === "tournament") && e.opponent) {
    const sep = e.home_away === "away" ? "@" : "vs";
    return `${e.teamName ? `${e.teamName} ` : ""}${sep} ${e.opponent}`;
  }
  return `${e.teamName ? `${e.teamName} · ` : ""}${eventTypeLabel(e.type)}`;
}

export const eventTone = (t: EventType): "maroon" | "warning" | "success" | "neutral" =>
  t === "game" || t === "tournament" ? "maroon" : t === "training" ? "success" : t === "meeting" ? "warning" : "neutral";
