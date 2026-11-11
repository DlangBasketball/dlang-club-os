import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));

// ---- Services --------------------------------------------------------------
export type ServiceRow = { id: string; name: string; description: string | null; durationMin: number; priceChf: number; creditsRequired: number; creditCategory: string; isActive: boolean };
export async function listServices(): Promise<Result<ServiceRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("training_services").select("id,name,description,duration_min,price_chf,credits_required,credit_category,is_active").order("name");
  if (error) return fail(error.message);
  return ok((data ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description, durationMin: s.duration_min, priceChf: Number(s.price_chf), creditsRequired: s.credits_required, creditCategory: s.credit_category, isActive: s.is_active })));
}
export async function getService(id: string): Promise<Result<ServiceRow | null>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("training_services").select("id,name,description,duration_min,price_chf,credits_required,credit_category,is_active").eq("id", id).maybeSingle();
  if (error) return fail(error.message);
  if (!data) return ok(null);
  return ok({ id: data.id, name: data.name, description: data.description, durationMin: data.duration_min, priceChf: Number(data.price_chf), creditsRequired: data.credits_required, creditCategory: data.credit_category, isActive: data.is_active });
}

// ---- Credit packages -------------------------------------------------------
export type PackageRow = { id: string; name: string; creditCategory: string; credits: number; priceChf: number; isActive: boolean };
export async function listCreditPackages(): Promise<Result<PackageRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("credit_packages").select("id,name,credit_category,credits,price_chf,is_active").order("name");
  if (error) return fail(error.message);
  return ok((data ?? []).map((p) => ({ id: p.id, name: p.name, creditCategory: p.credit_category, credits: p.credits, priceChf: Number(p.price_chf), isActive: p.is_active })));
}

// ---- Athletes + their credit balances (for the grant-credits UI) -----------
export type AthleteCredit = { athleteId: string; name: string; personal: number; nutrition: number; mental: number };
export async function listAthleteCredits(): Promise<Result<AthleteCredit[]>> {
  const supabase = await createClient();
  const { data: athletes, error } = await supabase.from("athletes").select("id,first_name,last_name").order("first_name");
  if (error) return fail(error.message);
  const ids = (athletes ?? []).map((a) => a.id);
  const credits = ids.length ? await supabase.from("training_credits").select("athlete_id,credit_category,total_credits,used_credits").in("athlete_id", ids) : { data: [] as { athlete_id: string; credit_category: string; total_credits: number; used_credits: number }[] };
  const bal = new Map<string, { personal: number; nutrition: number; mental: number }>();
  for (const c of credits.data ?? []) {
    const e = bal.get(c.athlete_id) ?? { personal: 0, nutrition: 0, mental: 0 };
    (e as Record<string, number>)[c.credit_category] = c.total_credits - c.used_credits;
    bal.set(c.athlete_id, e);
  }
  return ok((athletes ?? []).map((a) => ({ athleteId: a.id, name: `${a.first_name} ${a.last_name}`, ...(bal.get(a.id) ?? { personal: 0, nutrition: 0, mental: 0 }) })));
}

