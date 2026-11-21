import "server-only";
import { cache } from "react";
import { selectionAdminDb, selectionDb, type ApplicationRow, type DivisionRow, type PackageRow, type ReportRow, type ReviewRow, type SelectionClient } from "./db";
import { normaliseCounts, type ApplicationStatus, type DivisionRule, type PackageRule } from "./rules";
import { getPublicProgram, type PublicConsent } from "@/lib/data/public-registration";
import type { ReportFilters } from "./report";

/** Server-side reads for selection programmes. Org always from the caller (session) or the public slug. */

export type SelectionProgram = {
  id: string; orgId: string; slug: string | null; name: string; kind: string; description: string | null;
  currency: string | null; status: string; isPublic: boolean; isActive: boolean; selectionEnabled: boolean;
  requiresApproval: boolean; allowNonMembers: boolean; seasonYear: number | null; startsOn: string | null; endsOn: string | null;
  open: boolean;
};
export type DivisionView = DivisionRule & { teamId: string | null; capacity: number | null };
export type PackageView = PackageRule & { description: string | null; sort: number; isActive: boolean };
export type CoachAssignment = { id: string; coachId: string; coachName: string; divisionId: string | null; role: "head" | "assistant" };
export type SelectionSetup = { program: SelectionProgram; divisions: DivisionView[]; packages: PackageView[]; coaches: CoachAssignment[] };

const PROGRAM_COLS =
  "id,org_id,slug,name,kind,description,currency,status,is_public,is_active,selection_enabled,requires_approval,allow_non_members,season_year,starts_on,ends_on,registration_opens_at,registration_closes_at";

type ProgramDb = {
  id: string; org_id: string; slug: string | null; name: string; kind: string; description: string | null; currency: string | null;
  status: string; is_public: boolean; is_active: boolean; selection_enabled: boolean; requires_approval: boolean; allow_non_members: boolean;
  season_year: number | null; starts_on: string | null; ends_on: string | null; registration_opens_at: string | null; registration_closes_at: string | null;
};

function toProgram(r: ProgramDb, now = Date.now()): SelectionProgram {
  const inWindow = !(r.registration_opens_at && now < Date.parse(r.registration_opens_at))
    && !(r.registration_closes_at && now >= Date.parse(r.registration_closes_at));
  return {
    id: r.id, orgId: r.org_id, slug: r.slug, name: r.name, kind: r.kind, description: r.description, currency: r.currency,
    status: r.status, isPublic: r.is_public, isActive: r.is_active, selectionEnabled: r.selection_enabled,
    requiresApproval: r.requires_approval, allowNonMembers: r.allow_non_members, seasonYear: r.season_year,
    startsOn: r.starts_on, endsOn: r.ends_on,
    open: r.selection_enabled && r.is_active && r.status === "published" && inWindow,
  };
}

export function toDivision(r: DivisionRow): DivisionView {
  return {
    id: r.id, name: r.name, minBirthYear: r.min_birth_year, maxBirthYear: r.max_birth_year, ageUnder: r.age_under,
    ageCutoff: r.age_cutoff, sort: r.sort, isActive: r.is_active, teamId: r.team_id, capacity: r.capacity,
  };
}

export function toPackage(r: PackageRow): PackageView {
  return {
    id: r.id, name: r.name, description: r.description, price: Number(r.price), allowedCounts: normaliseCounts(r.allowed_counts ?? [1]),
    showMonthly: r.show_monthly, sort: r.sort, isActive: r.is_active,
  };
}

async function programs(db: SelectionClient, orgId: string, ids?: string[]): Promise<SelectionProgram[]> {
  let q = db.from("programs").select(PROGRAM_COLS).eq("org_id", orgId).or("selection_enabled.eq.true,kind.eq.selection");
  if (ids) q = q.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q.order("starts_on", { ascending: false, nullsFirst: false }).order("name");
  return ((data ?? []) as unknown as ProgramDb[]).map((r) => toProgram(r));
}

