import "server-only";
import { selectionDb, type AthleteEnrollmentRow, type RosterRow, type TournamentRow, type UnenrolledMemberRow } from "./db";
import { toDivision, toPackage, type DivisionView, type PackageView } from "./data";
import { programDivisionLabel, seriesKey, type ArrangementKind, type PaymentStatus } from "./arrangement";
import type { ApplicationStatus } from "./rules";

/**
 * Server-side reads for the selection roster (migration
 * 20250420102900_selection_roster.sql). The org always comes from the
 * session; the RPCs decide what each role sees (money only for finance and
 * the athlete's guardians). Every read returns `error` so pages can tell an
 * empty roster from a failed / refused request.
 */

export type RosterTournament = {
  id: string; name: string; stage: string | null; city: string | null; location: string | null; startsOn: string | null; endsOn: string | null;
  status: "covered" | "withdrawn"; withdrawnAt: string | null; note: string | null;
};
export type RosterEntry = {
  id: string; athleteId: string; name: string; firstName: string; lastName: string; birthYear: number | null;
  divisionId: string | null; divisionName: string | null; packageId: string | null; packageName: string | null;
  status: ApplicationStatus; source: string; tournaments: RosterTournament[]; tournamentsRequired: number | null;
  tournamentOverrideReason: string | null; arrangementKind: ArrangementKind | null; agreedFee: number | null; monthlyAmount: number | null;
  firstDueOn: string | null; installmentCount: number | null; currency: string | null; amountDue: number | null; received: number | null;
  balance: number | null; nextDueOn: string | null; overdue: boolean | null; overdueAmount: number | null;
  paymentStatus: PaymentStatus | null; showMoney: boolean; invoiceId: string | null; jerseyNumber: number | null; staffNotes: string | null;
  acceptedAt: string | null; enrolledAt: string | null; withdrawnAt: string | null; withdrawalReason: string | null;
  balanceAtWithdrawal: number | null; registrationOk: boolean | null; sponsored: number | null;
};

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

export function toTournaments(j: unknown): RosterTournament[] {
  if (!Array.isArray(j)) return [];
  return (j as Record<string, unknown>[]).map((t) => ({
    id: String(t.id), name: String(t.name ?? ""), stage: (t.stage as string | null) ?? null, city: (t.city as string | null) ?? null,
    location: (t.location as string | null) ?? null, startsOn: (t.starts_on as string | null) ?? null, endsOn: (t.ends_on as string | null) ?? null,
    status: t.status === "withdrawn" ? "withdrawn" : "covered", withdrawnAt: (t.withdrawn_at as string | null) ?? null, note: (t.note as string | null) ?? null,
  }));
}

function toEntry(r: RosterRow): RosterEntry {
  return {
    id: r.application_id, athleteId: r.athlete_id, name: `${r.first_name} ${r.last_name}`.trim(), firstName: r.first_name, lastName: r.last_name,
    birthYear: r.birth_year, divisionId: r.division_id, divisionName: r.division_name, packageId: r.package_id, packageName: r.package_name,
    status: r.status as ApplicationStatus, source: r.source, tournaments: toTournaments(r.tournaments), tournamentsRequired: r.tournaments_required,
    tournamentOverrideReason: r.tournament_override_reason, arrangementKind: (r.arrangement_kind as ArrangementKind | null) ?? null,
    agreedFee: num(r.agreed_fee), monthlyAmount: num(r.monthly_amount), firstDueOn: r.first_due_on, installmentCount: r.installment_count,
    currency: r.currency, amountDue: num(r.amount_due), received: num(r.received), balance: num(r.balance), nextDueOn: r.next_due_on,
    overdue: r.overdue, overdueAmount: num(r.overdue_amount), paymentStatus: (r.payment_status as PaymentStatus | null) ?? null,
    showMoney: r.show_money, invoiceId: r.invoice_id, jerseyNumber: r.jersey_number, staffNotes: r.staff_notes, acceptedAt: r.accepted_at,
    enrolledAt: r.enrolled_at, withdrawnAt: r.withdrawn_at, withdrawalReason: r.withdrawal_reason, balanceAtWithdrawal: num(r.balance_at_withdrawal),
    registrationOk: r.registration_ok, sponsored: num(r.sponsored),
  };
}

