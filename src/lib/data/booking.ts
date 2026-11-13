import { createClient } from "@/lib/supabase/server";
import { getBookingSettings } from "@/lib/data/training-admin";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(d: T): Result<T> => ({ data: d, error: null });
const fail = (e: string): Result<never> => ({ data: null, error: e });
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => Boolean(x))));

export type WizardChild = { id: string; name: string; credits: { personal: number; nutrition: number; mental: number } };
export type WizardService = { id: string; name: string; description: string | null; durationMin: number; priceChf: number; creditCategory: "personal" | "nutrition" | "mental"; creditsRequired: number };
export type WizardSlot = { id: string; coachId: string; coachName: string; start: string; end: string };
export type WizardData = { enabled: boolean; children: WizardChild[]; services: WizardService[]; slots: WizardSlot[] };

export async function getWizardData(): Promise<Result<WizardData>> {
  const supabase = await createClient();
  const settings = await getBookingSettings();

  const [kidsRes, svcRes, slotRes] = await Promise.all([
    supabase.from("athletes").select("id,first_name,last_name").order("first_name"),
    supabase.from("training_services").select("id,name,description,duration_min,price_chf,credit_category,credits_required").eq("is_active", true).order("name"),
    supabase.from("coach_availability").select("id,coach_id,starts_at,ends_at").eq("is_booked", false).gte("starts_at", new Date().toISOString()).order("starts_at").limit(60),
  ]);

  const kidIds = (kidsRes.data ?? []).map((k) => k.id);
  const credits = kidIds.length ? await supabase.from("training_credits").select("athlete_id,credit_category,total_credits,used_credits").in("athlete_id", kidIds) : { data: [] as { athlete_id: string; credit_category: string; total_credits: number; used_credits: number }[] };
  const bal = new Map<string, { personal: number; nutrition: number; mental: number }>();
  for (const c of credits.data ?? []) {
    const e = bal.get(c.athlete_id) ?? { personal: 0, nutrition: 0, mental: 0 };
    (e as Record<string, number>)[c.credit_category] = c.total_credits - c.used_credits;
    bal.set(c.athlete_id, e);
  }

  const coachIds = uniq((slotRes.data ?? []).map((s) => s.coach_id));
  const coaches = coachIds.length ? await supabase.from("coaches").select("id,display_name").in("id", coachIds) : { data: [] as { id: string; display_name: string }[] };
  const cName = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));

  return ok({
    enabled: settings.enabled,
    children: (kidsRes.data ?? []).map((k) => ({ id: k.id, name: `${k.first_name} ${k.last_name}`, credits: bal.get(k.id) ?? { personal: 0, nutrition: 0, mental: 0 } })),
    services: (svcRes.data ?? []).map((s) => ({ id: s.id, name: s.name, description: s.description, durationMin: s.duration_min, priceChf: Number(s.price_chf), creditCategory: s.credit_category, creditsRequired: s.credits_required })),
    slots: (slotRes.data ?? []).map((s) => ({ id: s.id, coachId: s.coach_id, coachName: cName.get(s.coach_id) ?? "Coach", start: s.starts_at, end: s.ends_at })),
  });
}

export type ParentBookingDetail = {
  id: string; athleteName: string; serviceId: string; serviceName: string; coachName: string; coachId: string;
  start: string; end: string | null; status: string; price: number | null; creditsUsed: number;
  invoice: { id: string; number: string; status: string } | null;
  cancellationHours: number;
  rescheduleSlots: { id: string; coachName: string; start: string }[];
};

export async function getParentBookingDetail(id: string): Promise<Result<ParentBookingDetail | null>> {
  const supabase = await createClient();
  const { data: b, error } = await supabase.from("training_bookings").select("id,athlete_id,service_id,coach_id,slot_start,slot_end,status,price_chf,credits_used,invoice_id").eq("id", id).maybeSingle();
  if (error) return fail(error.message);
  if (!b) return ok(null);

  const settings = await getBookingSettings();
  const [a, s, c, inv, slots] = await Promise.all([
    supabase.from("athletes").select("first_name,last_name").eq("id", b.athlete_id).maybeSingle(),
    supabase.from("training_services").select("name").eq("id", b.service_id).maybeSingle(),
    supabase.from("coaches").select("display_name").eq("id", b.coach_id).maybeSingle(),
    b.invoice_id ? supabase.from("invoices").select("id,number,status").eq("id", b.invoice_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("coach_availability").select("id,coach_id,starts_at").eq("is_booked", false).gte("starts_at", new Date().toISOString()).order("starts_at").limit(20),
  ]);
  const coaches = await supabase.from("coaches").select("id,display_name").in("id", uniq((slots.data ?? []).map((x) => x.coach_id)));
  const cN = new Map((coaches.data ?? []).map((x) => [x.id, x.display_name]));
  const invoice = inv.data as { id: string; number: string; status: string } | null;

  return ok({
    id: b.id,
    athleteName: a.data ? `${a.data.first_name} ${a.data.last_name}` : "Athlete",
    serviceId: b.service_id, serviceName: s.data?.name ?? "", coachName: c.data?.display_name ?? "", coachId: b.coach_id,
    start: b.slot_start, end: b.slot_end ?? null, status: b.status, price: b.price_chf ? Number(b.price_chf) : null, creditsUsed: b.credits_used,
    invoice: invoice ? { id: invoice.id, number: invoice.number, status: invoice.status } : null,
    cancellationHours: settings.cancellationHours,
    rescheduleSlots: (slots.data ?? []).map((x) => ({ id: x.id, coachName: cN.get(x.coach_id) ?? "Coach", start: x.starts_at })),
  });
}