async function setupFor(db: SelectionClient, orgId: string, program: SelectionProgram): Promise<SelectionSetup> {
  const [{ data: divs }, { data: pkgs }, { data: pcs }] = await Promise.all([
    db.from("program_divisions").select("*").eq("org_id", orgId).eq("program_id", program.id).order("sort").order("name"),
    db.from("program_packages").select("*").eq("org_id", orgId).eq("program_id", program.id).order("sort").order("price"),
    db.from("program_coaches").select("*").eq("org_id", orgId).eq("program_id", program.id),
  ]);
  const coachIds = Array.from(new Set((pcs ?? []).map((c) => c.coach_id)));
  const { data: coaches } = coachIds.length
    ? await db.from("coaches").select("id,display_name").in("id", coachIds)
    : { data: [] as { id: string; display_name: string }[] };
  const names = new Map((coaches ?? []).map((c) => [c.id, c.display_name]));
  return {
    program,
    divisions: (divs ?? []).map(toDivision),
    packages: (pkgs ?? []).map(toPackage),
    coaches: (pcs ?? []).map((c) => ({ id: c.id, coachId: c.coach_id, coachName: names.get(c.coach_id) ?? "—", divisionId: c.division_id, role: c.role })),
  };
}

/** Admin / finance: the club's selection programmes. */
export async function getSelectionPrograms(orgId: string): Promise<SelectionProgram[]> {
  return programs(await selectionDb(), orgId);
}

/** Set-up of one programme (any member of the club can read it; RLS). */
export async function getSelectionSetup(orgId: string, programId: string): Promise<SelectionSetup | null> {
  const db = await selectionDb();
  const [p] = await programs(db, orgId, [programId]);
  if (!p) {
    // A programme not yet switched to selection (admin enabling it).
    const { data } = await db.from("programs").select(PROGRAM_COLS).eq("org_id", orgId).eq("id", programId).maybeSingle();
    if (!data) return null;
    return setupFor(db, orgId, toProgram(data as unknown as ProgramDb));
  }
  return setupFor(db, orgId, p);
}

export type ReviewItem = {
  id: string; status: ApplicationStatus; divisionId: string | null; divisionName: string | null; packageId: string | null;
  packageName: string | null; athleteId: string; name: string; birthYear: number | null; dob: string | null; position: string | null;
  currentClub: string | null; notes: string | null; videoUrl: string | null; isMember: boolean; decisionNote: string | null;
  staffNotes: string | null; invoiceId: string | null; installmentCount: number | null; sponsorshipKind: string | null;
  sponsorshipPercent: number | null; appliedAt: string; reviewedAt: string | null;
};

function toReview(r: ReviewRow): ReviewItem {
  return {
    id: r.application_id, status: r.status as ApplicationStatus, divisionId: r.division_id, divisionName: r.division_name,
    packageId: r.package_id, packageName: r.package_name, athleteId: r.athlete_id, name: `${r.first_name} ${r.last_name}`.trim(),
    birthYear: r.birth_year, dob: r.dob, position: r.player_position, currentClub: r.current_club, notes: r.notes, videoUrl: r.video_url,
    isMember: r.is_member, decisionNote: r.decision_note, staffNotes: r.staff_notes, invoiceId: r.invoice_id,
    installmentCount: r.installment_count, sponsorshipKind: r.sponsorship_kind && r.sponsorship_kind !== "none" ? r.sponsorship_kind : null,
    sponsorshipPercent: r.sponsorship_percent == null ? null : Number(r.sponsorship_percent), appliedAt: r.applied_at, reviewedAt: r.reviewed_at,
  };
}

/** Applications to review (admin / finance / the programme's assigned coaches; SQL decides). */
export async function getReviewList(programId: string): Promise<{ data: ReviewItem[]; error: string | null }> {
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_review_list", { p_program: programId });
  return { data: ((data ?? []) as ReviewRow[]).map(toReview), error: error?.message ?? null };
}

/** Programmes the signed-in coach reviews. */
export async function getCoachSelectionPrograms(orgId: string, profileId: string): Promise<SelectionProgram[]> {
  const db = await selectionDb();
  const { data: me } = await db.from("coaches").select("id").eq("org_id", orgId).eq("profile_id", profileId);
  const ids = (me ?? []).map((c) => c.id);
  if (!ids.length) return [];
  const { data: pcs } = await db.from("program_coaches").select("program_id").eq("org_id", orgId).in("coach_id", ids);
  const progIds = Array.from(new Set((pcs ?? []).map((p) => p.program_id)));
  return progIds.length ? programs(db, orgId, progIds) : [];
}

