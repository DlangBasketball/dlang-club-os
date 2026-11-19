import "server-only";
import type { SessionUser } from "@/lib/auth/get-user";
import { familyAdminDb, familyDb, type CarpoolBoard, type ConsentKind, type JourneyData, type PlacementRow, type PlacementHistoryRow, type ScoutProfileRow, type SeasonReviewRow } from "./db";
import { myFamilyIds } from "./action-helpers";
import { suggestMatches, type Suggestion } from "./carpool";
import { logError } from "@/lib/log";

type Me = SessionUser & { orgId: string };

// ---------------------------------------------------------------------------
// Family: guardians, permissions, billing split
// ---------------------------------------------------------------------------
export type GuardianView = {
  profileId: string; name: string; relation: string | null; isPrimary: boolean; isMe: boolean;
  canPay: boolean; canSeeMedical: boolean; receivesEmails: boolean; sharePct: number | null;
};
export type FamilyPanel = {
  id: string; name: string; splitMode: "single" | "split"; iAmPrimary: boolean;
  guardians: GuardianView[]; children: { id: string; name: string }[];
  pendingInvites: { id: string; email: string; createdAt: string }[];
};

export async function getFamilyPanels(me: Me): Promise<FamilyPanel[]> {
  const ids = await myFamilyIds(me);
  if (!ids.length) return [];
  const db = familyAdminDb();
  const [{ data: fams }, { data: links }, { data: kids }, { data: invites }] = await Promise.all([
    db.from("families").select("id,name,billing_split_mode").in("id", ids).eq("org_id", me.orgId),
    db.from("family_members").select("*").in("family_id", ids),
    db.from("athletes").select("id,first_name,last_name,family_id,status").in("family_id", ids).eq("org_id", me.orgId).neq("status", "archived"),
    db.from("invitations").select("id,email,family_id,created_at,status").in("family_id", ids).eq("org_id", me.orgId).eq("status", "pending"),
  ]);
  const profileIds = Array.from(new Set((links ?? []).map((l) => l.profile_id)));
  const { data: profs } = profileIds.length ? await db.from("profiles").select("id,full_name").in("id", profileIds) : { data: [] };
  const name = new Map((profs ?? []).map((p) => [p.id, p.full_name ?? "—"]));
  return (fams ?? []).map((f) => {
    const g = (links ?? []).filter((l) => l.family_id === f.id);
    const iAmPrimary = g.some((l) => l.profile_id === me.id && l.is_primary);
    return {
      id: f.id, name: f.name, splitMode: f.billing_split_mode, iAmPrimary,
      guardians: g
        .map((l) => ({
          profileId: l.profile_id, name: name.get(l.profile_id) ?? "—", relation: l.relation, isPrimary: l.is_primary, isMe: l.profile_id === me.id,
          canPay: l.can_pay, canSeeMedical: l.can_see_medical, receivesEmails: l.receives_emails,
          sharePct: l.billing_share_pct === null ? null : Number(l.billing_share_pct),
        }))
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name)),
      children: (kids ?? []).filter((k) => k.family_id === f.id).map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}` })),
      pendingInvites: iAmPrimary
        ? (invites ?? []).filter((i) => i.family_id === f.id).map((i) => ({ id: i.id, email: String(i.email), createdAt: i.created_at }))
        : [],
    };
  });
}

/** Admin / finance overview: families paying with a split, and their open invoices not yet split. */
export async function getSplitFamilies(me: Me): Promise<{ id: string; name: string; shares: { name: string; pct: number }[]; openUnsplit: number }[]> {
  const db = familyAdminDb();
  const { data: fams } = await db.from("families").select("id,name").eq("org_id", me.orgId).eq("billing_split_mode", "split").order("name").limit(500);
  const ids = (fams ?? []).map((f) => f.id);
  if (!ids.length) return [];
  const [{ data: links }, { data: invs }] = await Promise.all([
    db.from("family_members").select("family_id,profile_id,billing_share_pct").in("family_id", ids),
    db.from("invoices").select("id,family_id").eq("org_id", me.orgId).in("family_id", ids).is("split_group_id", null).in("status", ["draft", "pending", "sent", "overdue"]),
  ]);
  const pids = Array.from(new Set((links ?? []).map((l) => l.profile_id)));
  const { data: profs } = pids.length ? await db.from("profiles").select("id,full_name").in("id", pids) : { data: [] };
  const name = new Map((profs ?? []).map((p) => [p.id, p.full_name ?? "—"]));
  return (fams ?? []).map((f) => ({
    id: f.id, name: f.name,
    shares: (links ?? []).filter((l) => l.family_id === f.id && (l.billing_share_pct ?? 0) > 0).map((l) => ({ name: name.get(l.profile_id) ?? "—", pct: Number(l.billing_share_pct) })),
    openUnsplit: (invs ?? []).filter((i) => i.family_id === f.id).length,
  }));
}

// ---------------------------------------------------------------------------
// Privacy & data
// ---------------------------------------------------------------------------
export type PrivacyPanel = {
  familyId: string | null;
  children: { id: string; name: string; media: boolean | null; mediaAt: string | null }[];
  marketing: boolean | null;
  history: { kind: ConsentKind; childName: string | null; granted: boolean; at: string; byMe: boolean }[];
  requests: { type: string; status: string; receivedAt: string; dueAt: string | null }[];
  erasurePending: boolean;
};

export async function getPrivacyPanel(me: Me): Promise<PrivacyPanel> {
  const ids = await myFamilyIds(me);
  const familyId = ids[0] ?? null;
  const empty: PrivacyPanel = { familyId, children: [], marketing: null, history: [], requests: [], erasurePending: false };
  if (!familyId) return empty;
  const db = await familyDb();
  const [{ data: kids }, { data: state }, { data: events }, { data: dsars }, { data: del }] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name").eq("family_id", familyId).neq("status", "archived"),
    db.rpc("family_consent_state", { p_family: familyId }),
    db.from("family_consent_events").select("*").eq("family_id", familyId).order("created_at", { ascending: false }).limit(50),
    db.from("dsar_requests").select("request_type,status,received_at,due_at").order("received_at", { ascending: false }).limit(20),
    familyAdminDb().from("deletion_requests").select("id").eq("org_id", me.orgId).eq("family_id", familyId).eq("status", "pending").limit(1),
  ]);
  const kidName = new Map((kids ?? []).map((k) => [k.id, `${k.first_name} ${k.last_name}`]));
  const media = new Map((state ?? []).filter((s) => s.kind === "media").map((s) => [s.athlete_id, s]));
  const marketing = (state ?? []).find((s) => s.kind === "marketing" && s.profile_id === me.id);
  return {
    familyId,
    children: (kids ?? []).map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}`, media: media.get(k.id)?.granted ?? null, mediaAt: media.get(k.id)?.decided_at ?? null })),
    marketing: marketing ? marketing.granted : null,
    history: (events ?? [])
      .filter((e) => e.kind !== "marketing" || e.profile_id === me.id)
      .map((e) => ({ kind: e.kind, childName: e.athlete_id ? kidName.get(e.athlete_id) ?? null : null, granted: e.granted, at: e.created_at, byMe: e.profile_id === me.id })),
    requests: (dsars ?? []).map((d) => ({ type: d.request_type, status: d.status, receivedAt: d.received_at, dueAt: d.due_at })),
    erasurePending: Boolean(del?.length),
  };
}

