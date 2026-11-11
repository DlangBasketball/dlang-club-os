import { createClient } from "@/lib/supabase/server";
import { getBookingDetail } from "@/lib/data/training-admin";

export async function getAdminBookingFull(id: string) {
  const base = await getBookingDetail(id);
  if (base.error) return base;
  if (!base.data) return { data: null, error: null } as const;
  const supabase = await createClient();
  const [{ data: slots }, invoice] = await Promise.all([
    supabase.from("coach_availability").select("id,coach_id,starts_at").eq("is_booked", false).gte("starts_at", new Date().toISOString()).order("starts_at").limit(20),
    base.data.invoiceId ? supabase.from("invoices").select("id,number,status").eq("id", base.data.invoiceId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const coachIds = Array.from(new Set((slots ?? []).map((s) => s.coach_id)));
  const coaches = coachIds.length ? await supabase.from("coaches").select("id,display_name").in("id", coachIds) : { data: [] as { id: string; display_name: string }[] };
  const cN = new Map((coaches.data ?? []).map((c) => [c.id, c.display_name]));
  const inv = invoice.data as { id: string; number: string; status: string } | null;
  return {
    data: {
      ...base.data,
      invoice: inv ? { id: inv.id, number: inv.number, status: inv.status } : null,
      rescheduleSlots: (slots ?? []).map((s) => ({ id: s.id, coachName: cN.get(s.coach_id) ?? "Coach", start: s.starts_at })),
    },
    error: null,
  } as const;
}
