import { createClient } from "@/lib/supabase/server";
import { zonedDayKey, addDayKey } from "@/lib/staff/hours";
import { zonedWallTimeToUtc } from "@/lib/format";
import { loadOpenInvoices } from "@/lib/data/open-invoices";
import { summarizeOpenInvoices, type OpenBucket } from "@/lib/payments/open-invoices";
import { mergeUpcoming, type UpcomingItem } from "@/lib/data/dashboard-merge";
import type { SportsClient } from "@/lib/sportsops/db";

/** Every query returns this so widgets can render a dedicated error state. */
export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });

/** Today in the club's time zone: its date key and the UTC instants that bound it. */
function dayBounds(timeZone: string, d = new Date()) {
  const dateStr = zonedDayKey(d, timeZone);
  const start = zonedWallTimeToUtc(dateStr, "00:00", timeZone) ?? new Date(`${dateStr}T00:00:00Z`);
  const end = zonedWallTimeToUtc(addDayKey(dateStr, 1), "00:00", timeZone) ?? new Date(start.getTime() + 864e5);
  return { startISO: start.toISOString(), endISO: end.toISOString(), dateStr };
}

function uniq(ids: (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
}

/**
 * Team events that are still on. An event created for a programme session
 * (program_session_id set) is the same slot as that session: counted once.
 */
const LIVE_EVENT_STATUSES: ("scheduled" | "postponed")[] = ["scheduled", "postponed"];

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------
export type Kpis = {
  activeAthletes: number;
  activeFamilies: number;
  openInvoices: number;
  overdueInvoices: number;
  upcomingSessions: number;
  sessionsToday: number;
};

/**
 * Headline numbers. Open / overdue follow the invoice list (sent, partially
 * paid, overdue and legacy pending; drafts are not owed yet). Sessions count
 * programme sessions and team events, so the tiles match the calendar.
 */
export async function getKpis(timeZone: string): Promise<Result<Kpis>> {
  const supabase = await createClient();
  const sports = supabase as unknown as SportsClient;
  const { dateStr, startISO, endISO } = dayBounds(timeZone);
  const nowISO = new Date().toISOString();

  const [athleteCount, open, upSessions, upEvents, todaySessions, todayEvents] = await Promise.all([
    supabase.from("athletes").select("id", { count: "exact", head: true }).eq("status", "active"),
    loadOpenInvoices(supabase),
    supabase.from("program_sessions").select("id", { count: "exact", head: true }).gte("starts_at", nowISO),
    sports.from("events").select("id", { count: "exact", head: true }).gte("starts_at", nowISO).is("program_session_id", null).in("status", LIVE_EVENT_STATUSES),
    supabase.from("program_sessions").select("id", { count: "exact", head: true }).gte("starts_at", startISO).lt("starts_at", endISO),
    sports.from("events").select("id", { count: "exact", head: true }).gte("starts_at", startISO).lt("starts_at", endISO).is("program_session_id", null).in("status", LIVE_EVENT_STATUSES),
  ]);
  for (const r of [athleteCount, upSessions, upEvents, todaySessions, todayEvents]) if (r.error) return fail(r.error.message);
  if (open.error !== null) return fail(open.error);

  // Families with an active athlete (paged: PostgREST caps a response at ~1000 rows).
  const families = new Set<string>();
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await supabase.from("athletes").select("family_id").eq("status", "active").order("id").range(from, from + 999);
    if (error) return fail(error.message);
    for (const a of data ?? []) if (a.family_id) families.add(a.family_id);
    if (!data || data.length < 1000) break;
  }

  const s = summarizeOpenInvoices(open.data, dateStr);
  return ok({
    activeAthletes: athleteCount.count ?? 0,
    activeFamilies: families.size,
    openInvoices: s.open.count,
    overdueInvoices: s.overdue.count,
    upcomingSessions: (upSessions.count ?? 0) + (upEvents.count ?? 0),
    sessionsToday: (todaySessions.count ?? 0) + (todayEvents.count ?? 0),
  });
}

// ---------------------------------------------------------------------------
// Invoice summary (open / overdue balances + paid count)
// ---------------------------------------------------------------------------
export type InvoiceSummary = {
  /** Balances still owed, per currency. */
  open: OpenBucket;
  overdue: OpenBucket;
  paidCount: number;
};