// ---------------------------------------------------------------------------
// Carpooling
// ---------------------------------------------------------------------------
export type CarpoolEventItem = {
  id: string; title: string | null; type: string; startsAt: string; teamName: string | null; away: boolean;
  location: string | null; offers: number; requests: number;
};

/** Upcoming events (next 60 days) the caller can see, with board counts. RLS decides visibility. */
export async function getCarpoolEvents(me: Me): Promise<CarpoolEventItem[]> {
  const db = await familyDb();
  const now = new Date();
  const until = new Date(now.getTime() + 60 * 864e5);
  const { data: events, error } = await db
    .from("events")
    .select("id,title,type,starts_at,team_id,home_away,location_text,location_name,status")
    .eq("org_id", me.orgId)
    .neq("status", "cancelled")
    .gte("ends_at", now.toISOString())
    .lte("starts_at", until.toISOString())
    .order("starts_at")
    .limit(80);
  if (error) {
    logError("family.carpoolEvents", error);
    return [];
  }
  const rows = (events ?? []).filter((e) => e.type !== "training" || e.home_away === "away");
  const teamIds = Array.from(new Set(rows.map((e) => e.team_id).filter((x): x is string => Boolean(x))));
  const evIds = rows.map((e) => e.id);
  const [{ data: teams }, { data: offers }, { data: reqs }] = await Promise.all([
    teamIds.length ? db.from("teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    evIds.length ? db.from("carpool_offers").select("event_id").in("event_id", evIds).neq("status", "cancelled") : Promise.resolve({ data: [] as { event_id: string }[] }),
    evIds.length ? db.from("carpool_requests").select("event_id").in("event_id", evIds).eq("status", "open") : Promise.resolve({ data: [] as { event_id: string }[] }),
  ]);
  const tName = new Map((teams ?? []).map((t) => [t.id, t.name]));
  const count = (list: { event_id: string }[] | null, id: string) => (list ?? []).filter((x) => x.event_id === id).length;
  return rows.map((e) => ({
    id: e.id, title: e.title, type: e.type, startsAt: e.starts_at, teamName: e.team_id ? tName.get(e.team_id) ?? null : null,
    away: e.home_away === "away", location: e.location_name ?? e.location_text ?? null,
    offers: count(offers, e.id), requests: count(reqs, e.id),
  }));
}

export type CarpoolBoardView = {
  event: { id: string; title: string | null; type: string; startsAt: string; endsAt: string; status: string; location: string | null; teamName: string | null };
  board: CarpoolBoard;
  suggestions: Suggestion[];
  canPost: boolean;
  canManage: boolean;
};

export async function getCarpoolBoard(me: Me, eventId: string): Promise<CarpoolBoardView | null> {
  const db = await familyDb();
  const { data: ev } = await db.from("events").select("id,title,type,starts_at,ends_at,status,team_id,location_text,location_name").eq("id", eventId).eq("org_id", me.orgId).maybeSingle();
  if (!ev) return null;
  const { data: board, error } = await db.rpc("carpool_board", { p_event: eventId });
  if (error || !board) return null;
  const [{ data: team }, { data: manage }] = await Promise.all([
    ev.team_id ? db.from("teams").select("name").eq("id", ev.team_id).maybeSingle() : Promise.resolve({ data: null }),
    db.rpc("can_manage_event", { p_event: eventId }),
  ]);
  const mine = await myFamilyIds(me);
  const suggestions = suggestMatches(
    board.offers.map((o) => ({ id: o.id, fromArea: o.from_area, seatsTotal: o.seats_total, seatsTaken: o.seats_taken, returnTrip: o.return_trip, status: o.status, mine: o.mine })),
    board.requests.map((r) => ({ id: r.id, fromArea: r.from_area, seatsNeeded: r.seats_needed, returnTrip: r.return_trip, status: r.status, mine: r.mine })),
  );
  return {
    event: {
      id: ev.id, title: ev.title, type: ev.type, startsAt: ev.starts_at, endsAt: ev.ends_at, status: ev.status,
      location: ev.location_name ?? ev.location_text ?? null, teamName: (team as { name?: string } | null)?.name ?? null,
    },
    board,
    suggestions,
    canPost: mine.length > 0 && ev.status !== "cancelled" && Date.parse(ev.ends_at) > Date.now(),
    canManage: Boolean(manage),
  };
}

// ---------------------------------------------------------------------------
// Player journey
// ---------------------------------------------------------------------------
export type JourneyAthlete = { id: string; name: string; dob: string | null };

/** Athletes the caller may open: RLS (admin all, coach assigned, guardian own children). */
export async function getJourneyAthletes(me: Me, app: "admin" | "coach" | "parent"): Promise<JourneyAthlete[]> {
  const db = await familyDb();
  let q = db.from("athletes").select("id,first_name,last_name,dob,family_id").eq("org_id", me.orgId).neq("status", "archived").order("last_name").limit(500);
  if (app === "parent") {
    const fams = await myFamilyIds(me);
    if (!fams.length) return [];
    q = q.in("family_id", fams);
  }
  const { data } = await q;
  return (data ?? []).map((a) => ({ id: a.id, name: `${a.first_name} ${a.last_name}`, dob: a.dob }));
}

export type JourneyDetail = {
  athlete: { id: string; name: string; dob: string | null };
  journey: JourneyData;
  placements: (PlacementRow & { history: PlacementHistoryRow[] })[];
  reviews: SeasonReviewRow[];
  scout: Omit<ScoutProfileRow, "token_hash"> | null;
  documents: { id: string; name: string }[];
  seasons: { id: string; name: string }[];
  canWrite: boolean;
  isGuardian: boolean;
};

export async function getJourneyDetail(me: Me, athleteId: string): Promise<JourneyDetail | null> {
  const db = await familyDb();
  const { data: a } = await db.from("athletes").select("id,first_name,last_name,dob,family_id").eq("id", athleteId).eq("org_id", me.orgId).maybeSingle();
  if (!a) return null;
  const { data: journey, error } = await db.rpc("player_journey", { p_athlete: athleteId });
  if (error || !journey) return null;
  const mine = await myFamilyIds(me);
  const [{ data: placements }, { data: reviews }, { data: scout }, { data: canWrite }, { data: docs }, { data: seasons }] = await Promise.all([
    db.from("placement_targets").select("*").eq("athlete_id", athleteId).order("updated_at", { ascending: false }),
    db.from("player_season_reviews").select("*").eq("athlete_id", athleteId).order("created_at", { ascending: false }),
    db.from("scout_profiles").select("id,org_id,athlete_id,fields,headline,consent_by,consented_at,consent_version,published_at,expires_at,revoked_at,revoked_by,view_count,last_viewed_at,created_at,updated_at").eq("athlete_id", athleteId).maybeSingle(),
    db.rpc("journey_can_write", { p_athlete: athleteId }),
    db.from("documents").select("id,file_name,kind").eq("org_id", me.orgId).or(`athlete_id.eq.${athleteId},family_id.eq.${a.family_id}`).limit(100),
    db.from("seasons").select("id,name").eq("org_id", me.orgId).order("starts_on", { ascending: false }).limit(30),
  ]);
  const pIds = (placements ?? []).map((p) => p.id);
  const { data: hist } = pIds.length ? await db.from("placement_status_history").select("*").in("placement_id", pIds).order("created_at") : { data: [] as PlacementHistoryRow[] };
  return {
    athlete: { id: a.id, name: `${a.first_name} ${a.last_name}`, dob: a.dob },
    journey,
    placements: (placements ?? []).map((p) => ({ ...p, history: (hist ?? []).filter((h) => h.placement_id === p.id) })),
    reviews: reviews ?? [],
    scout: (scout as Omit<ScoutProfileRow, "token_hash"> | null) ?? null,
    documents: (docs ?? []).map((d) => ({ id: d.id, name: d.file_name ?? d.kind })),
    seasons: (seasons ?? []).map((s) => ({ id: s.id, name: s.name })),
    canWrite: Boolean(canWrite),
    isGuardian: mine.includes(a.family_id),
  };
}