// ---------------------------------------------------------------------------
// Stats and report (finance)
// ---------------------------------------------------------------------------
export type DivisionStats = { divisionId: string | null; name: string; applicants: number; pending: number; accepted: number; enrolled: number; waitlisted: number; declined: number };
export type ProgramStats = {
  programId: string; name: string; slug: string | null; seasonYear: number | null; currency: string;
  invoiced: number; collected: number; outstanding: number; sponsored: number;
  applicants: number; accepted: number; enrolled: number; divisions: DivisionStats[];
};

export async function getProgramStats(programId?: string | null): Promise<{ data: ProgramStats[]; error: string | null }> {
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_program_stats", { p_program: programId ?? null });
  if (error) return { data: [], error: error.message };
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const n = (v: unknown) => Number(v ?? 0);
  return {
    error: null,
    data: rows.map((r) => ({
      programId: String(r.program_id), name: String(r.name ?? ""), slug: (r.slug as string | null) ?? null,
      seasonYear: r.season_year == null ? null : n(r.season_year), currency: String(r.currency ?? "CHF"),
      invoiced: n(r.invoiced), collected: n(r.collected), outstanding: n(r.outstanding), sponsored: n(r.sponsored),
      applicants: n(r.applicants), accepted: n(r.accepted), enrolled: n(r.enrolled),
      divisions: ((r.divisions as Record<string, unknown>[] | null) ?? []).map((d) => ({
        divisionId: (d.division_id as string | null) ?? null, name: String(d.name ?? ""), applicants: n(d.applicants), pending: n(d.pending),
        accepted: n(d.accepted), enrolled: n(d.enrolled), waitlisted: n(d.waitlisted), declined: n(d.declined),
      })),
    })),
  };
}

export type { ReportFilters };
export type ReportLine = {
  applicationId: string; programId: string; programName: string; seasonYear: number | null; divisionName: string | null;
  packageName: string | null; athleteName: string; birthYear: number | null; familyName: string; isMember: boolean; currentClub: string | null;
  status: ApplicationStatus; currency: string; invoiceNumber: string | null; invoiced: number; sponsored: number; collected: number;
  outstanding: number; installmentCount: number | null; appliedAt: string; acceptedAt: string | null; enrolledAt: string | null;
};

