import "server-only";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { trainingAdminDb, trainingDb, type PurchaseStatus, type SessionType } from "./db";
import type { OpeningHours, SlotBlackout, SlotBusy, SlotTemplate, SlotWindow } from "./slots";

/**
 * Server reads for the training system. RLS decides what each caller sees
 * (admin: club; guardian: own children; coach: own sessions); the org is
 * never taken from the client.
 */

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));
const hm = (t: string | null | undefined) => (t ?? "").slice(0, 5);

export type TrainingSettings = {
  enabled: boolean; cancellationHours: number; refundCreditsOnCancel: boolean; slotStepMin: number; leadHours: number; horizonDays: number;
};
export const DEFAULT_SETTINGS: TrainingSettings = { enabled: false, cancellationHours: 24, refundCreditsOnCancel: true, slotStepMin: 30, leadHours: 0, horizonDays: 28 };

export function settingsFrom(raw: unknown): TrainingSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as { bookings_enabled?: boolean; booking?: Record<string, unknown> };
  const b = (s.booking ?? {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    enabled: Boolean(s.bookings_enabled),
    cancellationHours: num(b.cancellation_hours, 24),
    refundCreditsOnCancel: b.refund_credits_on_cancel === undefined ? true : Boolean(b.refund_credits_on_cancel),
    slotStepMin: num(b.slot_step_min, 30),
    leadHours: num(b.lead_hours, 0),
    horizonDays: num(b.horizon_days, 28),
  };
}

/** Booking settings of the signed-in user's club. */
export async function getTrainingSettings(): Promise<TrainingSettings> {
  const me = await getSessionUser();
  if (!me?.orgId) return DEFAULT_SETTINGS;
  const { data } = await trainingAdminDb().from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  return settingsFrom((data as { settings?: unknown } | null)?.settings);
}

// ---- Catalogue ---------------------------------------------------------------
export type TrainingPackage = { id: string; serviceId: string; name: string; sessions: number; price: number; validityDays: number | null; isActive: boolean; sortOrder: number; description: string | null };
export type TrainingService = {
  id: string; slug: string; name: string; description: string | null; sessionType: SessionType; maxParticipants: number; minParticipants: number;
  durationMin: number; price: number; currency: string | null; venueId: string | null; locationText: string | null; color: string | null;
  isActive: boolean; sortOrder: number; creditCategory: "personal" | "nutrition" | "mental"; creditsRequired: number;
  coachIds: string[]; packages: TrainingPackage[];
};
export type TrainingVenue = { id: string; name: string; address: string | null; postalCode: string | null; city: string | null; openingHours: OpeningHours; isActive: boolean };
export type TrainingCoach = { id: string; name: string; title: string | null; serves: string[]; isActive: boolean };

const SERVICE_COLS = "id,slug,name,description,session_type,max_participants,min_participants,duration_min,price_chf,currency,venue_id,location_text,color,is_active,sort_order,credit_category,credits_required";

