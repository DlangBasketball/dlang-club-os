import "server-only";
import { caAdminDb, caDb, type CertificateRow, type ClubAdminSettingsRow, type IncidentRow, type MembershipRow, type MembershipTypeRow, type WaitlistRow } from "./db";
import { DEFAULT_MANDATORY, DEFAULT_REMINDER_DAYS, type CertKind } from "./compliance";
import { isExpiringSoon, effectiveStatus, type MembershipStatus } from "./membership";
import { HIDDEN_ATHLETE_STATUS_FILTER, VISIBLE_FAMILY_STATUS, isHiddenAthleteStatus } from "@/lib/people/person-delete";
import { must } from "@/lib/data/must";
import { asBillingClient } from "@/lib/people/billing-athletes";

/**
 * Server reads for the club-admin pages. Everything goes through the signed-
 * in user's client (RLS decides) except where noted; every query is also
 * filtered by the session org.
 */
export type Settings = {
  waitlistOfferHours: number; waitlistAutoOffer: boolean; membershipRenewalWindowDays: number;
  jsEnabled: boolean; jsClubNumber: string | null; jsAgeMin: number; jsAgeMax: number; jsRatePerParticipantHour: number | null;
  complianceBlockYouth: boolean; complianceMandatoryKinds: CertKind[]; complianceReminderDays: number[];
};

export function toSettings(r: Partial<ClubAdminSettingsRow> | null): Settings {
  return {
    waitlistOfferHours: r?.waitlist_offer_hours ?? 48,
    waitlistAutoOffer: r?.waitlist_auto_offer ?? true,
    membershipRenewalWindowDays: r?.membership_renewal_window_days ?? 30,
    jsEnabled: r?.js_enabled ?? false,
    jsClubNumber: r?.js_club_number ?? null,
    jsAgeMin: r?.js_age_min ?? 5,
    jsAgeMax: r?.js_age_max ?? 20,
    jsRatePerParticipantHour: r?.js_rate_per_participant_hour != null ? Number(r.js_rate_per_participant_hour) : null,
    complianceBlockYouth: r?.compliance_block_youth ?? false,
    complianceMandatoryKinds: (r?.compliance_mandatory_kinds as CertKind[] | undefined) ?? DEFAULT_MANDATORY,
    complianceReminderDays: r?.compliance_reminder_days ?? DEFAULT_REMINDER_DAYS,
  };
}

/** Settings with defaults. Service read (any role's page may need the numbers; no personal data). */
export async function getClubAdminSettings(orgId: string): Promise<Settings> {
  const { data } = await caAdminDb().from("club_admin_settings").select("*").eq("org_id", orgId).maybeSingle();
  return toSettings(data as ClubAdminSettingsRow | null);
}

type Named = { id: string; name: string };
const fullName = (a: { first_name: string; last_name: string }) => `${a.first_name} ${a.last_name}`.trim();

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------
export type MembershipView = MembershipRow & {
  typeName: string; familyName: string; athleteName: string | null; renewed: boolean; effective: MembershipStatus; invoiceNumber: string | null;
};

export async function listMembershipTypes(orgId: string): Promise<MembershipTypeRow[]> {
  return must(await (await caDb()).from("membership_types").select("*").eq("org_id", orgId).order("sort").order("name"), "membership types") as MembershipTypeRow[];
}

