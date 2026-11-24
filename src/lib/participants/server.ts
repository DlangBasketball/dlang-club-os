import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HIDDEN_ATHLETE_STATUS_FILTER } from "@/lib/people/person-delete";
import { participantsDb } from "./db";
import type { ParticipantOption, SelfState } from "./validation";

/** Split a display name into first / last for prefilling "Myself". */
export function splitFullName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

export type ParticipantChoices = { participants: ParticipantOption[]; self: SelfState };

/**
 * What the signed-in adult can book for: their own self profile ("Myself",
 * athletes.player_profile_id = them) and the children of their families in
 * the current club (RLS). Never another family's data.
 */
export async function getParticipantChoices(me: { id: string; orgId: string; fullName: string | null }): Promise<ParticipantChoices> {
  const supabase = await createClient();
  const { data: links } = await supabase.from("family_members").select("family_id").eq("profile_id", me.id);
  const familyIds = Array.from(new Set((links ?? []).map((l) => l.family_id as string)));
  const kids = familyIds.length
    ? (await supabase.from("athletes").select("id,first_name,last_name,dob,status,player_profile_id")
        .eq("org_id", me.orgId).in("family_id", familyIds).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).order("first_name")).data ?? []
    : [];
  const rows = (kids as { id: string; first_name: string; last_name: string; dob: string | null; status: string; player_profile_id: string | null }[])
    .filter((k) => k.status !== "inactive");

  // The self profile may sit outside the adult's families (a player record the
  // club linked to this login): read the caller's own row only, org-filtered.
  let selfRow = rows.find((k) => k.player_profile_id === me.id) ?? null;
  if (!selfRow) {
    const { data } = await createAdminClient().from("athletes").select("id,first_name,last_name,dob,status,player_profile_id")
      .eq("org_id", me.orgId).eq("player_profile_id", me.id).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).maybeSingle();
    selfRow = (data as typeof selfRow) ?? null;
  }
  const participants: ParticipantOption[] = rows
    .filter((k) => k.id !== selfRow?.id)
    .map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}`, dob: k.dob, kind: "child" as const }));
  if (selfRow) participants.unshift({ id: selfRow.id, name: `${selfRow.first_name} ${selfRow.last_name}`, dob: selfRow.dob, kind: "self" });
  // "Someone else" participants this adult booked before (Workstream B): only
  // the name / DOB the booker typed, never the participant record.
  const { data: others } = await supabase.rpc("booker_participants" as never);
  for (const o of ((others ?? []) as { athlete_id: string; name: string; dob: string | null }[])) {
    if (!participants.some((p) => p.id === o.athlete_id)) participants.push({ id: o.athlete_id, name: o.name, dob: o.dob, kind: "other" });
  }
  const split = splitFullName(me.fullName);
  return {
    participants,
    self: selfRow
      ? { athleteId: selfRow.id, dob: selfRow.dob, firstName: selfRow.first_name, lastName: selfRow.last_name }
      : { athleteId: null, dob: null, firstName: split.firstName, lastName: split.lastName },
  };
}

export type LinkInboxItem = {
  id: string; athleteId: string; athleteFirstName: string; requesterName: string | null; requesterEmail: string | null;
  relation: string; createdAt: string; expiresAt: string;
};

/** Link requests waiting for the signed-in guardian (children they guard). */
export async function getLinkInbox(): Promise<LinkInboxItem[]> {
  const db = await participantsDb();
  const { data } = await db.rpc("participant_link_inbox", {} as never);
  return ((data ?? []) as Record<string, string | null>[]).map((r) => ({
    id: r.id as string, athleteId: r.athlete_id as string, athleteFirstName: r.athlete_first_name ?? "",
    requesterName: r.requester_name, requesterEmail: r.requester_email, relation: r.relation ?? "guardian",
    createdAt: r.created_at as string, expiresAt: r.expires_at as string,
  }));
}

export type MyRequests = {
  links: { id: string; firstName: string; lastName: string; status: string; createdAt: string }[];
  changes: { id: string; athleteId: string; changes: { dob?: string; gender?: string }; status: string; decisionNote: string | null; createdAt: string }[];
};

/** The signed-in adult's own link requests (status only) and profile corrections. */
export async function getMyParticipantRequests(): Promise<MyRequests> {
  const db = await participantsDb();
  const { data } = await db.rpc("participant_my_requests", {} as never);
  const d = (data ?? { links: [], changes: [] }) as { links: Record<string, string>[]; changes: Record<string, unknown>[] };
  return {
    links: (d.links ?? []).map((l) => ({ id: l.id, firstName: l.first_name ?? "", lastName: l.last_name ?? "", status: l.status, createdAt: l.created_at })),
    changes: (d.changes ?? []).map((c) => ({
      id: c.id as string, athleteId: c.athlete_id as string, changes: (c.changes ?? {}) as { dob?: string; gender?: string },
      status: c.status as string, decisionNote: (c.decision_note as string | null) ?? null, createdAt: c.created_at as string,
    })),
  };
}

export type ReviewQueue = {
  changes: { id: string; athleteId: string; athleteName: string; previous: { dob?: string; gender?: string | null }; changes: { dob?: string; gender?: string };
    impact: { kind: string; id: string }[]; requestedByName: string | null; createdAt: string }[];
  links: { id: string; athleteId: string; athleteName: string; athleteDob: string; familyId: string; familyName: string | null;
    requesterName: string | null; requesterEmail: string | null; relation: string; createdAt: string; expiresAt: string }[];
};

/** Admin queue of pending corrections and link requests (null when the caller is not an admin). */
export async function getReviewQueue(): Promise<ReviewQueue | null> {
  const db = await participantsDb();
  const { data, error } = await db.rpc("participant_review_queue", {} as never);
  if (error || !data) return null;
  const d = data as { changes: Record<string, unknown>[]; links: Record<string, unknown>[] };
  return {
    changes: (d.changes ?? []).map((c) => ({
      id: c.id as string, athleteId: c.athlete_id as string, athleteName: (c.athlete_name as string) ?? "",
      previous: (c.previous ?? {}) as { dob?: string; gender?: string | null }, changes: (c.changes ?? {}) as { dob?: string; gender?: string },
      impact: (c.impact ?? []) as { kind: string; id: string }[], requestedByName: (c.requested_by_name as string | null) ?? null, createdAt: c.created_at as string,
    })),
    links: (d.links ?? []).map((l) => ({
      id: l.id as string, athleteId: l.athlete_id as string, athleteName: (l.athlete_name as string) ?? "", athleteDob: l.athlete_dob as string,
      familyId: l.family_id as string, familyName: (l.family_name as string | null) ?? null, requesterName: (l.requester_name as string | null) ?? null,
      requesterEmail: (l.requester_email as string | null) ?? null, relation: (l.relation as string) ?? "guardian",
      createdAt: l.created_at as string, expiresAt: l.expires_at as string,
    })),
  };
}

export type SportsProfile = {
  athleteId: string; name: string; heightCm: number | null; weightKg: number | null; positionPref: string | null;
  jerseySize: string | null; preferredJerseyNumber: number | null;
};

/** Sports fields for whoever may edit them (coach of the player, guardian, self, staff); null otherwise. */
export async function getSportsProfile(athleteId: string): Promise<SportsProfile | null> {
  const db = await participantsDb();
  const { data } = await db.rpc("participant_sports_profile", { p_athlete: athleteId });
  if (!data) return null;
  const p = data as Record<string, string | number | null>;
  const num = (v: string | number | null) => (v === null || v === undefined ? null : Number(v));
  return {
    athleteId: p.athlete_id as string, name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    heightCm: num(p.height_cm), weightKg: num(p.weight_kg), positionPref: (p.position_pref as string | null) ?? null,
    jerseySize: (p.jersey_size as string | null) ?? null, preferredJerseyNumber: num(p.preferred_jersey_number),
  };
}
