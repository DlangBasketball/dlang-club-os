import "server-only";
import { cache } from "react";
import { campsAdminDb, campsDb, type CampAgeGroupRow, type CampEditionRow, type CampPriceOptionRow, type CampTimeSlotRow, type DiscountRow } from "./db";
import type { DiscountDef } from "@/lib/pricing/discounts";
import { isRegistrationOpen, spotsLeft } from "./logic";

export type Result<T> = { data: T; error: null } | { data: null; error: string };

// ---------------------------------------------------------------------------
// Mapped shapes
// ---------------------------------------------------------------------------
export type CampVenue = { id: string; name: string; address: string | null; city: string | null; postalCode: string | null };
export type CampEdition = {
  id: string; programId: string; name: string | null; startsOn: string; endsOn: string;
  venueId: string | null; venue: CampVenue | null; locationName: string | null; address: string | null; city: string | null;
  capacity: number | null; taken: number; spotsLeft: number | null;
  registrationOpensAt: string | null; registrationClosesAt: string | null;
  status: CampEditionRow["status"]; notes: string | null; registrations: number;
};
export type CampPriceOption = { id: string; editionId: string | null; label: string; daysCount: number; includesLunch: boolean; price: number; currency: string | null; isActive: boolean; sort: number };
export type CampAgeGroup = { id: string; label: string; minAge: number | null; maxAge: number | null; timeSlotId: string | null; isActive: boolean; sort: number; editionId: null };
export type CampTimeSlot = { id: string; editionId: string | null; label: string; startsAt: string; endsAt: string; sort: number };

export const mapOption = (o: CampPriceOptionRow): CampPriceOption => ({
  id: o.id, editionId: o.edition_id, label: o.label, daysCount: o.days_count, includesLunch: o.includes_lunch,
  price: Number(o.price), currency: o.currency, isActive: o.is_active, sort: o.sort,
});
export const mapAgeGroup = (g: CampAgeGroupRow): CampAgeGroup => ({
  id: g.id, label: g.label, minAge: g.min_age, maxAge: g.max_age, timeSlotId: g.time_slot_id, isActive: g.is_active, sort: g.sort, editionId: null,
});
export const mapSlot = (s: CampTimeSlotRow): CampTimeSlot => ({
  id: s.id, editionId: s.edition_id, label: s.label, startsAt: s.starts_at.slice(0, 5), endsAt: s.ends_at.slice(0, 5), sort: s.sort,
});

export function mapDiscount(d: DiscountRow, usage?: { all: number; family: number }): DiscountDef & { description: string | null } {
  return {
    id: d.id, name: d.name, description: d.description, kind: d.kind, value: Number(d.value), currency: d.currency,
    scope: d.scope, scopeProgramId: d.scope_program_id, scopeServiceId: d.scope_service_id, rule: d.rule, code: d.code,
    validFrom: d.valid_from, validUntil: d.valid_until, siblingMinPosition: d.sibling_min_position,
    earlyBirdDaysBefore: d.early_bird_days_before, maxRedemptions: d.max_redemptions,
    maxRedemptionsPerFamily: d.max_redemptions_per_family, stackable: d.stackable, active: d.is_active,
    redemptions: usage?.all ?? 0, familyRedemptions: usage?.family ?? 0,
  };
}

const EDITION_COLS = "id,org_id,program_id,name,starts_on,ends_on,venue_id,location_name,address,city,capacity,registration_opens_at,registration_closes_at,status,notes,archived_at,created_at,updated_at";

type Db = ReturnType<typeof campsAdminDb>;

/** Active (pending / confirmed) and all registrations per edition. */
async function editionCounts(db: Db, editionIds: string[]) {
  const active = new Map<string, number>();
  const all = new Map<string, number>();
  if (!editionIds.length) return { active, all };
  const { data } = await db.from("registrations").select("camp_edition_id,status").in("camp_edition_id", editionIds);
  for (const r of data ?? []) {
    const id = r.camp_edition_id as string;
    all.set(id, (all.get(id) ?? 0) + 1);
    if (r.status === "pending" || r.status === "confirmed") active.set(id, (active.get(id) ?? 0) + 1);
  }
  return { active, all };
}