export async function getInvoiceSummary(timeZone: string): Promise<Result<InvoiceSummary>> {
  const supabase = await createClient();
  const { dateStr } = dayBounds(timeZone);
  const [open, paid] = await Promise.all([
    loadOpenInvoices(supabase),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "paid"),
  ]);
  if (open.error !== null) return fail(open.error);
  if (paid.error) return fail(paid.error.message);
  const s = summarizeOpenInvoices(open.data, dateStr);
  return ok({ open: s.open, overdue: s.overdue, paidCount: paid.count ?? 0 });
}

// ---------------------------------------------------------------------------
// Upcoming sessions (programme sessions + team events)
// ---------------------------------------------------------------------------
export type UpcomingSession = UpcomingItem;

export async function getUpcomingSessions(limit = 5): Promise<Result<UpcomingSession[]>> {
  const supabase = await createClient();
  const sports = supabase as unknown as SportsClient;
  const nowISO = new Date().toISOString();
  const [sessions, events] = await Promise.all([
    supabase.from("program_sessions").select("id,starts_at,location,program_id,coach_id").gte("starts_at", nowISO).order("starts_at", { ascending: true }).limit(limit),
    sports
      .from("events")
      .select("id,starts_at,title,type,team_id,location_name,location_text,venue_id")
      .gte("starts_at", nowISO)
      .is("program_session_id", null)
      .in("status", LIVE_EVENT_STATUSES)
      .order("starts_at", { ascending: true })
      .limit(limit),
  ]);
  if (sessions.error) return fail(sessions.error.message);
  if (events.error) return fail(events.error.message);

  const programIds = uniq((sessions.data ?? []).map((s) => s.program_id));
  const coachIds = uniq((sessions.data ?? []).map((s) => s.coach_id));
  const teamIds = uniq((events.data ?? []).map((e) => e.team_id));
  const venueIds = uniq((events.data ?? []).map((e) => e.venue_id));
  const [programs, coaches, teams, venues] = await Promise.all([
    programIds.length ? supabase.from("programs").select("id,name").in("id", programIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    coachIds.length ? supabase.from("coaches").select("id,display_name").in("id", coachIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    teamIds.length ? sports.from("teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    venueIds.length ? sports.from("venues").select("id,name").in("id", venueIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const pName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));
  const cName = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));
  const tName = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
  const vName = new Map((venues.data ?? []).map((v) => [v.id, v.name]));

  return ok(
    mergeUpcoming(
      (sessions.data ?? []).map((s) => ({
        id: s.id,
        kind: "session" as const,
        startsAt: s.starts_at,
        location: s.location,
        title: pName.get(s.program_id) ?? null,
        eventType: null,
        coachName: s.coach_id ? cName.get(s.coach_id) ?? null : null,
        coachId: s.coach_id ?? null,
        href: `/admin/programs/${s.program_id}`,
      })),
      (events.data ?? []).map((e) => ({
        id: e.id,
        kind: "event" as const,
        startsAt: e.starts_at,
        location: e.location_name ?? (e.venue_id ? vName.get(e.venue_id) ?? null : null) ?? e.location_text,
        title: e.title ?? (e.team_id ? tName.get(e.team_id) ?? null : null),
        eventType: e.type,
        teamName: e.team_id ? tName.get(e.team_id) ?? null : null,
        coachName: null,
        coachId: null,
        href: `/admin/schedule/${e.id}`,
      })),
      limit,
    ),
  );
}

// ---------------------------------------------------------------------------
// Recent registrations
// ---------------------------------------------------------------------------
export type RecentRegistration = {
  id: string;
  status: string;
  createdAt: string;
  athleteName: string | null;
  programName: string | null;
};

export async function getRecentRegistrations(limit = 6): Promise<Result<RecentRegistration[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .select("id,status,created_at,athlete_id,program_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return fail(error.message);

  const athleteIds = uniq((data ?? []).map((r) => r.athlete_id));
  const programIds = uniq((data ?? []).map((r) => r.program_id));
  const [athletes, programs] = await Promise.all([
    athleteIds.length
      ? supabase.from("athletes").select("id,first_name,last_name").in("id", athleteIds)
      : Promise.resolve({ data: [], error: null }),
    programIds.length
      ? supabase.from("programs").select("id,name").in("id", programIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const aName = new Map(
    (athletes.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]),
  );
  const pName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));

  return ok(
    (data ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.created_at,
      athleteName: aName.get(r.athlete_id) ?? null,
      programName: pName.get(r.program_id) ?? null,
    })),
  );
}

// ---------------------------------------------------------------------------
// Recent payments
// ---------------------------------------------------------------------------
export type RecentPayment = {
  id: string;
  amount: number;
  currency: string | null;
  method: string;
  status: string;
  when: string;
  invoiceId: string | null;
  invoiceNumber: string;
  familyName: string;
};

export async function getRecentPayments(limit = 5): Promise<Result<RecentPayment[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select("id,amount_chf,method,status,paid_at,created_at,invoice_id")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return fail(error.message);

  const invoiceIds = uniq((data ?? []).map((p) => p.invoice_id));
  const invoices = invoiceIds.length
    ? await supabase.from("invoices").select("id,number,family_id,currency").in("id", invoiceIds)
    : { data: [] as { id: string; number: string; family_id: string; currency: string | null }[], error: null };
  const familyIds = uniq((invoices.data ?? []).map((i) => i.family_id));
  const families = familyIds.length
    ? await supabase.from("families").select("id,name").in("id", familyIds)
    : { data: [] as { id: string; name: string }[], error: null };

  const invMap = new Map((invoices.data ?? []).map((i) => [i.id, i]));
  const famName = new Map((families.data ?? []).map((f) => [f.id, f.name]));

  return ok(
    (data ?? []).map((p) => {
      const inv = invMap.get(p.invoice_id);
      return {
        id: p.id,
        amount: Number(p.amount_chf ?? 0),
        currency: inv?.currency ?? null,
        method: p.method,
        status: p.status,
        when: p.paid_at ?? p.created_at,
        invoiceId: inv?.id ?? null,
        invoiceNumber: inv?.number ?? "—",
        familyName: inv ? famName.get(inv.family_id) ?? "—" : "—",
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Today's attendance status
// ---------------------------------------------------------------------------
export type TodaysAttendance = {
  total: number;
  submitted: number;
  open: number;
};

export async function getTodaysAttendance(timeZone: string): Promise<Result<TodaysAttendance>> {
  const supabase = await createClient();
  const { startISO, endISO } = dayBounds(timeZone);
  const { data, error } = await supabase
    .from("attendance_sessions")
    .select("status")
    .gte("session_date", startISO)
    .lt("session_date", endISO);
  if (error) return fail(error.message);

  const rows = data ?? [];
  return ok({
    total: rows.length,
    submitted: rows.filter((r) => r.status === "submitted" || r.status === "locked").length,
    open: rows.filter((r) => r.status === "open").length,
  });
}

// ---------------------------------------------------------------------------
// Activity feed (recent notifications)
// ---------------------------------------------------------------------------
export type ActivityItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  createdAt: string;
};

export async function getActivityFeed(limit = 8): Promise<Result<ActivityItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id,type,title,body,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return fail(error.message);
  return ok(
    (data ?? []).map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      createdAt: n.created_at,
    })),
  );
}

// ---------------------------------------------------------------------------
// Team attendance (admin): today's sessions with coach coverage, recent
// confirmed no-shows. Reads run as the signed-in user (RLS: admin of the org).
// ---------------------------------------------------------------------------
const SHEET_TYPES: ("training" | "game" | "tournament")[] = ["training", "game", "tournament"];

export type TodayTraining = {
  eventId: string; teamId: string | null; teamName: string | null; type: string; title: string | null; startsAt: string; endsAt: string;
  status: string; cancelReason: string | null; coverage: "substitute" | "assigned" | "missing"; coaches: string[]; substitutes: string[];
  pendingRequests: number; sheetStatus: "draft" | "final" | "reopened" | null;
};

/** Today's team sessions (club time zone), cancelled ones included, with who is coaching. */
export async function getTodaysTrainings(timeZone: string): Promise<Result<TodayTraining[]>> {
  const supabase = await createClient();
  const sports = supabase as unknown as SportsClient;
  const { startISO, endISO } = dayBounds(timeZone);
  const { data: events, error } = await sports.from("events").select("id,team_id,type,title,starts_at,ends_at,status,cancel_reason")
    .gte("starts_at", startISO).lt("starts_at", endISO).in("type", SHEET_TYPES).not("team_id", "is", null).order("starts_at").limit(100);
  if (error) return fail(error.message);
  const rows = events ?? [];
  const ids = rows.map((e) => e.id);
  const teamIds = uniq(rows.map((e) => e.team_id));
  if (!ids.length) return ok([]);
  const [teams, tc, asg, sheets] = await Promise.all([
    sports.from("teams").select("id,name").in("id", teamIds),
    sports.from("team_coaches").select("team_id,coach_id").in("team_id", teamIds),
    supabase.from("event_coach_assignments").select("event_id,coach_id,status").in("event_id", ids).in("status", ["approved", "pending"]),
    supabase.from("team_attendance_sheets").select("event_id,status").in("event_id", ids),
  ]);
  const coachIds = uniq([...(tc.data ?? []).map((c) => c.coach_id), ...(asg.data ?? []).map((a) => a.coach_id)]);
  const coachRows = coachIds.length ? (await supabase.from("coaches").select("id,display_name").in("id", coachIds)).data ?? [] : [];
  const coachName = new Map(coachRows.map((c) => [c.id, c.display_name]));
  const teamName = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
  const sheet = new Map((sheets.data ?? []).map((s) => [s.event_id, s.status]));
  return ok(rows.map((e) => {
    const teamCoaches = (tc.data ?? []).filter((c) => c.team_id === e.team_id).map((c) => coachName.get(c.coach_id) ?? "");
    const mine = (asg.data ?? []).filter((a) => a.event_id === e.id);
    const subs = mine.filter((a) => a.status === "approved").map((a) => coachName.get(a.coach_id) ?? "");
    const coverage: TodayTraining["coverage"] = subs.length ? "substitute" : teamCoaches.length ? "assigned" : "missing";
    return {
      eventId: e.id, teamId: e.team_id, teamName: e.team_id ? teamName.get(e.team_id) ?? null : null, type: e.type, title: e.title,
      startsAt: e.starts_at, endsAt: e.ends_at, status: e.status, cancelReason: e.cancel_reason ?? null, coverage,
      coaches: teamCoaches.filter(Boolean), substitutes: subs.filter(Boolean),
      pendingRequests: mine.filter((a) => a.status === "pending").length, sheetStatus: sheet.get(e.id) ?? null,
    };
  }));
}

export type ConfirmedNoShow = { eventId: string; athleteId: string; athleteName: string; teamName: string | null; startsAt: string };

/** Unexcused absences on finalized sheets of the last `days` days (newest first). */
export async function getConfirmedNoShows(days = 14, limit = 8): Promise<Result<ConfirmedNoShow[]>> {
  const supabase = await createClient();
  const sports = supabase as unknown as SportsClient;
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const { data: events, error } = await sports.from("events").select("id,team_id,starts_at")
    .gte("starts_at", since).lt("ends_at", new Date().toISOString()).neq("status", "cancelled").in("type", SHEET_TYPES)
    .not("team_id", "is", null).order("starts_at", { ascending: false }).limit(300);
  if (error) return fail(error.message);
  const ids = (events ?? []).map((e) => e.id);
  if (!ids.length) return ok([]);
  const { data: sheets, error: sErr } = await supabase.from("team_attendance_sheets").select("event_id").in("event_id", ids).gt("finalize_count", 0);
  if (sErr) return fail(sErr.message);
  const finalIds = (sheets ?? []).map((s) => s.event_id);
  if (!finalIds.length) return ok([]);
  const { data: marks, error: mErr } = await supabase.from("team_attendance_marks").select("event_id,athlete_id")
    .in("event_id", finalIds).eq("finalized_status", "unexcused").limit(500);
  if (mErr) return fail(mErr.message);
  const athleteIds = uniq((marks ?? []).map((m) => m.athlete_id));
  const teamIds = uniq((events ?? []).map((e) => e.team_id));
  const [ath, teams] = await Promise.all([
    athleteIds.length ? supabase.from("athletes").select("id,first_name,last_name").in("id", athleteIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    sports.from("teams").select("id,name").in("id", teamIds),
  ]);
  const name = new Map((ath.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  const team = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
  const ev = new Map((events ?? []).map((e) => [e.id, e]));
  return ok((marks ?? [])
    .map((m) => {
      const e = ev.get(m.event_id);
      return { eventId: m.event_id, athleteId: m.athlete_id, athleteName: name.get(m.athlete_id) ?? "", teamName: e?.team_id ? team.get(e.team_id) ?? null : null, startsAt: e?.starts_at ?? "" };
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, limit));
}