async function decorateMemberships(orgId: string, rows: MembershipRow[], today: string): Promise<MembershipView[]> {
  const db = await caDb();
  const famIds = Array.from(new Set(rows.map((m) => m.family_id)));
  const athIds = Array.from(new Set(rows.map((m) => m.athlete_id).filter((x): x is string => !!x)));
  const invIds = Array.from(new Set(rows.map((m) => m.invoice_id).filter((x): x is string => !!x)));
  const [types, fams, aths, invs, renewals] = await Promise.all([
    listMembershipTypes(orgId),
    famIds.length ? db.from("families").select("id,name,status").in("id", famIds) : Promise.resolve({ data: [] as (Named & { status: string })[] }),
    // Billing columns only (finance reaches this list): billing_athletes, never the athletes table.
    athIds.length ? asBillingClient(db).from("billing_athletes").select("id,first_name,last_name,status").in("id", athIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string; status: string }[] }),
    invIds.length ? db.from("invoices").select("id,number").in("id", invIds) : Promise.resolve({ data: [] as { id: string; number: string }[] }),
    rows.length ? db.from("memberships").select("renewed_from_id").eq("org_id", orgId).in("renewed_from_id", rows.map((r) => r.id)).neq("status", "cancelled") : Promise.resolve({ data: [] as { renewed_from_id: string | null }[] }),
  ]);
  const tn = new Map(types.map((t) => [t.id, t.name]));
  const fn = new Map(((fams.data ?? []) as Named[]).map((f) => [f.id, f.name]));
  const an = new Map(((aths.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => [a.id, fullName(a)]));
  const inv = new Map(((invs.data ?? []) as { id: string; number: string }[]).map((i) => [i.id, i.number]));
  const renewed = new Set(((renewals.data ?? []) as { renewed_from_id: string | null }[]).map((r) => r.renewed_from_id));
  // Memberships of archived / erased people are hidden (Recently deleted).
  const hiddenFam = new Set(((fams.data ?? []) as { id: string; status?: string }[]).filter((f) => f.status && f.status !== VISIBLE_FAMILY_STATUS).map((f) => f.id));
  const hiddenAth = new Set(((aths.data ?? []) as { id: string; status?: string }[]).filter((a) => isHiddenAthleteStatus(a.status)).map((a) => a.id));
  return rows.filter((m) => !hiddenFam.has(m.family_id) && !(m.athlete_id && hiddenAth.has(m.athlete_id))).map((m) => ({
    ...m,
    typeName: tn.get(m.membership_type_id) ?? "—",
    familyName: fn.get(m.family_id) ?? "—",
    athleteName: m.athlete_id ? an.get(m.athlete_id) ?? null : null,
    renewed: renewed.has(m.id),
    effective: effectiveStatus(m, today),
    invoiceNumber: m.invoice_id ? inv.get(m.invoice_id) ?? null : null,
  }));
}

export async function listMemberships(orgId: string, today: string, status?: string | null): Promise<MembershipView[]> {
  let q = (await caDb()).from("memberships").select("*").eq("org_id", orgId).order("valid_until", { ascending: false }).limit(500);
  if (status && ["pending_payment", "active", "expired", "cancelled"].includes(status)) q = q.eq("status", status as MembershipRow["status"]);
  const data = must(await q, "memberships");
  return decorateMemberships(orgId, data as MembershipRow[], today);
}

export function expiring(rows: MembershipView[], today: string, windowDays: number): MembershipView[] {
  return rows.filter((m) => isExpiringSoon({ status: m.effective, valid_until: m.valid_until, renewed: m.renewed }, today, windowDays))
    .sort((a, b) => a.valid_until.localeCompare(b.valid_until));
}

export async function familyAndAthleteOptions(orgId: string): Promise<{ families: Named[]; athletes: (Named & { familyId: string })[] }> {
  const db = await caDb();
  const [{ data: fams }, { data: aths }] = await Promise.all([
    db.from("families").select("id,name").eq("org_id", orgId).eq("status", VISIBLE_FAMILY_STATUS).order("name").limit(2000),
    db.from("athletes").select("id,first_name,last_name,family_id").eq("org_id", orgId).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).order("last_name").limit(3000),
  ]);
  return {
    families: (fams ?? []) as Named[],
    athletes: ((aths ?? []) as { id: string; first_name: string; last_name: string; family_id: string }[]).map((a) => ({ id: a.id, name: fullName(a), familyId: a.family_id })),
  };
}

/** Parent: their families, children, memberships and the club's active types. */
export async function parentMembershipView(orgId: string, profileId: string, today: string) {
  const db = await caDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", profileId);
  const famIds = (links ?? []).map((l) => l.family_id);
  const [{ data: fams }, { data: kids }, { data: ms }, types] = await Promise.all([
    famIds.length ? db.from("families").select("id,name").eq("org_id", orgId).in("id", famIds) : Promise.resolve({ data: [] as Named[] }),
    famIds.length ? db.from("athletes").select("id,first_name,last_name,family_id,dob").eq("org_id", orgId).in("family_id", famIds).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER) : Promise.resolve({ data: [] }),
    famIds.length ? db.from("memberships").select("*").eq("org_id", orgId).in("family_id", famIds).order("valid_until", { ascending: false }) : Promise.resolve({ data: [] }),
    listMembershipTypes(orgId),
  ]);
  return {
    families: (fams ?? []) as Named[],
    children: ((kids ?? []) as { id: string; first_name: string; last_name: string; family_id: string; dob: string }[]),
    memberships: await decorateMemberships(orgId, (ms ?? []) as MembershipRow[], today),
    types: types.filter((t) => t.is_active),
  };
}