function mapEditions(rows: CampEditionRow[], venues: Map<string, CampVenue>, counts: Awaited<ReturnType<typeof editionCounts>>): CampEdition[] {
  return rows.map((e) => {
    const taken = counts.active.get(e.id) ?? 0;
    return {
      id: e.id, programId: e.program_id, name: e.name, startsOn: e.starts_on, endsOn: e.ends_on, venueId: e.venue_id,
      venue: e.venue_id ? venues.get(e.venue_id) ?? null : null, locationName: e.location_name, address: e.address, city: e.city,
      capacity: e.capacity, taken, spotsLeft: spotsLeft(e.capacity, taken),
      registrationOpensAt: e.registration_opens_at, registrationClosesAt: e.registration_closes_at,
      status: e.status, notes: e.notes, registrations: counts.all.get(e.id) ?? 0,
    };
  });
}

async function venueMap(db: Db, orgId: string, ids: string[]): Promise<Map<string, CampVenue>> {
  const m = new Map<string, CampVenue>();
  if (!ids.length) return m;
  const { data } = await db.from("venues").select("id,name,address,city,postal_code").eq("org_id", orgId).in("id", ids);
  for (const v of data ?? []) m.set(v.id, { id: v.id, name: v.name, address: v.address, city: v.city, postalCode: v.postal_code });
  return m;
}

export type CampAdminData = {
  editions: CampEdition[];
  options: CampPriceOption[];
  ageGroups: CampAgeGroup[];
  timeSlots: CampTimeSlot[];
  venues: CampVenue[];
};

/** Everything the camp admin needs (RLS client: the caller's org only). */
export async function getCampAdmin(orgId: string, programId: string): Promise<Result<CampAdminData>> {
  const db = (await campsDb()) as unknown as Db;
  const [ed, op, ag, ts, vs] = await Promise.all([
    db.from("camp_editions").select(EDITION_COLS).eq("org_id", orgId).eq("program_id", programId).order("starts_on"),
    db.from("camp_price_options").select("*").eq("org_id", orgId).eq("program_id", programId).order("sort").order("days_count"),
    db.from("camp_age_groups").select("*").eq("org_id", orgId).eq("program_id", programId).order("sort"),
    db.from("camp_time_slots").select("*").eq("org_id", orgId).eq("program_id", programId).order("sort").order("starts_at"),
    db.from("venues").select("id,name,address,city,postal_code").eq("org_id", orgId).eq("is_active", true).order("name"),
  ]);
  const err = ed.error ?? op.error ?? ag.error ?? ts.error;
  if (err) return { data: null, error: err.message };
  const venues = (vs.data ?? []).map((v) => ({ id: v.id, name: v.name, address: v.address, city: v.city, postalCode: v.postal_code }));
  const vmap = new Map(venues.map((v) => [v.id, v]));
  const missing = (ed.data ?? []).map((e) => e.venue_id).filter((id): id is string => !!id && !vmap.has(id));
  for (const [k, v] of await venueMap(db, orgId, missing)) vmap.set(k, v);
  const counts = await editionCounts(db, (ed.data ?? []).map((e) => e.id));
  return {
    data: {
      editions: mapEditions((ed.data ?? []) as CampEditionRow[], vmap, counts),
      options: (op.data ?? []).map(mapOption),
      ageGroups: (ag.data ?? []).map(mapAgeGroup),
      timeSlots: (ts.data ?? []).map(mapSlot),
      venues,
    },
    error: null,
  };
}

export type EditionRegistration = {
  id: string; status: string; createdAt: string; athleteId: string; athleteName: string; dob: string | null;
  familyId: string | null; familyName: string | null; contactEmail: string | null; contactPhone: string | null; membership: string | null;
  optionLabel: string | null; ageGroup: string | null; days: string[]; includesLunch: boolean | null;
  listAmount: number | null; discountAmount: number | null; amount: number | null; currency: string | null;
  discounts: string[]; invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null;
};

