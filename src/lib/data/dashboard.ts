import { createClient } from "@/lib/supabase/server";

/** Every query returns this so widgets can render a dedicated error state. */
export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });

const UNPAID: ("pending" | "draft" | "overdue")[] = ["pending", "draft", "overdue"];

function dayBounds(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString(), dateStr: start.toISOString().slice(0, 10) };
}

function uniq(ids: (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((x): x is string => Boolean(x))));
}

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

export async function getKpis(): Promise<Result<Kpis>> {
  const supabase = await createClient();
  const { dateStr, startISO, endISO } = dayBounds();
  const nowISO = new Date().toISOString();

  const [athletes, invoices, upcoming, today] = await Promise.all([
    supabase.from("athletes").select("family_id,status").eq("status", "active"),
    supabase.from("invoices").select("due_date,status").in("status", UNPAID),
    supabase.from("program_sessions").select("id", { count: "exact", head: true }).gte("starts_at", nowISO),
    supabase.from("attendance_sessions").select("id", { count: "exact", head: true }).gte("session_date", startISO).lt("session_date", endISO),
  ]);

  if (athletes.error) return fail(athletes.error.message);
  if (invoices.error) return fail(invoices.error.message);

  let open = 0;
  let overdue = 0;
  for (const inv of invoices.data ?? []) {
    const isOverdue = inv.status === "overdue" || (inv.due_date != null && inv.due_date < dateStr);
    if (isOverdue) overdue++;
    else open++;
  }

  return ok({
    activeAthletes: athletes.data?.length ?? 0,
    activeFamilies: uniq((athletes.data ?? []).map((a) => a.family_id)).length,
    openInvoices: open,
    overdueInvoices: overdue,
    upcomingSessions: upcoming.count ?? 0,
    sessionsToday: today.count ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Invoice summary (open / overdue amounts + paid count)
// ---------------------------------------------------------------------------
export type InvoiceSummary = {
  open: { count: number; total: number };
  overdue: { count: number; total: number };
  paidCount: number;
};

export async function getInvoiceSummary(): Promise<Result<InvoiceSummary>> {
  const supabase = await createClient();
  const { dateStr } = dayBounds();

  const [unpaid, paid] = await Promise.all([
    supabase.from("invoices").select("total_chf,due_date,status").in("status", UNPAID),
    supabase.from("invoices").select("id", { count: "exact", head: true }).eq("status", "paid"),
  ]);
  if (unpaid.error) return fail(unpaid.error.message);

  const summary: InvoiceSummary = {
    open: { count: 0, total: 0 },
    overdue: { count: 0, total: 0 },
    paidCount: paid.count ?? 0,
  };
  for (const inv of unpaid.data ?? []) {
    const bucket =
      inv.status === "overdue" || (inv.due_date != null && inv.due_date < dateStr)
        ? summary.overdue
        : summary.open;
    bucket.count++;
    bucket.total += Number(inv.total_chf ?? 0);
  }
  return ok(summary);
}

// ---------------------------------------------------------------------------
// Upcoming sessions
// ---------------------------------------------------------------------------
export type UpcomingSession = {
  id: string;
  startsAt: string;
  location: string | null;
  programName: string;
  coachName: string | null;
  coachId: string | null;
};

export async function getUpcomingSessions(limit = 5): Promise<Result<UpcomingSession[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("program_sessions")
    .select("id,starts_at,location,program_id,coach_id")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(limit);
  if (error) return fail(error.message);

  const programIds = uniq((data ?? []).map((s) => s.program_id));
  const coachIds = uniq((data ?? []).map((s) => s.coach_id));
  const [programs, coaches] = await Promise.all([
    programIds.length
      ? supabase.from("programs").select("id,name").in("id", programIds)
      : Promise.resolve({ data: [], error: null }),
    coachIds.length
      ? supabase.from("coaches").select("id,display_name").in("id", coachIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const pName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));
  const cName = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));

  return ok(
    (data ?? []).map((s) => ({
      id: s.id,
      startsAt: s.starts_at,
      location: s.location,
      programName: pName.get(s.program_id) ?? "Program",
      coachName: s.coach_id ? cName.get(s.coach_id) ?? null : null,
      coachId: s.coach_id ?? null,
    })),
  );
}

// ---------------------------------------------------------------------------
// Recent registrations
// ---------------------------------------------------------------------------
export type RecentRegistration = {
  id: string;
  status: string;
  createdAt: string;
  athleteName: string;
  programName: string;
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
      athleteName: aName.get(r.athlete_id) ?? "Athlete",
      programName: pName.get(r.program_id) ?? "Program",
    })),
  );
}

// ---------------------------------------------------------------------------
// Recent payments
// ---------------------------------------------------------------------------
export type RecentPayment = {
  id: string;
  amount: number;
  method: string;
  status: string;
  when: string;
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
    ? await supabase.from("invoices").select("id,number,family_id").in("id", invoiceIds)
    : { data: [] as { id: string; number: string; family_id: string }[], error: null };
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
        method: p.method,
        status: p.status,
        when: p.paid_at ?? p.created_at,
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

export async function getTodaysAttendance(): Promise<Result<TodaysAttendance>> {
  const supabase = await createClient();
  const { startISO, endISO } = dayBounds();
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
