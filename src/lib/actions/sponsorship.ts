"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import {
  SPONSORSHIP_COLUMNS,
  sponsorshipDbErrorKey,
  sponsorshipErrorKey,
  sponsorshipFromRow,
  sponsorshipSchema,
  sponsorshipToRow,
  type SponsorshipInput,
} from "@/lib/people/sponsorship";
import { logError } from "@/lib/log";
import { asBillingClient, billingDb } from "@/lib/people/billing-athletes";
import type { Json } from "@/types/database";

export type { SponsorshipInput } from "@/lib/people/sponsorship";

/** One open invoice the admin action changes (preview + result). */
export type SponsorshipInvoiceChange = { invoiceId: string; number: string; currency: string; amount: number; method: "cancellation" | "credit_note" };

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function revalidatePlayer(athleteId: string, familyId?: string | null) {
  revalidatePath(`/admin/athletes/${athleteId}`);
  revalidatePath("/admin/athletes");
  revalidatePath("/admin/sponsorships");
  if (familyId) revalidatePath(`/admin/families/${familyId}`);
}

/**
 * Set / change / end a player's sponsorship (admin or finance). The database
 * guard refuses anyone else, stamps sponsored_by / sponsored_at and writes the
 * audit row; this adds the intent entry.
 */
export async function updateAthleteSponsorship(athleteId: string, input: SponsorshipInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "finance"]);
  if (!me) return { ok: false, error: t("sponsorship.errors.forbidden") };
  if (!uuidRe.test(athleteId)) return { ok: false, error: t("sponsorship.errors.notFound") };
  const p = sponsorshipSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(sponsorshipErrorKey(p.error)) };
  // Finance reads billing columns through billing_athletes and writes through
  // athlete_sponsorship_set (20250420106300: no athletes table access for finance).
  const db = await billingDb();
  const { data: before } = await db
    .from("billing_athletes")
    .select(`id,family_id,${SPONSORSHIP_COLUMNS}`)
    .eq("id", athleteId)
    .eq("org_id", me.orgId)
    .maybeSingle();
  if (!before) return { ok: false, error: t("sponsorship.errors.notFound") };
  const row = sponsorshipToRow(p.data);
  const { error } = await db.rpc("athlete_sponsorship_set", { p_athlete: athleteId, p_family: null, p_row: row as unknown as Json });
  if (error) {
    logError("updateAthleteSponsorship", error);
    return { ok: false, error: t.dynamic(sponsorshipDbErrorKey(error.message)) };
  }
  const old = sponsorshipFromRow(before);
  await writeAudit(me, "athlete.sponsorship.update", "athletes", athleteId, {
    before: { kind: old.kind, percent: old.percent, scope: old.scope, sponsor: old.sponsorName, from: old.from, until: old.until },
    after: { kind: row.sponsorship_kind, percent: row.sponsorship_percent, scope: row.sponsorship_scope, sponsor: row.sponsor_name,
      from: row.sponsorship_from, until: row.sponsorship_until },
  });
  revalidatePlayer(athleteId, (before as { family_id?: string }).family_id);
  return { ok: true, message: t("sponsorship.saved") };
}

/** Family shortcut: the same sponsorship on every player of the family (admin or finance). */
export async function sponsorFamilyPlayers(familyId: string, input: SponsorshipInput): Promise<ActionResult<{ count: number }>> {
  const { me, t } = await requireRole(["admin", "finance"]);
  if (!me) return { ok: false, error: t("sponsorship.errors.forbidden") };
  if (!uuidRe.test(familyId)) return { ok: false, error: t("sponsorship.errors.notFound") };
  const p = sponsorshipSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(sponsorshipErrorKey(p.error)) };
  const supabase = await createClient();
  const { data: fam } = await supabase.from("families").select("id").eq("id", familyId).eq("org_id", me.orgId).maybeSingle();
  if (!fam) return { ok: false, error: t("sponsorship.errors.notFound") };
  const row = sponsorshipToRow(p.data);
  const { data, error } = await asBillingClient(supabase)
    .rpc("athlete_sponsorship_set", { p_athlete: null, p_family: familyId, p_row: row as unknown as Json });
  if (error) {
    logError("sponsorFamilyPlayers", error);
    return { ok: false, error: t.dynamic(sponsorshipDbErrorKey(error.message)) };
  }
  const ids = (data ?? []) as string[];
  await writeAudit(me, "family.sponsorship.update", "families", familyId, {
    athletes: ids, kind: row.sponsorship_kind, percent: row.sponsorship_percent, scope: row.sponsorship_scope, sponsor: row.sponsor_name,
  });
  revalidatePath(`/admin/families/${familyId}`);
  revalidatePath("/admin/athletes");
  for (const id of ids) revalidatePath(`/admin/athletes/${id}`);
  return { ok: true, message: t("sponsorship.family.saved", { count: ids.length }), data: { count: ids.length } };
}

function changesFrom(raw: unknown): SponsorshipInvoiceChange[] {
  const lines = ((raw as { lines?: unknown[] } | null)?.lines ?? []) as {
    invoice_id: string; number: string | null; currency: string | null; amount: number | string; method: string | null;
  }[];
  return lines.map((l) => ({
    invoiceId: l.invoice_id,
    number: l.number ?? "",
    currency: l.currency ?? "",
    amount: Number(l.amount),
    method: l.method === "cancellation" ? "cancellation" : "credit_note",
  }));
}

/** Dry run for the confirmation dialog: which open invoices would change, and how. */
export async function previewSponsorshipOpenInvoices(athleteId: string): Promise<ActionResult<SponsorshipInvoiceChange[]>> {
  const { me, t } = await requireRole(["admin", "finance"]);
  if (!me) return { ok: false, error: t("sponsorship.errors.forbidden") };
  if (!uuidRe.test(athleteId)) return { ok: false, error: t("sponsorship.errors.notFound") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sponsorship_apply_open_invoices", { p_athlete: athleteId, p_dry_run: true });
  if (error) return { ok: false, error: t.dynamic(sponsorshipDbErrorKey(error.message)) };
  return { ok: true, data: changesFrom(data) };
}

/**
 * Admin action "Apply sponsorship to open invoices": full sponsorship cancels
 * unpaid season / recurring invoices (reason = the sponsorship), otherwise a
 * labelled credit note. Audited in SQL and here.
 */
export async function applySponsorshipOpenInvoices(athleteId: string): Promise<ActionResult<SponsorshipInvoiceChange[]>> {
  const { me, t } = await requireRole(["admin", "finance"]);
  if (!me) return { ok: false, error: t("sponsorship.errors.forbidden") };
  if (!uuidRe.test(athleteId)) return { ok: false, error: t("sponsorship.errors.notFound") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sponsorship_apply_open_invoices", { p_athlete: athleteId, p_dry_run: false });
  if (error) {
    logError("applySponsorshipOpenInvoices", error);
    return { ok: false, error: t.dynamic(sponsorshipDbErrorKey(error.message)) };
  }
  const changes = changesFrom(data);
  await writeAudit(me, "athlete.sponsorship.apply_open_invoices", "athletes", athleteId, {
    invoices: changes.map((c) => ({ id: c.invoiceId, amount: c.amount, method: c.method })),
  });
  revalidatePlayer(athleteId);
  revalidatePath("/admin/invoices");
  for (const c of changes) revalidatePath(`/admin/invoices/${c.invoiceId}`);
  return { ok: true, message: t("sponsorship.apply.done", { count: changes.length }), data: changes };
}