export async function listTrainingCatalog(opts: { activeOnly?: boolean } = {}): Promise<Result<{ services: TrainingService[]; venues: TrainingVenue[]; coaches: TrainingCoach[] }>> {
  const db = await trainingDb();
  let sq = db.from("training_services").select(SERVICE_COLS).order("sort_order").order("name");
  if (opts.activeOnly) sq = sq.eq("is_active", true);
  const [svc, pkg, ven, co] = await Promise.all([
    sq,
    db.from("credit_packages").select("id,service_id,name,credits,price_chf,validity_days,is_active,sort_order,description").not("service_id", "is", null).order("sort_order").order("credits"),
    db.from("venues").select("id,name,address,postal_code,city,opening_hours,is_active").order("name"),
    db.from("coaches").select("id,display_name,role_title,serves,is_active").order("display_name"),
  ]);
  if (svc.error) return fail(svc.error.message);
  const coaches: TrainingCoach[] = (co.data ?? []).map((c) => ({ id: c.id, name: c.display_name, title: c.role_title ?? null, serves: c.serves ?? [], isActive: c.is_active }));
  const packages = (pkg.data ?? []).map((p) => ({
    id: p.id, serviceId: p.service_id as string, name: p.name, sessions: p.credits, price: Number(p.price_chf), validityDays: p.validity_days,
    isActive: p.is_active, sortOrder: p.sort_order, description: p.description,
  }));
  const services: TrainingService[] = (svc.data ?? []).map((s) => ({
    id: s.id, slug: s.slug, name: s.name, description: s.description, sessionType: s.session_type, maxParticipants: s.max_participants,
    minParticipants: s.min_participants, durationMin: s.duration_min, price: Number(s.price_chf), currency: s.currency, venueId: s.venue_id,
    locationText: s.location_text, color: s.color, isActive: s.is_active, sortOrder: s.sort_order, creditCategory: s.credit_category,
    creditsRequired: s.credits_required,
    coachIds: coaches.filter((c) => c.isActive && c.serves.includes(s.slug)).map((c) => c.id),
    packages: packages.filter((p) => p.serviceId === s.id && (!opts.activeOnly || p.isActive)),
  }));
  const venues: TrainingVenue[] = (ven.data ?? []).map((v) => ({
    id: v.id, name: v.name, address: v.address, postalCode: v.postal_code, city: v.city, openingHours: (v.opening_hours ?? null) as OpeningHours, isActive: v.is_active,
  }));
  return ok({ services, venues, coaches });
}

export async function getTrainingService(id: string): Promise<Result<{ service: TrainingService | null; venues: TrainingVenue[]; coaches: TrainingCoach[] }>> {
  const r = await listTrainingCatalog();
  if (r.error !== null) return fail(r.error);
  return ok({ service: r.data.services.find((s) => s.id === id) ?? null, venues: r.data.venues, coaches: r.data.coaches });
}

// ---- Availability ----------------------------------------------------------
export type AvailabilityData = {
  templates: (SlotTemplate & { id: string; isActive: boolean })[];
  windows: (SlotWindow & { id: string; isBooked: boolean })[];
  blackouts: (SlotBlackout & { id: string; reason: string | null })[];
};

export async function getAvailabilityData(opts: { coachId?: string | null; from?: Date; days?: number } = {}): Promise<Result<AvailabilityData>> {
  const db = await trainingDb();
  const from = opts.from ?? new Date(Date.now() - 864e5);
  const to = new Date(from.getTime() + (opts.days ?? 120) * 864e5);
  let tq = db.from("coach_availability_templates").select("id,coach_id,venue_id,service_id,weekday,start_time,end_time,capacity,valid_from,valid_until,is_active").order("weekday").order("start_time");
  let wq = db.from("coach_availability").select("id,coach_id,venue_id,service_id,starts_at,ends_at,capacity,is_booked").gte("ends_at", from.toISOString()).lte("starts_at", to.toISOString()).order("starts_at").limit(500);
  let bq = db.from("training_blackouts").select("id,coach_id,venue_id,starts_at,ends_at,reason").gte("ends_at", from.toISOString()).order("starts_at").limit(500);
  if (opts.coachId) {
    tq = tq.eq("coach_id", opts.coachId);
    wq = wq.eq("coach_id", opts.coachId);
    bq = bq.or(`coach_id.is.null,coach_id.eq.${opts.coachId}`);
  }
  const [t, w, b] = await Promise.all([tq, wq, bq]);
  if (t.error) return fail(t.error.message);
  return ok({
    templates: (t.data ?? []).map((x) => ({
      id: x.id, coachId: x.coach_id, venueId: x.venue_id, serviceId: x.service_id, weekday: x.weekday, startTime: hm(x.start_time), endTime: hm(x.end_time),
      capacity: x.capacity, validFrom: x.valid_from, validUntil: x.valid_until, isActive: x.is_active,
    })),
    windows: (w.data ?? []).map((x) => ({ id: x.id, coachId: x.coach_id, venueId: x.venue_id, serviceId: x.service_id, startsAt: x.starts_at, endsAt: x.ends_at, capacity: x.capacity ?? 1, isBooked: x.is_booked })),
    blackouts: (b.data ?? []).map((x) => ({ id: x.id, coachId: x.coach_id, venueId: x.venue_id, startsAt: x.starts_at, endsAt: x.ends_at, reason: x.reason })),
  });
}