// ---------------------------------------------------------------------------
// Waiting lists
// ---------------------------------------------------------------------------
export type WaitlistGroup = {
  key: string; kind: WaitlistRow["target_kind"]; name: string; detail: string | null; capacity: number | null; taken: number;
  entries: (WaitlistRow & { athleteName: string; familyName: string })[];
};

async function targetsFor(rows: WaitlistRow[]) {
  const db = await caDb();
  const progIds = Array.from(new Set(rows.map((r) => r.program_id).filter((x): x is string => !!x)));
  const edIds = Array.from(new Set(rows.map((r) => r.camp_edition_id).filter((x): x is string => !!x)));
  const svcIds = Array.from(new Set(rows.map((r) => r.service_id).filter((x): x is string => !!x)));
  const [progs, eds, svcs] = await Promise.all([
    progIds.length ? db.from("programs").select("id,name,capacity").in("id", progIds) : Promise.resolve({ data: [] }),
    edIds.length ? db.from("camp_editions").select("id,name,starts_on,ends_on,capacity").in("id", edIds) : Promise.resolve({ data: [] }),
    svcIds.length ? db.from("training_services").select("id,name,max_participants").in("id", svcIds) : Promise.resolve({ data: [] }),
  ]);
  return {
    progs: new Map(((progs.data ?? []) as { id: string; name: string; capacity: number | null }[]).map((p) => [p.id, p])),
    eds: new Map(((eds.data ?? []) as { id: string; name: string | null; starts_on: string; ends_on: string; capacity: number | null }[]).map((e) => [e.id, e])),
    svcs: new Map(((svcs.data ?? []) as { id: string; name: string; max_participants: number }[]).map((s) => [s.id, s])),
  };
}