/** Registrations of one edition with their chosen options (admin / finance; RLS scoped). */
export async function getEditionRegistrations(orgId: string, editionId: string): Promise<Result<{ edition: CampEdition | null; programName: string; rows: EditionRegistration[] }>> {
  if (!/^[0-9a-f-]{36}$/i.test(editionId)) return { data: { edition: null, programName: "", rows: [] }, error: null };
  const db = (await campsDb()) as unknown as Db;
  const { data: e, error } = await db.from("camp_editions").select(EDITION_COLS).eq("org_id", orgId).eq("id", editionId).maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!e) return { data: { edition: null, programName: "", rows: [] }, error: null };
  const edRow = e as CampEditionRow;
  const [{ data: prog }, { data: regs, error: rErr }, vmap, counts] = await Promise.all([
    db.from("programs").select("name").eq("id", edRow.program_id).eq("org_id", orgId).maybeSingle(),
    db.from("registrations")
      .select("id,status,created_at,athlete_id,camp_age_group_id,camp_days,camp_includes_lunch,price_list_amount,price_discount_amount,price_amount,price_currency,price_snapshot,invoice_id")
      .eq("org_id", orgId).eq("camp_edition_id", editionId).order("created_at"),
    venueMap(db, orgId, edRow.venue_id ? [edRow.venue_id] : []),
    editionCounts(db, [editionId]),
  ]);
  if (rErr) return { data: null, error: rErr.message };
  const list = regs ?? [];
  const athleteIds = Array.from(new Set(list.map((r) => r.athlete_id)));
  const invoiceIds = Array.from(new Set(list.map((r) => r.invoice_id).filter((x): x is string => !!x)));
  const groupIds = Array.from(new Set(list.map((r) => r.camp_age_group_id).filter((x): x is string => !!x)));
  const [{ data: athletes }, { data: invoices }, { data: groups }] = await Promise.all([
    athleteIds.length ? db.from("athletes").select("id,first_name,last_name,dob,family_id").in("id", athleteIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string; dob: string | null; family_id: string }[] }),
    invoiceIds.length ? db.from("invoices").select("id,number,status").in("id", invoiceIds) : Promise.resolve({ data: [] as { id: string; number: string; status: string }[] }),
    groupIds.length ? db.from("camp_age_groups").select("id,label").in("id", groupIds) : Promise.resolve({ data: [] as { id: string; label: string }[] }),
  ]);
  const familyIds = Array.from(new Set((athletes ?? []).map((a) => a.family_id)));
  const { data: families } = familyIds.length
    ? await db.from("families").select("id,name,contact_email,phone,membership_status").in("id", familyIds)
    : { data: [] as { id: string; name: string; contact_email: string | null; phone: string | null; membership_status: string | null }[] };
  const aMap = new Map((athletes ?? []).map((a) => [a.id, a]));
  const fMap = new Map((families ?? []).map((f) => [f.id, f as { id: string; name: string; contact_email: string | null; phone: string | null; membership_status: string | null }]));
  const iMap = new Map((invoices ?? []).map((i) => [i.id, i]));
  const gMap = new Map((groups ?? []).map((g) => [g.id, g.label]));
  const rows: EditionRegistration[] = list.map((r) => {
    const a = aMap.get(r.athlete_id);
    const fam = a ? fMap.get(a.family_id) : undefined;
    const snap = (r.price_snapshot ?? {}) as { option_label?: string; discounts?: { name?: string }[] };
    const inv = r.invoice_id ? iMap.get(r.invoice_id) : undefined;
    return {
      id: r.id, status: r.status, createdAt: r.created_at, athleteId: r.athlete_id,
      athleteName: a ? `${a.first_name} ${a.last_name}` : "", dob: a?.dob ?? null,
      familyId: fam?.id ?? null, familyName: fam?.name ?? null, contactEmail: fam?.contact_email ?? null, contactPhone: fam?.phone ?? null,
      membership: fam?.membership_status ?? null,
      optionLabel: snap.option_label ?? null, ageGroup: r.camp_age_group_id ? gMap.get(r.camp_age_group_id) ?? null : null,
      days: (r.camp_days ?? []) as string[], includesLunch: r.camp_includes_lunch,
      listAmount: r.price_list_amount == null ? null : Number(r.price_list_amount),
      discountAmount: r.price_discount_amount == null ? null : Number(r.price_discount_amount),
      amount: r.price_amount == null ? null : Number(r.price_amount), currency: r.price_currency,
      discounts: (snap.discounts ?? []).map((d) => d.name ?? "").filter(Boolean),
      invoiceId: r.invoice_id, invoiceNumber: inv?.number ?? null, invoiceStatus: inv?.status ?? null,
    };
  });
  return { data: { edition: mapEditions([edRow], vmap, counts)[0], programName: prog?.name ?? "", rows }, error: null };
}