/** Busy times (no athlete data) for slot computation. */
export async function getBusy(from: Date, to: Date): Promise<SlotBusy[]> {
  const db = await trainingDb();
  const { data } = await db.rpc("training_busy", { p_from: from.toISOString(), p_to: to.toISOString() });
  return (data ?? []).map((x) => ({ coachId: x.coach_id, serviceId: x.service_id, start: x.slot_start, end: x.slot_end, booked: x.booked }));
}

// ---- Credits / purchases -----------------------------------------------------
export type PurchaseView = {
  id: string; athleteId: string; athleteName: string; serviceId: string; serviceName: string; packageName: string | null;
  sessions: number; sessionsUsed: number; amount: number; listPrice: number; discountTotal: number; currency: string;
  status: PurchaseStatus; paymentMode: string; invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null;
  expiresAt: string | null; grantedAt: string | null; createdAt: string; createdBy: string | null;
};

export async function listPurchases(opts: { athleteIds?: string[]; limit?: number } = {}): Promise<Result<PurchaseView[]>> {
  const db = await trainingDb();
  let q = db.from("training_package_purchases")
    .select("id,athlete_id,service_id,package_id,sessions,sessions_used,amount,list_price,discount_total,currency,status,payment_mode,invoice_id,expires_at,granted_at,created_at,created_by")
    .order("created_at", { ascending: false }).limit(opts.limit ?? 300);
  if (opts.athleteIds) {
    if (!opts.athleteIds.length) return ok([]);
    q = q.in("athlete_id", opts.athleteIds);
  }
  const { data, error } = await q;
  if (error) return fail(error.message);
  const rows = data ?? [];
  const [a, s, p, i] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name").in("id", uniq(rows.map((r) => r.athlete_id))),
    db.from("training_services").select("id,name").in("id", uniq(rows.map((r) => r.service_id))),
    db.from("credit_packages").select("id,name").in("id", uniq(rows.map((r) => r.package_id))),
    db.from("invoices").select("id,number,status").in("id", uniq(rows.map((r) => r.invoice_id))),
  ]);
  const an = new Map((a.data ?? []).map((x) => [x.id, `${x.first_name} ${x.last_name}`]));
  const sn = new Map((s.data ?? []).map((x) => [x.id, x.name]));
  const pn = new Map((p.data ?? []).map((x) => [x.id, x.name]));
  const inv = new Map((i.data ?? []).map((x) => [x.id, x as { id: string; number: string; status: string }]));
  return ok(rows.map((r) => ({
    id: r.id, athleteId: r.athlete_id, athleteName: an.get(r.athlete_id) ?? "", serviceId: r.service_id, serviceName: sn.get(r.service_id) ?? "",
    packageName: r.package_id ? pn.get(r.package_id) ?? null : null, sessions: r.sessions, sessionsUsed: r.sessions_used, amount: Number(r.amount),
    listPrice: Number(r.list_price), discountTotal: Number(r.discount_total), currency: r.currency, status: r.status, paymentMode: r.payment_mode,
    invoiceId: r.invoice_id, invoiceNumber: r.invoice_id ? inv.get(r.invoice_id)?.number ?? null : null,
    invoiceStatus: r.invoice_id ? inv.get(r.invoice_id)?.status ?? null : null,
    expiresAt: r.expires_at, grantedAt: r.granted_at, createdAt: r.created_at, createdBy: r.created_by,
  })));
}