export async function getSelectionReport(f: ReportFilters): Promise<{ data: ReportLine[]; error: string | null }> {
  const db = await selectionDb();
  const { data, error } = await db.rpc("selection_report", {
    p_program: f.programId ?? null, p_season: f.season ?? null, p_division: f.divisionId ?? null, p_package: f.packageId ?? null,
  });
  if (error) return { data: [], error: error.message };
  return {
    error: null,
    data: ((data ?? []) as ReportRow[]).map((r) => ({
      applicationId: r.application_id, programId: r.program_id, programName: r.program_name, seasonYear: r.season_year,
      divisionName: r.division_name, packageName: r.package_name, athleteName: r.athlete_name, birthYear: r.birth_year,
      familyName: r.family_name, isMember: r.is_member, currentClub: r.current_club, status: r.status as ApplicationStatus,
      currency: r.currency, invoiceNumber: r.invoice_number, invoiced: Number(r.invoiced), sponsored: Number(r.sponsored),
      collected: Number(r.collected), outstanding: Number(r.outstanding), installmentCount: r.installment_count,
      appliedAt: r.applied_at, acceptedAt: r.accepted_at, enrolledAt: r.enrolled_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Parent app
// ---------------------------------------------------------------------------
export type FamilyApplication = {
  id: string; programId: string; status: ApplicationStatus; divisionId: string | null; packageId: string | null; athleteId: string;
  athleteName: string; decisionNote: string | null; invoiceId: string | null; invoiceStatus: string | null; currency: string | null;
  amountDue: number; paid: number; hasPlan: boolean; installmentCount: number | null; appliedAt: string;
};
export type ParentChild = { id: string; name: string; dob: string | null; familyId: string };

/** The signed-in guardian's own children in the current club (family links, never all athletes an admin can read). */
export async function getMyChildren(profileId: string, orgId: string): Promise<ParentChild[]> {
  const db = await selectionDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", profileId);
  const familyIds = (links ?? []).map((l) => l.family_id);
  if (!familyIds.length) return [];
  const { data } = await db.from("athletes").select("id,first_name,last_name,dob,family_id,status")
    .eq("org_id", orgId).in("family_id", familyIds).neq("status", "archived").order("first_name");
  return (data ?? []).filter((a) => a.status !== "inactive")
    .map((a) => ({ id: a.id, name: `${a.first_name} ${a.last_name}`.trim(), dob: a.dob, familyId: a.family_id }));
}

/** The family's applications (RLS: own family only for guardians). */
export async function getFamilyApplications(orgId: string, familyIds: string[], programId?: string): Promise<FamilyApplication[]> {
  if (!familyIds.length) return [];
  const db = await selectionDb();
  let q = db.from("program_applications").select("*").eq("org_id", orgId).in("family_id", familyIds);
  if (programId) q = q.eq("program_id", programId);
  const { data: apps } = await q.order("created_at", { ascending: false });
  const rows = (apps ?? []) as ApplicationRow[];
  if (!rows.length) return [];
  const athIds = Array.from(new Set(rows.map((a) => a.athlete_id)));
  const invIds = rows.map((a) => a.invoice_id).filter((x): x is string => !!x);
  const [{ data: aths }, { data: invs }, { data: plans }] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name").in("id", athIds),
    invIds.length ? db.from("invoices").select("id,status,currency,total_chf,adjustments_total").in("id", invIds) : Promise.resolve({ data: [] }),
    invIds.length ? db.from("payment_plans").select("invoice_id,status").in("invoice_id", invIds).eq("kind", "installments") : Promise.resolve({ data: [] }),
  ]);
  const paidRes = invIds.length ? await db.from("payments").select("invoice_id,amount_chf,status").in("invoice_id", invIds) : { data: [] };
  const names = new Map((aths ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`.trim()]));
  type Inv = { id: string; status: string; currency: string; total_chf: number | string; adjustments_total?: number | string | null };
  const inv = new Map(((invs ?? []) as Inv[]).map((i) => [i.id, i]));
  const paid = new Map<string, number>();
  for (const p of (paidRes.data ?? []) as { invoice_id: string; amount_chf: number | string; status: string }[]) {
    if (p.status === "succeeded") paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + Number(p.amount_chf));
  }
  const planned = new Set(((plans ?? []) as { invoice_id: string; status: string }[])
    .filter((p) => p.status === "active" || p.status === "paused" || p.status === "completed").map((p) => p.invoice_id));
  return rows.map((a) => {
    const i = a.invoice_id ? inv.get(a.invoice_id) : undefined;
    return {
      id: a.id, programId: a.program_id, status: a.status as ApplicationStatus, divisionId: a.division_id, packageId: a.package_id,
      athleteId: a.athlete_id, athleteName: names.get(a.athlete_id) ?? "—", decisionNote: a.decision_note, invoiceId: a.invoice_id,
      invoiceStatus: i?.status ?? null, currency: i?.currency ?? null,
      amountDue: i ? Number(i.total_chf) + Number(i.adjustments_total ?? 0) : 0,
      paid: a.invoice_id ? paid.get(a.invoice_id) ?? 0 : 0, hasPlan: a.invoice_id ? planned.has(a.invoice_id) : false,
      installmentCount: a.installment_count, appliedAt: a.created_at,
    };
  });
}

/** Open selection programmes of the club (parent app). */
export async function getOpenSelectionPrograms(orgId: string): Promise<SelectionProgram[]> {
  return (await programs(await selectionDb(), orgId)).filter((p) => p.open);
}

// ---------------------------------------------------------------------------
// Public page (no session: service role, only a public + published programme)
// ---------------------------------------------------------------------------
export type PublicSelection = SelectionSetup & { consents: PublicConsent[] };

export const getPublicSelection = cache(async (slug: string): Promise<PublicSelection | null> => {
  const db = selectionAdminDb();
  const { data } = await db.from("programs").select(PROGRAM_COLS).eq("slug", slug).eq("is_public", true).eq("selection_enabled", true).maybeSingle();
  if (!data) return null;
  const program = toProgram(data as unknown as ProgramDb);
  if (!program.open) return null;
  const setup = await setupFor(db, program.orgId, program);
  const pub = await getPublicProgram(slug);
  return {
    ...setup,
    divisions: setup.divisions.filter((d) => d.isActive),
    packages: setup.packages.filter((p) => p.isActive),
    coaches: [],
    consents: pub?.consents ?? [],
  };
});