/** Admin: every list with open entries (and recent history), grouped. */
export async function listWaitlists(orgId: string, includeClosed = false): Promise<WaitlistGroup[]> {
  const db = await caDb();
  let q = db.from("waitlist_entries").select("*").eq("org_id", orgId).order("position").order("created_at").limit(2000);
  if (!includeClosed) q = q.in("status", ["waiting", "offered"]);
  const data = must(await q, "waitlists");
  const rows = (data ?? []) as WaitlistRow[];
  if (!rows.length) return [];
  const athIds = Array.from(new Set(rows.map((r) => r.athlete_id)));
  const famIds = Array.from(new Set(rows.map((r) => r.family_id)));
  const [{ data: aths }, { data: fams }, t] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name,status").in("id", athIds),
    db.from("families").select("id,name").in("id", famIds),
    targetsFor(rows),
  ]);
  const hiddenAth = new Set(((aths ?? []) as { id: string; status?: string }[]).filter((a) => isHiddenAthleteStatus(a.status)).map((a) => a.id));
  const an = new Map(((aths ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => [a.id, fullName(a)]));
  const fn = new Map(((fams ?? []) as Named[]).map((f) => [f.id, f.name]));
  const groups = new Map<string, WaitlistGroup>();
  for (const r of rows) {
    if (hiddenAth.has(r.athlete_id)) continue;
    let g = groups.get(r.target_key);
    if (!g) {
      const prog = r.program_id ? t.progs.get(r.program_id) : undefined;
      const ed = r.camp_edition_id ? t.eds.get(r.camp_edition_id) : undefined;
      const svc = r.service_id ? t.svcs.get(r.service_id) : undefined;
      g = {
        key: r.target_key, kind: r.target_kind,
        name: r.target_kind === "training_slot" ? svc?.name ?? "—" : prog?.name ?? "—",
        detail: ed ? `${ed.starts_on}/${ed.ends_on}` : r.slot_start,
        capacity: r.target_kind === "camp_edition" ? ed?.capacity ?? null : r.target_kind === "training_slot" ? svc?.max_participants ?? null : prog?.capacity ?? null,
        taken: 0, entries: [],
      };
      groups.set(r.target_key, g);
    }
    g.entries.push({ ...r, athleteName: an.get(r.athlete_id) ?? "—", familyName: fn.get(r.family_id) ?? "—" });
  }
  // taken spots per list (service count; no personal data)
  const admin = caAdminDb();
  for (const g of groups.values()) {
    const e = g.entries[0];
    if (g.kind === "program" && e.program_id) {
      const { count } = await admin.from("registrations").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("program_id", e.program_id).is("camp_edition_id", null).in("status", ["pending", "confirmed"]);
      g.taken = count ?? 0;
    } else if (g.kind === "camp_edition" && e.camp_edition_id) {
      const { count } = await admin.from("registrations").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("camp_edition_id", e.camp_edition_id).in("status", ["pending", "confirmed"]);
      g.taken = count ?? 0;
    } else if (e.service_id && e.coach_id && e.slot_start) {
      const { count } = await admin.from("training_bookings").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("service_id", e.service_id).eq("coach_id", e.coach_id).eq("slot_start", e.slot_start).in("status", ["booked", "completed"]);
      g.taken = count ?? 0;
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type JoinTarget = { kind: "program" | "camp_edition"; id: string; name: string; detail: string | null; programId: string; full: boolean };

/** Programmes and camp weeks a family can wait for (published; capacity set). */
export async function waitlistTargets(orgId: string, today: string): Promise<{ targets: JoinTarget[]; options: Record<string, { id: string; label: string }[]>; groups: Record<string, { id: string; label: string }[]> }> {
  const admin = caAdminDb();
  const [{ data: progs }, { data: eds }] = await Promise.all([
    admin.from("programs").select("id,name,capacity,kind,status,ends_on").eq("org_id", orgId).eq("status", "published").not("capacity", "is", null).neq("kind", "camp").limit(500),
    admin.from("camp_editions").select("id,program_id,name,starts_on,ends_on,capacity,status").eq("org_id", orgId).eq("status", "published").gte("ends_on", today).not("capacity", "is", null).limit(500),
  ]);
  const targets: JoinTarget[] = [];
  for (const p of (progs ?? []) as { id: string; name: string; capacity: number; ends_on: string | null }[]) {
    if (p.ends_on && p.ends_on < today) continue;
    const { count } = await admin.from("registrations").select("id", { count: "exact", head: true }).eq("program_id", p.id).is("camp_edition_id", null).in("status", ["pending", "confirmed"]);
    targets.push({ kind: "program", id: p.id, name: p.name, detail: null, programId: p.id, full: (count ?? 0) >= p.capacity });
  }
  const edRows = (eds ?? []) as { id: string; program_id: string; name: string | null; starts_on: string; ends_on: string; capacity: number }[];
  const progIds = Array.from(new Set(edRows.map((e) => e.program_id)));
  const [{ data: campProgs }, { data: opts }, { data: grps }] = await Promise.all([
    progIds.length ? admin.from("programs").select("id,name").in("id", progIds).eq("status", "published") : Promise.resolve({ data: [] as Named[] }),
    progIds.length ? admin.from("camp_price_options").select("id,program_id,edition_id,label,is_active,sort").in("program_id", progIds).eq("is_active", true).order("sort") : Promise.resolve({ data: [] }),
    progIds.length ? admin.from("camp_age_groups").select("id,program_id,label,is_active,sort").in("program_id", progIds).eq("is_active", true).order("sort") : Promise.resolve({ data: [] }),
  ]);
  const pn = new Map(((campProgs ?? []) as Named[]).map((p) => [p.id, p.name]));
  for (const e of edRows) {
    if (!pn.has(e.program_id)) continue;
    const { count } = await admin.from("registrations").select("id", { count: "exact", head: true }).eq("camp_edition_id", e.id).in("status", ["pending", "confirmed"]);
    targets.push({ kind: "camp_edition", id: e.id, name: pn.get(e.program_id)!, detail: `${e.starts_on}/${e.ends_on}`, programId: e.program_id, full: (count ?? 0) >= e.capacity });
  }
  const options: Record<string, { id: string; label: string }[]> = {};
  for (const o of (opts ?? []) as { id: string; program_id: string; edition_id: string | null; label: string }[]) (options[o.program_id] ??= []).push({ id: o.id, label: o.label });
  const groups: Record<string, { id: string; label: string }[]> = {};
  for (const g of (grps ?? []) as { id: string; program_id: string; label: string }[]) (groups[g.program_id] ??= []).push({ id: g.id, label: g.label });
  return { targets: targets.sort((a, b) => a.name.localeCompare(b.name)), options, groups };
}

/** Parent: their entries with the list names and place in line. */
export async function parentWaitlist(orgId: string) {
  const db = await caDb();
  const { data } = await db.from("waitlist_entries").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200);
  const rows = (data ?? []) as WaitlistRow[];
  const t = await targetsFor(rows);
  const athIds = Array.from(new Set(rows.map((r) => r.athlete_id)));
  const { data: aths } = athIds.length ? await db.from("athletes").select("id,first_name,last_name").in("id", athIds) : { data: [] };
  const an = new Map(((aths ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => [a.id, fullName(a)]));
  // place in line: count open entries ahead (service count, no names)
  const admin = caAdminDb();
  const out = [];
  for (const r of rows) {
    let ahead: number | null = null;
    if (r.status === "waiting") {
      const { count } = await admin.from("waitlist_entries").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).eq("target_key", r.target_key).eq("status", "waiting").lt("position", r.position);
      ahead = count ?? 0;
    }
    const ed = r.camp_edition_id ? t.eds.get(r.camp_edition_id) : undefined;
    out.push({
      ...r,
      athleteName: an.get(r.athlete_id) ?? "—",
      name: r.target_kind === "training_slot" ? t.svcs.get(r.service_id ?? "")?.name ?? "—" : t.progs.get(r.program_id ?? "")?.name ?? "—",
      detail: ed ? `${ed.starts_on}/${ed.ends_on}` : r.slot_start,
      place: ahead == null ? null : ahead + 1,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// J+S
// ---------------------------------------------------------------------------
export type JsProgram = { id: string; name: string; kind: string; js_offer: boolean; js_offer_number: string | null; js_session_minutes: number | null; viaTeam: boolean };

export async function listJsPrograms(orgId: string): Promise<JsProgram[]> {
  const db = await caDb();
  const [{ data: progs }, { data: teams }] = await Promise.all([
    db.from("programs").select("id,name,kind,status,js_offer,js_offer_number,js_session_minutes").eq("org_id", orgId).neq("status", "archived").order("name"),
    db.from("teams").select("id,program_id,js_offer").eq("org_id", orgId).eq("js_offer", true),
  ]);
  const viaTeam = new Set(((teams ?? []) as { program_id: string | null }[]).map((t) => t.program_id).filter(Boolean));
  return ((progs ?? []) as Omit<JsProgram, "viaTeam">[]).map((p) => ({ ...p, viaTeam: viaTeam.has(p.id) }));
}

export async function listCoachesForJs(orgId: string) {
  const { data } = await (await caDb()).from("coaches").select("id,display_name,js_person_number,is_active").eq("org_id", orgId).order("display_name");
  return (data ?? []) as { id: string; display_name: string; js_person_number: string | null; is_active: boolean }[];
}

/** Participants of J+S offers with their AHV status (admin; last 4 digits only). */
export async function jsParticipants(orgId: string, programIds: string[]) {
  if (!programIds.length) return [];
  const db = await caDb();
  const { data: regs } = await db.from("registrations").select("athlete_id").eq("org_id", orgId).in("program_id", programIds).in("status", ["pending", "confirmed", "completed"]);
  const ids = Array.from(new Set((regs ?? []).map((r) => r.athlete_id)));
  if (!ids.length) return [];
  const [{ data: aths }, { data: idents }] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name,dob").in("id", ids).order("last_name"),
    db.from("athlete_identifiers").select("athlete_id,ahv_last4,consent_recorded_at").in("athlete_id", ids),
  ]);
  const im = new Map(((idents ?? []) as { athlete_id: string; ahv_last4: string | null; consent_recorded_at: string | null }[]).map((i) => [i.athlete_id, i]));
  return ((aths ?? []) as { id: string; first_name: string; last_name: string; dob: string }[]).map((a) => ({
    id: a.id, name: fullName(a), dob: a.dob, ahvLast4: im.get(a.id)?.ahv_last4 ?? null, consentAt: im.get(a.id)?.consent_recorded_at ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Staff compliance
// ---------------------------------------------------------------------------
export async function complianceOverview(orgId: string, coachId?: string | null) {
  const db = await caDb();
  let cq = db.from("coaches").select("id,display_name,is_active,profile_id").eq("org_id", orgId).order("display_name");
  if (coachId) cq = cq.eq("id", coachId);
  let sq = db.from("staff_certificates").select("*").eq("org_id", orgId).order("valid_until", { ascending: false, nullsFirst: true });
  if (coachId) sq = sq.eq("coach_id", coachId);
  const [{ data: coaches }, { data: certs }] = await Promise.all([cq, sq]);
  return {
    coaches: (coaches ?? []) as { id: string; display_name: string; is_active: boolean; profile_id: string | null }[],
    certs: (certs ?? []) as CertificateRow[],
  };
}

export async function youthTeamsWithCoaches(orgId: string) {
  const db = await caDb();
  const [{ data: teams }, { data: tc }, { data: ov }] = await Promise.all([
    db.from("teams").select("id,name,is_youth,is_active").eq("org_id", orgId).eq("is_active", true).order("name"),
    db.from("team_coaches").select("team_id,coach_id,role").eq("org_id", orgId),
    db.from("coach_assignment_overrides").select("id,team_id,coach_id,reason,missing,created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
  ]);
  return {
    teams: (teams ?? []) as { id: string; name: string; is_youth: boolean }[],
    assignments: (tc ?? []) as { team_id: string; coach_id: string; role: string }[],
    overrides: (ov ?? []) as { id: string; team_id: string; coach_id: string; reason: string; missing: string[]; created_at: string }[],
  };
}

export async function myCoach(orgId: string, profileId: string) {
  const { data } = await (await caDb()).from("coaches").select("id,display_name").eq("org_id", orgId).eq("profile_id", profileId).maybeSingle();
  return data as { id: string; display_name: string } | null;
}

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------
export type IncidentView = IncidentRow & { athleteName: string; programName: string | null; teamName: string | null };

export async function listIncidents(orgId: string, opts: { from?: string | null; to?: string | null; limit?: number } = {}): Promise<IncidentView[]> {
  const db = await caDb();
  let q = db.from("incident_reports").select("*").eq("org_id", orgId).order("occurred_at", { ascending: false }).limit(opts.limit ?? 300);
  if (opts.from) q = q.gte("occurred_at", opts.from);
  if (opts.to) q = q.lte("occurred_at", opts.to);
  const data = must(await q, "incidents");
  return decorateIncidents((data ?? []) as IncidentRow[]);
}

async function decorateIncidents(rows: IncidentRow[]): Promise<IncidentView[]> {
  if (!rows.length) return [];
  const db = await caDb();
  const athIds = Array.from(new Set(rows.map((r) => r.athlete_id)));
  const progIds = Array.from(new Set(rows.map((r) => r.program_id).filter((x): x is string => !!x)));
  const teamIds = Array.from(new Set(rows.map((r) => r.team_id).filter((x): x is string => !!x)));
  const [{ data: aths }, progs, teams] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name").in("id", athIds),
    progIds.length ? db.from("programs").select("id,name").in("id", progIds) : Promise.resolve({ data: [] as Named[] }),
    teamIds.length ? db.from("teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [] as Named[] }),
  ]);
  const an = new Map(((aths ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => [a.id, fullName(a)]));
  const pn = new Map(((progs.data ?? []) as Named[]).map((p) => [p.id, p.name]));
  const tn = new Map(((teams.data ?? []) as Named[]).map((p) => [p.id, p.name]));
  return rows.map((r) => ({ ...r, athleteName: an.get(r.athlete_id) ?? "—", programName: r.program_id ? pn.get(r.program_id) ?? null : null, teamName: r.team_id ? tn.get(r.team_id) ?? null : null }));
}

export async function getIncident(orgId: string, id: string): Promise<IncidentView | null> {
  const { data } = await (await caDb()).from("incident_reports").select("*").eq("org_id", orgId).eq("id", id).maybeSingle();
  if (!data) return null;
  return (await decorateIncidents([data as IncidentRow]))[0];
}

/** Athletes the user may report for (RLS: admin = all; coach = their athletes), programmes and teams. */
export async function incidentFormOptions(orgId: string) {
  const db = await caDb();
  const [{ data: aths }, { data: progs }, { data: teams }] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name").eq("org_id", orgId).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).order("last_name").limit(3000),
    db.from("programs").select("id,name").eq("org_id", orgId).neq("status", "archived").order("name"),
    db.from("teams").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name"),
  ]);
  return {
    athletes: ((aths ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => ({ id: a.id, name: fullName(a) })),
    programs: (progs ?? []) as Named[],
    teams: (teams ?? []) as Named[],
  };
}