/** Players on a division team without a live enrolment (added by hand): staff create the enrolment. */
export type UnenrolledMember = {
  programId: string; divisionId: string; divisionName: string; teamName: string; athleteId: string; name: string;
  birthYear: number | null; jerseyNumber: number | null;
};
export async function getUnenrolledTeamMembers(programId: string | null): Promise<{ data: UnenrolledMember[]; error: string | null }> {
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_unenrolled_team_members", { p_program: programId });
  if (error) return { data: [], error: error.message };
  return {
    error: null,
    data: ((data ?? []) as UnenrolledMemberRow[]).map((r) => ({
      programId: r.program_id, divisionId: r.division_id, divisionName: r.division_name, teamName: r.team_name, athleteId: r.athlete_id,
      name: `${r.first_name} ${r.last_name}`.trim(), birthYear: r.birth_year, jerseyNumber: r.jersey_number,
    })),
  };
}

/** Roster of one programme (admin / finance / assigned coaches; SQL decides rows and money). */
export async function getRoster(programId: string): Promise<{ data: RosterEntry[]; error: string | null }> {
  try {
    const db = await selectionDb();
    const { data, error } = await db.rpc("selection_roster", { p_program: programId });
    if (error) return { data: [], error: error.message };
    return { data: ((data ?? []) as RosterRow[]).map(toEntry), error: null };
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export type TournamentView = {
  id: string; programId: string; divisionId: string | null; name: string; stage: string | null; city: string | null; location: string | null;
  startsOn: string | null; endsOn: string | null; sort: number; status: TournamentRow["status"];
};

export function toTournamentView(r: TournamentRow): TournamentView {
  return {
    id: r.id, programId: r.program_id, divisionId: r.division_id, name: r.name, stage: r.stage, city: r.city, location: r.location,
    startsOn: r.starts_on, endsOn: r.ends_on, sort: r.sort, status: r.status,
  };
}

/** Tournaments of the given programmes (club members read them; RLS). */
export async function getTournaments(orgId: string, programIds: string[]): Promise<{ data: TournamentView[]; error: string | null }> {
  if (!programIds.length) return { data: [], error: null };
  const db = await selectionDb();
  const { data, error } = await db.from("program_tournaments").select("*").eq("org_id", orgId).in("program_id", programIds)
    .order("sort").order("starts_on", { ascending: true, nullsFirst: false }).order("name");
  if (error) return { data: [], error: error.message };
  return { data: ((data ?? []) as TournamentRow[]).map(toTournamentView), error: null };
}

/** One selection programme with its set-up, as the enrolment form needs it. */
export type SeasonProgram = {
  id: string; name: string; seasonYear: number | null; season: string | null; series: string; currency: string | null;
  startsOn: string | null; isActive: boolean; status: string;
  /** Payment period: default first due date, and no instalment after the end. */
  paymentStartsOn: string | null; paymentEndsOn: string | null;
  divisions: (DivisionView & { label: string })[]; packages: (PackageView & { tournamentCount: number | null; monthlyAmount: number | null })[];
};

type ProgramLite = {
  id: string; name: string; slug: string | null; season: string | null; season_year: number | null; currency: string | null;
  starts_on: string | null; is_active: boolean; status: string; series?: string | null; selection_enabled: boolean; kind: string;
  payment_starts_on?: string | null; payment_ends_on?: string | null;
};

/**
 * Every selection programme of the club with divisions and packages, grouped
 * by series (seasons of the same programme), newest season first.
 */
export async function getSeasonPrograms(orgId: string): Promise<{ data: SeasonProgram[]; error: string | null }> {
  const db = await selectionDb();
  const { data: progs, error } = await db.from("programs").select("*").eq("org_id", orgId)
    .or("selection_enabled.eq.true,kind.eq.selection").order("season_year", { ascending: false, nullsFirst: false })
    .order("starts_on", { ascending: false, nullsFirst: false });
  if (error) return { data: [], error: error.message };
  const rows = (progs ?? []) as unknown as ProgramLite[];
  if (!rows.length) return { data: [], error: null };
  const ids = rows.map((p) => p.id);
  const [{ data: divs, error: e1 }, { data: pkgs, error: e2 }] = await Promise.all([
    db.from("program_divisions").select("*").eq("org_id", orgId).in("program_id", ids).order("sort").order("name"),
    db.from("program_packages").select("*").eq("org_id", orgId).in("program_id", ids).order("sort").order("price"),
  ]);
  if (e1 || e2) return { data: [], error: (e1 ?? e2)?.message ?? "error" };
  return {
    error: null,
    data: rows.map((p) => ({
      id: p.id, name: p.name, seasonYear: p.season_year, season: p.season, series: seriesKey(p), currency: p.currency,
      startsOn: p.starts_on, isActive: p.is_active, status: p.status,
      paymentStartsOn: p.payment_starts_on ?? null, paymentEndsOn: p.payment_ends_on ?? null,
      divisions: (divs ?? []).filter((d) => d.program_id === p.id).map((d) => ({ ...toDivision(d), label: programDivisionLabel(p.name, d.name) })),
      packages: (pkgs ?? []).filter((k) => k.program_id === p.id).map((k) => ({
        ...toPackage(k), tournamentCount: k.tournament_count ?? null, monthlyAmount: k.monthly_amount == null ? null : Number(k.monthly_amount),
      })),
    })),
  };
}

/** Programmes of the same series as `programId` (season selector), newest first. */
export function seasonsOf(all: SeasonProgram[], programId: string): SeasonProgram[] {
  const me = all.find((p) => p.id === programId);
  if (!me) return [];
  return all.filter((p) => p.series === me.series);
}

/** Staff notice: enrolled players without a confirmed programme registration. */
export type RosterHealth = { missing: { applicationId: string; programId: string; athlete: string }[]; recentFailures: number };
export async function getRosterHealth(programId: string | null): Promise<RosterHealth | null> {
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_roster_health", { p_program: programId });
  if (error || !data) return null;
  const j = data as { missing_registrations?: { application_id: string; program_id: string; athlete: string }[]; recent_failures?: number };
  return {
    missing: (j.missing_registrations ?? []).map((m) => ({ applicationId: m.application_id, programId: m.program_id, athlete: m.athlete })),
    recentFailures: Number(j.recent_failures ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Athlete profile card
// ---------------------------------------------------------------------------
export type AthleteEnrollment = {
  id: string; programId: string; programName: string; seasonYear: number | null; divisionName: string | null; packageName: string | null;
  label: string; status: ApplicationStatus; tournaments: RosterTournament[]; arrangementKind: ArrangementKind | null; agreedFee: number | null;
  monthlyAmount: number | null; currency: string | null; amountDue: number | null; received: number | null; balance: number | null;
  nextDueOn: string | null; overdue: boolean | null; paymentStatus: PaymentStatus | null; showMoney: boolean;
  withdrawnAt: string | null; withdrawalReason: string | null;
};

export async function getAthleteEnrollments(athleteId: string): Promise<{ data: AthleteEnrollment[]; error: string | null }> {
  try {
    const db = await selectionDb();
    const { data, error } = await db.rpc("selection_athlete_enrollments", { p_athlete: athleteId });
    if (error) return { data: [], error: error.message };
    return {
      error: null,
      data: ((data ?? []) as AthleteEnrollmentRow[]).map((r) => ({
        id: r.application_id, programId: r.program_id, programName: r.program_name, seasonYear: r.season_year, divisionName: r.division_name,
        packageName: r.package_name, label: programDivisionLabel(r.program_name, r.division_name), status: r.status as ApplicationStatus,
        tournaments: toTournaments(r.tournaments), arrangementKind: (r.arrangement_kind as ArrangementKind | null) ?? null,
        agreedFee: num(r.agreed_fee), monthlyAmount: num(r.monthly_amount), currency: r.currency, amountDue: num(r.amount_due),
        received: num(r.received), balance: num(r.balance), nextDueOn: r.next_due_on, overdue: r.overdue,
        paymentStatus: (r.payment_status as PaymentStatus | null) ?? null, showMoney: r.show_money, withdrawnAt: r.withdrawn_at,
        withdrawalReason: r.withdrawal_reason,
      })),
    };
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------------------------------------------------------------------------
// Payments of one enrolment (finance)
// ---------------------------------------------------------------------------
export type EnrollmentPayment = {
  id: string; amount: number; currency: string; method: string; paidAt: string | null; reference: string | null; note: string | null;
  voidedAt: string | null; voidReason: string | null; isReversal: boolean; isManual: boolean;
};
export type EnrollmentInstallment = { seq: number; dueOn: string; amount: number; status: string };

export async function getEnrollmentMoney(invoiceId: string): Promise<{ payments: EnrollmentPayment[]; installments: EnrollmentInstallment[]; invoiceNumber: string | null; error: string | null }> {
  const db = await selectionDb();
  const [{ data: pays, error: e1 }, { data: plans, error: e2 }, { data: inv }] = await Promise.all([
    db.from("payments").select("id,amount_chf,currency,method,paid_at,qr_reference,notes,voided_at,void_reason,reverses_payment_id,stripe_payment_intent_id,stripe_charge_id,status")
      .eq("invoice_id", invoiceId).order("paid_at", { ascending: true }),
    db.from("payment_plans").select("id,status").eq("invoice_id", invoiceId).eq("kind", "installments").in("status", ["active", "paused", "completed"]),
    db.from("invoices").select("number").eq("id", invoiceId).maybeSingle(),
  ]);
  if (e1 || e2) return { payments: [], installments: [], invoiceNumber: null, error: (e1 ?? e2)?.message ?? "error" };
  const planIds = ((plans ?? []) as { id: string }[]).map((p) => p.id);
  const { data: inst } = planIds.length
    ? await db.from("payment_plan_installments").select("seq,due_date,amount,status").in("plan_id", planIds).not("status", "in", "(cancelled,skipped)").order("seq")
    : { data: [] as { seq: number; due_date: string; amount: number; status: string }[] };
  type P = { id: string; amount_chf: number | string; currency: string; method: string; paid_at: string | null; qr_reference: string | null; notes: string | null;
    voided_at: string | null; void_reason: string | null; reverses_payment_id: string | null; stripe_payment_intent_id: string | null; stripe_charge_id: string | null; status: string };
  return {
    error: null,
    invoiceNumber: (inv as { number?: string } | null)?.number ?? null,
    payments: ((pays ?? []) as unknown as P[]).filter((p) => p.status === "succeeded").map((p) => ({
      id: p.id, amount: Number(p.amount_chf), currency: p.currency, method: p.method, paidAt: p.paid_at, reference: p.qr_reference, note: p.notes,
      voidedAt: p.voided_at, voidReason: p.void_reason, isReversal: !!p.reverses_payment_id,
      isManual: !p.stripe_payment_intent_id && !p.stripe_charge_id && !p.reverses_payment_id,
    })),
    installments: ((inst ?? []) as { seq: number; due_date: string; amount: number | string; status: string }[])
      .map((i) => ({ seq: i.seq, dueOn: i.due_date, amount: Number(i.amount), status: i.status })),
  };
}
