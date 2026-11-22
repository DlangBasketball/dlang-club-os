import "server-only";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { getRoster, getSeasonPrograms, getTournaments, type SeasonProgram, type TournamentView } from "@/lib/selection/roster";
import { financeReportsDb } from "./db";
import {
  toMembershipReportRow, toSeasonOverview, type MembershipReportFilters, type MembershipReportRow, type SeasonLite, type SeasonOverviewRow,
} from "./membership-report";
import type { SelectionPaymentRow } from "./selection-report";
import { toTransaction, type AccountingTransaction } from "./transactions";

/*
 * Finance reports — server-side reads. Every read runs with the caller's
 * session; the SQL functions re-check admin / finance and take the club from
 * the session (never from the client). Pages and export routes call
 * requireFinanceUser() first so a parent or coach gets nothing.
 */
export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T,>(data: T): Result<T> => ({ data, error: null });
const fail = <T,>(error: string): Result<T> => ({ data: null, error });

export type FinanceUser = { id: string; orgId: string; isAdmin: boolean };

/** The signed-in admin / finance user of a club, or null. */
export async function requireFinanceUser(): Promise<FinanceUser | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) return null;
  return { id: me.id, orgId: me.orgId, isAdmin: me.roles.includes("admin") };
}

export async function listReportSeasons(orgId: string): Promise<Result<SeasonLite[]>> {
  const db = await createClient();
  const { data, error } = await db.from("seasons").select("id,name,starts_on,ends_on,is_current").eq("org_id", orgId)
    .order("starts_on", { ascending: false }).limit(100);
  if (error) return fail(error.message);
  return ok((data ?? []).map((s) => ({ id: s.id, name: s.name, startsOn: s.starts_on, endsOn: s.ends_on, isCurrent: s.is_current })));
}

/** Teams of a season (and teams without a season), for the team filter. */
export async function listSeasonTeams(orgId: string, seasonId: string): Promise<Result<{ id: string; name: string }[]>> {
  const db = await createClient();
  const { data, error } = await db.from("teams").select("id,name,season_id").eq("org_id", orgId)
    .or(`season_id.eq.${seasonId},season_id.is.null`).order("name").limit(500);
  if (error) return fail(error.message);
  return ok(((data ?? []) as unknown as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name })));
}

export async function getMembershipMonthReport(f: MembershipReportFilters): Promise<Result<MembershipReportRow[]>> {
  if (!f.seasonId || !f.month) return ok([]);
  const db = await financeReportsDb();
  const { data, error } = await db.rpc("club_membership_month_report", {
    p_season: f.seasonId, p_month: `${f.month}-01`, p_team: f.teamId, p_status: f.status,
  });
  if (error) return fail(error.message);
  return ok((data ?? []).map(toMembershipReportRow));
}

export async function getSeasonOverview(seasonId: string, teamId: string | null): Promise<Result<SeasonOverviewRow[]>> {
  const db = await financeReportsDb();
  const { data, error } = await db.rpc("club_membership_season_overview", { p_season: seasonId, p_team: teamId });
  if (error) return fail(error.message);
  return ok(toSeasonOverview(data ?? []));
}

// ---------------------------------------------------------------------------
// Selection payments
// ---------------------------------------------------------------------------
export type SelectionReportData = { programs: SeasonProgram[]; tournaments: TournamentView[]; rows: SelectionPaymentRow[] };

/** Enrolments with money of one selection programme (roster RPC; finance sees money). */
export async function getSelectionPayments(orgId: string, programId: string | null): Promise<Result<SelectionReportData>> {
  const progs = await getSeasonPrograms(orgId);
  if (progs.error) return fail(progs.error);
  const programs = progs.data;
  const program = programs.find((p) => p.id === programId);
  if (!program) return ok({ programs, tournaments: [], rows: [] });
  const [roster, tours] = await Promise.all([getRoster(program.id), getTournaments(orgId, [program.id])]);
  if (roster.error) return fail(roster.error);
  if (tours.error) return fail(tours.error);
  const rows: SelectionPaymentRow[] = roster.data
    .filter((e) => e.status === "enrolled" || e.status === "accepted" || (e.status === "withdrawn" && !!e.invoiceId))
    .map((e) => ({
      applicationId: e.id, athleteName: e.name, programId: program.id, programName: program.name, series: program.series,
      divisionId: e.divisionId, divisionName: e.divisionName, packageName: e.packageName,
      tournaments: e.tournaments.filter((t) => t.status === "covered").map((t) => ({ id: t.id, name: t.name })),
      enrolmentStatus: e.status, arrangementKind: e.arrangementKind, installmentCount: e.installmentCount, monthlyAmount: e.monthlyAmount,
      currency: (e.currency ?? program.currency ?? "CHF").toUpperCase(), agreedFee: e.agreedFee ?? 0, amountDue: e.amountDue ?? 0,
      received: e.received ?? 0, balance: e.balance ?? 0, nextDueOn: e.nextDueOn, overdueAmount: e.overdueAmount ?? 0,
      paymentStatus: e.paymentStatus ?? "none", invoiceId: e.invoiceId,
    }));
  return ok({ programs, tournaments: tours.data, rows });
}

// ---------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------
export async function getAccountingTransactions(input: { from: string; to: string; entityId: string | null; category: string | null }): Promise<Result<AccountingTransaction[]>> {
  const db = await financeReportsDb();
  const { data, error } = await db.rpc("accounting_transactions", {
    p_from: input.from, p_to: input.to, p_entity: input.entityId, p_category: input.category,
  });
  if (error) return fail(error.message);
  return ok((data ?? []).map(toTransaction));
}

export type ExportRun = { kind: string; ok: boolean; exportedAt: string; rows: number | null };

/** Last run of every accounting export kind (from the audit log). */
export async function getLastExports(): Promise<Result<ExportRun[]>> {
  const db = await financeReportsDb();
  const { data, error } = await db.rpc("accounting_last_exports");
  if (error) return fail(error.message);
  return ok((data ?? []).map((r) => {
    const d = (r.details ?? {}) as Record<string, unknown>;
    const rows = typeof d.rows === "number" ? d.rows : typeof d.lines === "number" ? d.lines : null;
    return { kind: r.kind, ok: r.ok, exportedAt: r.exported_at, rows };
  }).sort((a, b) => b.exportedAt.localeCompare(a.exportedAt)));
}
