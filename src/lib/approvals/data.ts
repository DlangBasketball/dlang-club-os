import "server-only";
import { logError } from "@/lib/log";
import { approvalsDb } from "./db";
import { asRequests, type ClubRequest } from "./types";

/**
 * Server reads of the club approval workflow. Every read goes through the
 * signed-in user's session; the RPCs resolve the club from the session and
 * re-check the role (admins: every request; coaches: assigned programme
 * requests with minimal data; families: their own requests).
 */
export async function listClubRequestQueue(scope: "open" | "decided" | "all" = "open"): Promise<ClubRequest[]> {
  const db = await approvalsDb();
  const { data, error } = await db.rpc("club_request_queue", { p_scope: scope });
  if (error) {
    logError("approvals.queue", error);
    return [];
  }
  return asRequests(data);
}

export type ApprovalCounts = { clubOpen: number; clubInfoRequested: number; campOpen: number };

export async function getApprovalCounts(): Promise<ApprovalCounts> {
  const db = await approvalsDb();
  const { data, error } = await db.rpc("club_request_counts", {});
  if (error || !data) return { clubOpen: 0, clubInfoRequested: 0, campOpen: 0 };
  const d = data as { club_open?: number; club_info_requested?: number; camp_open?: number };
  return { clubOpen: Number(d.club_open ?? 0), clubInfoRequested: Number(d.club_info_requested ?? 0), campOpen: Number(d.camp_open ?? 0) };
}

/** The caller's own families' requests (any status), newest first. */
export async function listFamilyClubRequests(): Promise<ClubRequest[]> {
  const db = await approvalsDb();
  const { data, error } = await db.rpc("club_request_family_list", {});
  if (error) {
    logError("approvals.familyList", error);
    return [];
  }
  return asRequests(data);
}

export type ClubProgramOption = {
  id: string; name: string; kind: string; description: string | null; price: number; currency: string | null;
  minAge: number | null; maxAge: number | null; startsOn: string | null; endsOn: string | null;
};

/** Published club programmes a family may request (club approval required). */
export async function listRequestableClubPrograms(orgId: string): Promise<ClubProgramOption[]> {
  const db = await approvalsDb();
  const { data, error } = await db.from("programs")
    .select("id,name,kind,description,price_chf,currency,min_age,max_age,starts_on,ends_on,registration_opens_at,registration_closes_at,status,requires_club_approval")
    .eq("org_id", orgId).eq("status", "published").eq("requires_club_approval" as never, true as never).in("kind", ["recurring_team", "clinic"])
    .order("name");
  if (error) {
    logError("approvals.clubPrograms", error);
    return [];
  }
  const now = Date.now();
  type Row = {
    id: string; name: string; kind: string; description: string | null; price_chf: number | string; currency: string | null;
    min_age: number | null; max_age: number | null; starts_on: string | null; ends_on: string | null;
    registration_opens_at: string | null; registration_closes_at: string | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((p) => (!p.registration_opens_at || Date.parse(p.registration_opens_at) <= now)
      && (!p.registration_closes_at || Date.parse(p.registration_closes_at) > now))
    .map((p) => ({
      id: p.id, name: p.name, kind: p.kind, description: p.description, price: Number(p.price_chf ?? 0), currency: p.currency,
      minAge: p.min_age, maxAge: p.max_age, startsOn: p.starts_on, endsOn: p.ends_on,
    }));
}

export type UnconfirmedParticipant = { athleteId: string; fullName: string; reason: string };

/** "Not yet confirmed" participants of an attendance session (names + reason; never markable). */
export async function listSessionUnconfirmed(attendanceSessionId: string): Promise<UnconfirmedParticipant[]> {
  const db = await approvalsDb();
  const { data, error } = await db.rpc("session_roster_unconfirmed", { p_attendance_session: attendanceSessionId });
  if (error) return [];
  return ((data ?? []) as { athlete_id: string; full_name: string; reason: string }[])
    .map((r) => ({ athleteId: r.athlete_id, fullName: r.full_name, reason: r.reason }));
}