// ---- Wizard (parent: own children; admin: every athlete) ----------------------
export type WizardAthlete = { id: string; name: string };
export type WizardLot = { id: string; athleteId: string; serviceId: string; sessions: number; sessionsUsed: number; status: PurchaseStatus; expiresAt: string | null; grantedAt: string | null; createdBy: string | null };
export type TrainingWizardData = {
  enabled: boolean;
  settings: TrainingSettings;
  athletes: WizardAthlete[];
  lots: WizardLot[];
  legacyCredits: Record<string, { personal: number; nutrition: number; mental: number }>;
  services: TrainingService[];
  coaches: TrainingCoach[];
  venues: TrainingVenue[];
  availability: AvailabilityData;
  busy: SlotBusy[];
  me: string | null;
};

export async function getTrainingWizardData(): Promise<Result<TrainingWizardData>> {
  const [me, settings, catalog] = await Promise.all([getSessionUser(), getTrainingSettings(), listTrainingCatalog({ activeOnly: true })]);
  if (catalog.error !== null) return fail(catalog.error);
  const db = await trainingDb();
  const now = new Date();
  const horizon = new Date(now.getTime() + Math.max(1, settings.horizonDays + 1) * 864e5);
  const [kids, avail, busy] = await Promise.all([
    db.from("athletes").select("id,first_name,last_name,status").order("first_name").limit(2000),
    getAvailabilityData({ from: now, days: settings.horizonDays + 2 }),
    getBusy(now, horizon),
  ]);
  const athletes = (kids.data ?? []).filter((k) => k.status !== "archived").map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}` }));
  const ids = athletes.map((a) => a.id);
  const [lots, credits] = await Promise.all([
    ids.length
      ? db.from("training_package_purchases").select("id,athlete_id,service_id,sessions,sessions_used,status,expires_at,granted_at,created_by").in("athlete_id", ids).neq("status", "cancelled")
      : Promise.resolve({ data: [] as never[] }),
    ids.length
      ? db.from("training_credits").select("athlete_id,credit_category,total_credits,used_credits").in("athlete_id", ids)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const legacy: TrainingWizardData["legacyCredits"] = {};
  for (const c of (credits.data ?? []) as { athlete_id: string; credit_category: "personal" | "nutrition" | "mental"; total_credits: number; used_credits: number }[]) {
    const e = legacy[c.athlete_id] ?? { personal: 0, nutrition: 0, mental: 0 };
    e[c.credit_category] = c.total_credits - c.used_credits;
    legacy[c.athlete_id] = e;
  }
  return ok({
    enabled: settings.enabled,
    settings,
    athletes,
    lots: ((lots.data ?? []) as { id: string; athlete_id: string; service_id: string; sessions: number; sessions_used: number; status: PurchaseStatus; expires_at: string | null; granted_at: string | null; created_by: string | null }[]).map((l) => ({
      id: l.id, athleteId: l.athlete_id, serviceId: l.service_id, sessions: l.sessions, sessionsUsed: l.sessions_used, status: l.status,
      expiresAt: l.expires_at, grantedAt: l.granted_at, createdBy: l.created_by,
    })),
    legacyCredits: legacy,
    services: catalog.data.services.filter((s) => s.isActive),
    coaches: catalog.data.coaches.filter((c) => c.isActive),
    venues: catalog.data.venues,
    availability: avail.data ?? { templates: [], windows: [], blackouts: [] },
    busy,
    me: me?.id ?? null,
  });
}

// ---- Athlete training profile ------------------------------------------------
export type TrainingBookingView = {
  id: string; serviceId: string; serviceName: string; coachId: string; coachName: string; start: string; end: string | null;
  status: string; creditsUsed: number; price: number | null; invoiceId: string | null; purchaseId: string | null;
  venueName: string | null; locationText: string | null; groupConfirmed: boolean; sessionType: SessionType; minParticipants: number;
};
export type AthleteTraining = {
  athlete: { id: string; name: string };
  profile: { goals: string; notes: string; level: string; focusAreas: string[]; updatedAt: string | null };
  balances: { serviceId: string; serviceName: string; remaining: number; pending: number; nextExpiry: string | null }[];
  bookings: TrainingBookingView[];
  stats: { attended: number; noShow: number; upcoming: number; cancelled: number };
};

export async function getAthleteTraining(athleteId: string): Promise<Result<AthleteTraining | null>> {
  if (!/^[0-9a-f-]{36}$/i.test(athleteId)) return ok(null);
  const db = await trainingDb();
  const { data: a, error } = await db.from("athletes").select("id,first_name,last_name").eq("id", athleteId).maybeSingle();
  if (error) return fail(error.message);
  if (!a) return ok(null);
  const [prof, bal, bk] = await Promise.all([
    db.from("athlete_training_profiles").select("goals,notes,level,focus_areas,updated_at").eq("athlete_id", athleteId).maybeSingle(),
    db.rpc("training_balances", { p_athlete: athleteId }),
    db.from("training_bookings").select("id,service_id,coach_id,slot_start,slot_end,status,credits_used,price_chf,invoice_id,purchase_id,venue_id,location_text,group_confirmed_at")
      .eq("athlete_id", athleteId).order("slot_start", { ascending: false }).limit(200),
  ]);
  const bookings = bk.data ?? [];
  const serviceIds = uniq([...bookings.map((b) => b.service_id), ...(bal.data ?? []).map((b) => b.service_id)]);
  const [s, c, v] = await Promise.all([
    db.from("training_services").select("id,name,session_type,min_participants").in("id", serviceIds),
    db.from("coaches").select("id,display_name").in("id", uniq(bookings.map((b) => b.coach_id))),
    db.from("venues").select("id,name").in("id", uniq(bookings.map((b) => b.venue_id))),
  ]);
  const svc = new Map((s.data ?? []).map((x) => [x.id, x]));
  const cn = new Map((c.data ?? []).map((x) => [x.id, x.display_name]));
  const vn = new Map((v.data ?? []).map((x) => [x.id, x.name]));
  const now = Date.now();
  const views: TrainingBookingView[] = bookings.map((b) => ({
    id: b.id, serviceId: b.service_id, serviceName: svc.get(b.service_id)?.name ?? "", coachId: b.coach_id, coachName: cn.get(b.coach_id) ?? "",
    start: b.slot_start, end: b.slot_end, status: b.status, creditsUsed: b.credits_used, price: b.price_chf === null ? null : Number(b.price_chf),
    invoiceId: b.invoice_id, purchaseId: b.purchase_id, venueName: b.venue_id ? vn.get(b.venue_id) ?? null : null, locationText: b.location_text,
    groupConfirmed: b.group_confirmed_at !== null, sessionType: svc.get(b.service_id)?.session_type ?? "individual",
    minParticipants: svc.get(b.service_id)?.min_participants ?? 1,
  }));
  const p = prof.data;
  return ok({
    athlete: { id: a.id, name: `${a.first_name} ${a.last_name}` },
    profile: { goals: p?.goals ?? "", notes: p?.notes ?? "", level: p?.level ?? "", focusAreas: p?.focus_areas ?? [], updatedAt: p?.updated_at ?? null },
    balances: (bal.data ?? []).map((x) => ({ serviceId: x.service_id, serviceName: svc.get(x.service_id)?.name ?? "", remaining: x.remaining, pending: x.pending, nextExpiry: x.next_expiry })),
    bookings: views,
    stats: {
      attended: views.filter((b) => b.status === "completed").length,
      noShow: views.filter((b) => b.status === "no_show").length,
      upcoming: views.filter((b) => b.status === "booked" && Date.parse(b.start) >= now).length,
      cancelled: views.filter((b) => b.status === "cancelled").length,
    },
  });
}

// ---- Admin: upcoming group slots ---------------------------------------------
export type GroupSlot = {
  coachId: string; coachName: string; serviceId: string; serviceName: string; start: string; booked: number;
  minParticipants: number; maxParticipants: number; confirmed: boolean;
};
export async function listUpcomingGroupSlots(): Promise<Result<GroupSlot[]>> {
  const db = await trainingDb();
  const { data: svc, error } = await db.from("training_services").select("id,name,min_participants,max_participants").eq("session_type", "group");
  if (error) return fail(error.message);
  if (!svc?.length) return ok([]);
  const { data: bk } = await db.from("training_bookings").select("coach_id,service_id,slot_start,group_confirmed_at")
    .in("service_id", svc.map((s) => s.id)).eq("status", "booked").gte("slot_start", new Date().toISOString()).order("slot_start").limit(1000);
  const { data: co } = await db.from("coaches").select("id,display_name").in("id", uniq((bk ?? []).map((b) => b.coach_id)));
  const cn = new Map((co ?? []).map((c) => [c.id, c.display_name]));
  const sm = new Map(svc.map((s) => [s.id, s]));
  const groups = new Map<string, GroupSlot>();
  for (const b of bk ?? []) {
    const key = `${b.coach_id}|${b.service_id}|${b.slot_start}`;
    const s = sm.get(b.service_id)!;
    const g = groups.get(key) ?? {
      coachId: b.coach_id, coachName: cn.get(b.coach_id) ?? "", serviceId: b.service_id, serviceName: s.name, start: b.slot_start, booked: 0,
      minParticipants: s.min_participants, maxParticipants: s.max_participants, confirmed: false,
    };
    g.booked += 1;
    g.confirmed = g.confirmed || b.group_confirmed_at !== null;
    groups.set(key, g);
  }
  return ok(Array.from(groups.values()));
}

// ---- Coach: athletes I train ---------------------------------------------------
export async function listMyTrainingAthletes(): Promise<Result<{ coachId: string | null; athletes: { id: string; name: string; next: string | null; sessions: number }[] }>> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return ok({ coachId: null, athletes: [] });
  const db = await trainingDb();
  const { data: coach } = await db.from("coaches").select("id").eq("profile_id", user.id).maybeSingle();
  if (!coach) return ok({ coachId: null, athletes: [] });
  const { data: bk, error } = await db.from("training_bookings").select("athlete_id,slot_start,status").eq("coach_id", coach.id).neq("status", "cancelled").order("slot_start").limit(2000);
  if (error) return fail(error.message);
  const ids = uniq((bk ?? []).map((b) => b.athlete_id));
  const { data: at } = ids.length ? await db.from("athletes").select("id,first_name,last_name").in("id", ids) : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const now = Date.now();
  return ok({
    coachId: coach.id,
    athletes: (at ?? []).map((a) => {
      const mine = (bk ?? []).filter((b) => b.athlete_id === a.id);
      const next = mine.find((b) => b.status === "booked" && Date.parse(b.slot_start) >= now)?.slot_start ?? null;
      return { id: a.id, name: `${a.first_name} ${a.last_name}`, next, sessions: mine.length };
    }).sort((x, y) => x.name.localeCompare(y.name)),
  });
}

// ---- Public catalogue (no login) ---------------------------------------------
export type PublicCatalog = {
  org: { id: string; name: string; slug: string; timezone: string; currency: string };
  settings: TrainingSettings;
  services: TrainingService[];
  coaches: TrainingCoach[];
  venues: TrainingVenue[];
  availability: AvailabilityData;
  busy: SlotBusy[];
  consents: { key: string; title: string; version: number; required: boolean }[];
  requiresVpc: boolean;
};

type RawCatalog = {
  org: PublicCatalog["org"];
  settings: { cancellation_hours: number; slot_step_min: number; lead_hours: number; horizon_days: number };
  services: { id: string; slug: string; name: string; description: string | null; duration_min: number; price: number; currency: string; session_type: SessionType; max_participants: number; min_participants: number; venue_id: string | null; location_text: string | null; color: string | null }[];
  packages: { id: string; service_id: string; name: string; sessions: number; price: number; validity_days: number | null; description: string | null }[];
  coaches: { id: string; name: string; title: string | null; serves: string[] }[];
  venues: { id: string; name: string; address: string | null; postal_code: string | null; city: string | null; opening_hours: OpeningHours }[];
  templates: { coach_id: string; venue_id: string | null; service_id: string | null; weekday: number; start_time: string; end_time: string; capacity: number; valid_from: string | null; valid_until: string | null }[];
  windows: { coach_id: string; venue_id: string | null; service_id: string | null; starts_at: string; ends_at: string; capacity: number }[];
  blackouts: { coach_id: string | null; venue_id: string | null; starts_at: string; ends_at: string }[];
  busy: { coach_id: string; service_id: string; start: string; end: string; booked: number }[];
  consents: PublicCatalog["consents"];
  requires_vpc: boolean;
};

export async function getPublicCatalog(slug: string): Promise<PublicCatalog | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const supabase = (await createClient()) as unknown as Awaited<ReturnType<typeof trainingDb>>;
  const now = new Date();
  const { data, error } = await supabase.rpc("training_public_catalog", { p_slug: slug, p_from: now.toISOString(), p_to: new Date(now.getTime() + 62 * 864e5).toISOString() });
  if (error || !data) return null;
  const r = data as unknown as RawCatalog;
  const coaches: TrainingCoach[] = r.coaches.map((c) => ({ id: c.id, name: c.name, title: c.title, serves: c.serves ?? [], isActive: true }));
  return {
    org: r.org,
    settings: { ...DEFAULT_SETTINGS, enabled: true, cancellationHours: Number(r.settings.cancellation_hours ?? 24), slotStepMin: r.settings.slot_step_min ?? 30, leadHours: r.settings.lead_hours ?? 0, horizonDays: r.settings.horizon_days ?? 28 },
    services: r.services.map((s, i) => ({
      id: s.id, slug: s.slug, name: s.name, description: s.description, sessionType: s.session_type, maxParticipants: s.max_participants,
      minParticipants: s.min_participants, durationMin: s.duration_min, price: Number(s.price), currency: s.currency, venueId: s.venue_id,
      locationText: s.location_text, color: s.color, isActive: true, sortOrder: i, creditCategory: "personal", creditsRequired: 0,
      coachIds: coaches.filter((c) => c.serves.includes(s.slug)).map((c) => c.id),
      packages: r.packages.filter((p) => p.service_id === s.id).map((p, j) => ({ id: p.id, serviceId: p.service_id, name: p.name, sessions: p.sessions, price: Number(p.price), validityDays: p.validity_days, isActive: true, sortOrder: j, description: p.description })),
    })),
    coaches,
    venues: r.venues.map((v) => ({ id: v.id, name: v.name, address: v.address, postalCode: v.postal_code, city: v.city, openingHours: v.opening_hours, isActive: true })),
    availability: {
      templates: r.templates.map((t, i) => ({ id: String(i), coachId: t.coach_id, venueId: t.venue_id, serviceId: t.service_id, weekday: t.weekday, startTime: t.start_time, endTime: t.end_time, capacity: t.capacity, validFrom: t.valid_from, validUntil: t.valid_until, isActive: true })),
      windows: r.windows.map((w, i) => ({ id: String(i), coachId: w.coach_id, venueId: w.venue_id, serviceId: w.service_id, startsAt: w.starts_at, endsAt: w.ends_at, capacity: w.capacity, isBooked: false })),
      blackouts: r.blackouts.map((b, i) => ({ id: String(i), coachId: b.coach_id, venueId: b.venue_id, startsAt: b.starts_at, endsAt: b.ends_at, reason: null })),
    },
    busy: r.busy.map((b) => ({ coachId: b.coach_id, serviceId: b.service_id, start: b.start, end: b.end, booked: b.booked })),
    consents: r.consents ?? [],
    requiresVpc: Boolean(r.requires_vpc),
  };
}
