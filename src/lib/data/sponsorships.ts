import { asBillingClient } from "@/lib/people/billing-athletes";
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import { sponsorshipFromRow, type SponsorshipKind } from "@/lib/people/sponsorship";
import { summarizeSponsorships, type SponsorshipEntry, type SponsorshipSummary } from "@/lib/people/sponsorship-report";

export type Result<T> = { data: T; error: null } | { data: null; error: string };

/** Sponsored players an invoice is for (family + staff views; RLS decides what the caller reads). */
export type InvoiceSponsorship = { athleteId: string; name: string; kind: SponsorshipKind; percent: number | null; sponsorName: string | null };

export async function getInvoiceSponsorships(invoiceId: string): Promise<InvoiceSponsorship[]> {
  try {
    const supabase = await createClient();
    const [{ data: inv }, { data: regs }] = await Promise.all([
      supabase.from("invoices").select("id,athlete_id,registration_id").eq("id", invoiceId).maybeSingle(),
      supabase.from("registrations").select("athlete_id").eq("invoice_id", invoiceId),
    ]);
    if (!inv) return [];
    const ids = Array.from(new Set([inv.athlete_id, ...((regs ?? []) as { athlete_id: string }[]).map((r) => r.athlete_id)].filter((x): x is string => !!x)));
    if (!ids.length) return [];
    const { data } = await asBillingClient(supabase)
      .from("billing_athletes")
      .select("id,first_name,last_name,sponsorship_kind,sponsorship_percent,sponsor_name")
      .in("id", ids)
      .neq("sponsorship_kind", "none");
    return (data ?? []).map((a) => {
      const s = sponsorshipFromRow(a);
      return { athleteId: a.id, name: `${a.first_name} ${a.last_name}`.trim(), kind: s.kind, percent: s.percent, sponsorName: s.sponsorName };
    });
  } catch (e) {
    logError("sponsorship.invoice", e);
    return [];
  }
}

/**
 * Sponsorship ledger for a period (admin / finance; RLS: own club only):
 * every active entry whose service date is in [from, to], with the player
 * name, minus entries whose credit note / cancellation was voided later.
 */
export async function getSponsorshipReport(range: { from: string; to: string }): Promise<Result<{ entries: SponsorshipEntry[]; summary: SponsorshipSummary }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("athlete_sponsorship_entries")
    .select("id,athlete_id,invoice_id,invoice_adjustment_id,scope,method,sponsorship_kind,percent,sponsor_name,list_amount,amount,currency,service_date")
    .gte("service_date", range.from)
    .lte("service_date", range.to)
    .is("voided_at", null)
    .order("service_date", { ascending: true })
    .limit(5000);
  if (error) return { data: null, error: error.message };
  const rows = data ?? [];
  const athleteIds = Array.from(new Set(rows.map((r) => r.athlete_id)));
  const adjIds = rows.map((r) => r.invoice_adjustment_id).filter((x): x is string => !!x);
  const invIds = Array.from(new Set(rows.map((r) => r.invoice_id).filter((x): x is string => !!x)));
  const [ath, adj, inv] = await Promise.all([
    athleteIds.length ? asBillingClient(supabase).from("billing_athletes").select("id,first_name,last_name").in("id", athleteIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    adjIds.length ? supabase.from("invoice_adjustments").select("id,voided_at").in("id", adjIds) : Promise.resolve({ data: [] as { id: string; voided_at: string | null }[] }),
    invIds.length ? supabase.from("invoices").select("id,number").in("id", invIds) : Promise.resolve({ data: [] as { id: string; number: string }[] }),
  ]);
  const names = new Map((ath.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`.trim()]));
  const voided = new Set((adj.data ?? []).filter((a) => a.voided_at).map((a) => a.id));
  const numbers = new Map((inv.data ?? []).map((i) => [i.id, i.number]));
  const entries: SponsorshipEntry[] = rows
    .filter((r) => !r.invoice_adjustment_id || !voided.has(r.invoice_adjustment_id))
    .map((r) => ({
      id: r.id,
      athleteId: r.athlete_id,
      playerName: names.get(r.athlete_id) ?? "—",
      sponsorName: r.sponsor_name,
      scope: r.scope,
      method: r.method,
      percent: Number(r.percent),
      listAmount: Number(r.list_amount),
      amount: Number(r.amount),
      currency: r.currency,
      date: r.service_date,
      invoiceId: r.invoice_id,
      invoiceNumber: r.invoice_id ? numbers.get(r.invoice_id) ?? null : null,
    }));
  return { data: { entries, summary: summarizeSponsorships(entries) }, error: null };
}