// ---- Bookings (admin: all) -------------------------------------------------
export type AdminBooking = { id: string; athleteName: string; serviceName: string; coachName: string; start: string; status: string; price: number | null; creditsUsed: number; invoiceId: string | null };
export async function listAllBookings(): Promise<Result<AdminBooking[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("training_bookings").select("id,athlete_id,service_id,coach_id,slot_start,status,price_chf,credits_used,invoice_id").order("slot_start", { ascending: false }).limit(300);
  if (error) return fail(error.message);
  const [aRes, sRes, cRes] = await Promise.all([
    supabase.from("athletes").select("id,first_name,last_name").in("id", uniq((data ?? []).map((b) => b.athlete_id))),
    supabase.from("training_services").select("id,name").in("id", uniq((data ?? []).map((b) => b.service_id))),
    supabase.from("coaches").select("id,display_name").in("id", uniq((data ?? []).map((b) => b.coach_id))),
  ]);
  const aName = new Map((aRes.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  const sName = new Map((sRes.data ?? []).map((s) => [s.id, s.name]));
  const cName = new Map((cRes.data ?? []).map((c) => [c.id, c.display_name]));
  return ok((data ?? []).map((b) => ({ id: b.id, athleteName: aName.get(b.athlete_id) ?? "Athlete", serviceName: sName.get(b.service_id) ?? "Session", coachName: cName.get(b.coach_id) ?? "Coach", start: b.slot_start, status: b.status, price: b.price_chf ? Number(b.price_chf) : null, creditsUsed: b.credits_used, invoiceId: b.invoice_id })));
}

export async function getBookingDetail(id: string): Promise<Result<(AdminBooking & { athleteId: string; serviceName: string; notes: string | null }) | null>> {
  const supabase = await createClient();
  const { data: b, error } = await supabase.from("training_bookings").select("id,athlete_id,service_id,coach_id,slot_start,status,price_chf,credits_used,invoice_id,notes").eq("id", id).maybeSingle();
  if (error) return fail(error.message);
  if (!b) return ok(null);
  const [a, s, c] = await Promise.all([
    supabase.from("athletes").select("first_name,last_name").eq("id", b.athlete_id).maybeSingle(),
    supabase.from("training_services").select("name").eq("id", b.service_id).maybeSingle(),
    supabase.from("coaches").select("display_name").eq("id", b.coach_id).maybeSingle(),
  ]);
  return ok({
    id: b.id, athleteId: b.athlete_id,
    athleteName: a.data ? `${a.data.first_name} ${a.data.last_name}` : "Athlete",
    serviceName: s.data?.name ?? "Session", coachName: c.data?.display_name ?? "Coach",
    start: b.slot_start, status: b.status, price: b.price_chf ? Number(b.price_chf) : null,
    creditsUsed: b.credits_used, invoiceId: b.invoice_id, notes: b.notes,
  });
}

// ---- Coaches + availability (for availability admin) -----------------------
export async function listCoaches(): Promise<Result<{ id: string; name: string; profileId: string | null }[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("coaches").select("id,display_name,profile_id,is_active").eq("is_active", true).order("display_name");
  if (error) return fail(error.message);
  return ok((data ?? []).map((c) => ({ id: c.id, name: c.display_name, profileId: c.profile_id })));
}

export type AvailabilitySlot = { id: string; coachId: string; coachName: string; start: string; end: string; isBooked: boolean };
export async function listAvailability(coachId?: string): Promise<Result<AvailabilitySlot[]>> {
  const supabase = await createClient();
  let q = supabase.from("coach_availability").select("id,coach_id,starts_at,ends_at,is_booked").gte("starts_at", new Date(Date.now() - 864e5).toISOString()).order("starts_at").limit(200);
  if (coachId) q = q.eq("coach_id", coachId);
  const { data, error } = await q;
  if (error) return fail(error.message);
  const coaches = await supabase.from("coaches").select("id,display_name").in("id", uniq((data ?? []).map((s) => s.coach_id)));
  const cName = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));
  return ok((data ?? []).map((s) => ({ id: s.id, coachId: s.coach_id, coachName: cName.get(s.coach_id) ?? "Coach", start: s.starts_at, end: s.ends_at, isBooked: s.is_booked })));
}

/** The coach row for the signed-in coach (own availability management). */
export async function getMyCoach(): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("coaches").select("id,display_name").eq("profile_id", user.id).maybeSingle();
  return data ? { id: data.id, name: data.display_name } : null;
}

// ---- Booking settings (cancellation rules + enabled toggle) ----------------
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
export type BookingSettings = { enabled: boolean; cancellationHours: number; refundCreditsOnCancel: boolean };
export async function getBookingSettings(): Promise<BookingSettings> {
  const me = await getSessionUser();
  if (!me?.orgId) return { enabled: false, cancellationHours: 24, refundCreditsOnCancel: true };
  const admin = createAdminClient();
  const { data } = await admin.from("app_settings").select("settings").eq("org_id", me.orgId).maybeSingle();
  const s = (data?.settings ?? {}) as { bookings_enabled?: boolean; booking?: { cancellation_hours?: number; refund_credits_on_cancel?: boolean } };
  return { enabled: Boolean(s.bookings_enabled), cancellationHours: s.booking?.cancellation_hours ?? 24, refundCreditsOnCancel: s.booking?.refund_credits_on_cancel ?? true };
}
