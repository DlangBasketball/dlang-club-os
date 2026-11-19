import { createClient } from "@/lib/supabase/server";
import { getBookingDetail } from "@/lib/data/training-admin";

export async function getAdminBookingFull(id: string) {
  const base = await getBookingDetail(id);
  if (base.error) return base;
  if (!base.data) return { data: null, error: null } as const;
  const supabase = await createClient();
  const [{ data: slots }, invoice, { data: extra }, { data: services }, { data: coachOpts }] = await Promise.all([
    supabase.from("coach_availability").select("id,coach_id,starts_at").eq("is_booked", false).gte("starts_at", new Date().toISOString()).order("starts_at").limit(20),
    base.data.invoiceId ? supabase.from("invoices").select("id,number,status").eq("id", base.data.invoiceId).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("training_bookings").select("service_id,coach_id,slot_end,cancel_reason,cancelled_at").eq("id", id).maybeSingle(),
    supabase.from("training_services").select("id,name,duration_min,is_active").order("name"),
    supabase.from("coaches").select("id,display_name,is_active").order("display_name"),
  ]);
  const ex = (extra ?? null) as { service_id: string; coach_id: string; slot_end: string | null; cancel_reason: string | null; cancelled_at: string | null } | null;
  const coachIds = Array.from(new Set((slots ?? []).map((s) => s.coach_id)));
  const coaches = coachIds.length ? await supabase.from("coaches").select("id,display_name").in("id", coachIds) : { data: [] as { id: string; display_name: string }[] };
  const cN = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));
  const inv = invoice.data as { id: string; number: string; status: string } | null;
  return {
    data: {
      ...base.data,
      invoice: inv ? { id: inv.id, number: inv.number, status: inv.status } : null,
      serviceId: ex?.service_id ?? "", coachId: ex?.coach_id ?? "", end: ex?.slot_end ?? null,
      cancelReason: ex?.cancel_reason ?? null, cancelledAt: ex?.cancelled_at ?? null,
      serviceOptions: (services ?? []).filter((x) => x.is_active || x.id === ex?.service_id).map((x) => ({ id: x.id, name: x.name, durationMin: x.duration_min })),
      coachOptions: (coachOpts ?? []).filter((x) => x.is_active || x.id === ex?.coach_id).map((x) => ({ id: x.id, name: x.display_name })),
      rescheduleSlots: (slots ?? []).map((s) => ({ id: s.id, coachName: cN.get(s.coach_id) ?? "Coach", start: s.starts_at })),
    },
    error: null,
  } as const;
}