/** Discounts of the org (admin / finance; RLS) with their use counts. */
export async function listDiscounts(orgId: string): Promise<Result<(ReturnType<typeof mapDiscount> & { uses: number })[]>> {
  const db = (await campsDb()) as unknown as Db;
  const [{ data, error }, { data: used }] = await Promise.all([
    db.from("discounts").select("*").eq("org_id", orgId).order("is_active", { ascending: false }).order("name"),
    db.from("applied_discounts").select("discount_id").eq("org_id", orgId).is("voided_at", null),
  ]);
  if (error) return { data: null, error: error.message };
  const count = new Map<string, number>();
  for (const u of used ?? []) count.set(u.discount_id, (count.get(u.discount_id) ?? 0) + 1);
  return { data: (data ?? []).map((d) => ({ ...mapDiscount(d as DiscountRow, { all: count.get(d.id) ?? 0, family: 0 }), uses: count.get(d.id) ?? 0 })), error: null };
}

/**
 * Active discounts of an org for pricing, with use counts (overall and for
 * one family). Service role: families never read the discounts table.
 */
export async function loadPricingDiscounts(orgId: string, familyId: string | null): Promise<DiscountDef[]> {
  const db = campsAdminDb();
  const { data } = await db.from("discounts").select("*").eq("org_id", orgId).eq("is_active", true).neq("rule", "manual");
  const rows = (data ?? []) as DiscountRow[];
  const promoIds = rows.filter((d) => d.rule === "promo_code").map((d) => d.id);
  const all = new Map<string, number>();
  const fam = new Map<string, number>();
  if (promoIds.length) {
    const { data: used } = await db.from("applied_discounts").select("discount_id,family_id").eq("org_id", orgId).in("discount_id", promoIds).is("voided_at", null);
    for (const u of used ?? []) {
      all.set(u.discount_id, (all.get(u.discount_id) ?? 0) + 1);
      if (familyId && u.family_id === familyId) fam.set(u.discount_id, (fam.get(u.discount_id) ?? 0) + 1);
    }
  }
  return rows.map((d) => mapDiscount(d, { all: all.get(d.id) ?? 0, family: fam.get(d.id) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Public / parent camp page
// ---------------------------------------------------------------------------
export type PublicCamp = {
  program: { id: string; orgId: string; slug: string | null; name: string; description: string | null; currency: string; isPublic: boolean };
  editions: (CampEdition & { open: boolean })[];
  options: CampPriceOption[];
  ageGroups: CampAgeGroup[];
  timeSlots: CampTimeSlot[];
  consents: { key: string; title: string; version: number; required: boolean }[];
};

async function loadCamp(filter: { slug?: string; programId?: string; orgId?: string }, requirePublic: boolean): Promise<PublicCamp | null> {
  const db = campsAdminDb();
  let q = db.from("programs").select("id,org_id,slug,name,description,kind,currency,is_public,status").eq("kind", "camp").eq("status", "published");
  if (filter.slug) q = q.eq("slug", filter.slug);
  if (filter.programId) q = q.eq("id", filter.programId);
  if (filter.orgId) q = q.eq("org_id", filter.orgId);
  if (requirePublic) q = q.eq("is_public", true);
  const { data: p } = await q.maybeSingle();
  if (!p) return null;
  const prog = p as { id: string; org_id: string; slug: string | null; name: string; description: string | null; currency: string | null; is_public: boolean };
  const orgId = prog.org_id;
  const [ed, op, ag, ts, forms, cur] = await Promise.all([
    db.from("camp_editions").select(EDITION_COLS).eq("org_id", orgId).eq("program_id", prog.id).eq("status", "published").order("starts_on"),
    db.from("camp_price_options").select("*").eq("org_id", orgId).eq("program_id", prog.id).eq("is_active", true).order("sort").order("days_count"),
    db.from("camp_age_groups").select("*").eq("org_id", orgId).eq("program_id", prog.id).eq("is_active", true).order("sort"),
    db.from("camp_time_slots").select("*").eq("org_id", orgId).eq("program_id", prog.id).order("sort").order("starts_at"),
    db.from("consent_forms").select("key,title,version,is_required").eq("org_id", orgId).eq("is_active", true).order("version", { ascending: false }),
    db.rpc("org_currency", { p_org: orgId }),
  ]);
  const edRows = (ed.data ?? []) as CampEditionRow[];
  const vmap = await venueMap(db, orgId, edRows.map((e) => e.venue_id).filter((x): x is string => !!x));
  const counts = await editionCounts(db, edRows.map((e) => e.id));
  const now = new Date();
  const editions = mapEditions(edRows, vmap, counts)
    .filter((e) => e.endsOn >= now.toISOString().slice(0, 10))
    .map((e) => ({ ...e, open: isRegistrationOpen(e, now) && (e.spotsLeft === null || e.spotsLeft > 0) }));
  const byKey = new Map<string, PublicCamp["consents"][number]>();
  for (const f of forms.data ?? []) if (!byKey.has(f.key)) byKey.set(f.key, { key: f.key, title: f.title, version: f.version, required: f.is_required });
  const orgCurrency = typeof cur.data === "string" ? cur.data : "CHF";
  return {
    program: { id: prog.id, orgId, slug: prog.slug, name: prog.name, description: prog.description, currency: (prog.currency ?? orgCurrency).toUpperCase(), isPublic: prog.is_public },
    editions,
    options: (op.data ?? []).map(mapOption),
    ageGroups: (ag.data ?? []).map(mapAgeGroup),
    timeSlots: (ts.data ?? []).map(mapSlot),
    consents: Array.from(byKey.values()),
  };
}

/** Public camp page by slug (published + public only). Service role, server only. */
export const getPublicCamp = cache((slug: string) => loadCamp({ slug }, true));

/** Camp of the parent's own club (published; public or members-only). */
export const getMemberCamp = cache((orgId: string, programId: string) => loadCamp({ programId, orgId }, false));

export type CampSummary = { id: string; name: string; description: string | null; nextStart: string | null; editions: number };

/** Published camps of a club with upcoming published editions (parent app). */
export async function listMemberCamps(orgId: string): Promise<CampSummary[]> {
  const db = (await campsDb()) as unknown as Db;
  const { data: progs } = await db.from("programs").select("id,name,description").eq("org_id", orgId).eq("kind", "camp").eq("status", "published").order("name");
  const ids = (progs ?? []).map((p) => p.id);
  if (!ids.length) return [];
  const today = new Date().toISOString().slice(0, 10);
  const { data: eds } = await db.from("camp_editions").select("program_id,starts_on").eq("org_id", orgId).in("program_id", ids).eq("status", "published").gte("ends_on", today).order("starts_on");
  return (progs ?? []).map((p) => {
    const mine = (eds ?? []).filter((e) => e.program_id === p.id);
    return { id: p.id, name: p.name, description: p.description, nextStart: mine[0]?.starts_on ?? null, editions: mine.length };
  }).filter((c) => c.editions > 0);
}
