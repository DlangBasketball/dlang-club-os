"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import { getI18n, getLocaleContext, getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { addDayKey, zonedDayKey } from "@/lib/staff/hours";
import type { Json } from "@/types/database";
import { getStripe } from "@/lib/stripe";
import { applicationFee, connectOptions } from "@/lib/stripe-connect";
import { getOrgPaymentProfile } from "@/lib/payments/settings";
import { toMinorUnits } from "@/lib/payments/currency";
import { orgReturnOrigin } from "@/lib/tenant/return-origin";
import { getTenant } from "@/lib/tenant/server";
import { opsAdminDb, opsDb, type OpsClient } from "@/lib/operations/db";
import { campaignOpen } from "@/lib/operations/fundraising";
import { dbFail, fail, gate, parseInput, writeAudit, type OpsResult, type Staff } from "@/lib/operations/server";
import {
  campaignSchema,
  deliverableSchema,
  donationSchema,
  publicDonationSchema,
  sponsorSchema,
  uuid,
} from "@/lib/operations/validation";
import { notifyWebsite } from "@/lib/website/webhooks";

/**
 * Sponsors and donations: admin + finance only (coaches and parents never
 * see sponsor or donor data — enforced by RLS). Sponsors and renters are
 * invoiced as external customers (ops_invoices); donations are recorded by
 * staff or arrive through the public campaign page (Stripe Checkout on the
 * club's connected account, recorded by the webhook).
 */

function revalidateMoney() {
  revalidatePath("/admin/operations/sponsors");
  revalidatePath("/admin/operations/donations");
  revalidatePath("/admin/operations/invoices");
  revalidatePath("/admin/operations");
}

/** Find a customer by email (case-insensitive) or create one. */
async function ensureCustomer(db: OpsClient, me: Staff, c: { kind: "company" | "person"; name: string; contactName?: string | null; email: string | null; phone?: string | null }) {
  if (c.email) {
    const { data } = await db.from("ops_customers").select("id").eq("org_id", me.orgId).ilike("email", c.email).maybeSingle();
    if (data) return { id: data.id, error: null };
  }
  const { data, error } = await db.from("ops_customers").insert({
    org_id: me.orgId, kind: c.kind, name: c.name, contact_name: c.contactName ?? null, email: c.email, phone: c.phone ?? null, created_by: me.id,
  }).select("id");
  return { id: data?.[0]?.id ?? null, error };
}

// ---------------------------------------------------------------------------
// Sponsors
// ---------------------------------------------------------------------------
export async function saveSponsor(id: string | null, input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  await assertFeature("ops_sponsors");
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(sponsorSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  let customerId = v.customerId;
  if (!customerId) {
    const c = await ensureCustomer(db, me, { kind: "company", name: v.companyName as string, contactName: v.contactName, email: v.email, phone: v.phone });
    if (!c.id) return dbFail(t, c.error?.message);
    customerId = c.id;
  }
  const { currency } = await getLocaleContext(me.orgId);
  const row = {
    customer_id: customerId, tier: v.tier, package_name: v.packageName, amount: v.amount, currency: v.currency ?? currency,
    contract_start: v.contractStart, contract_end: v.contractEnd, renewal_reminder_days: v.renewalReminderDays, status: v.status, notes: v.notes,
  };
  const res = id
    ? await db.from("sponsors").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("sponsors").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "sponsor.update" : "sponsor.create", "sponsors", res.data[0].id, { tier: v.tier, amount: v.amount, status: v.status });
  revalidateMoney();
  revalidatePath(`/admin/operations/sponsors/${res.data[0].id}`);
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

export async function saveDeliverable(input: Record<string, unknown>): Promise<OpsResult> {
  await assertFeature("ops_sponsors");
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(deliverableSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { data, error } = await db.from("sponsor_deliverables").insert({
    org_id: me.orgId, sponsor_id: v.sponsorId, kind: v.kind, title: v.title, due_on: v.dueOn, notes: v.notes,
  }).select("id");
  if (error || !data?.length) return dbFail(t, error?.message);
  await writeAudit(me, "sponsor.deliverable.add", "sponsors", v.sponsorId, { kind: v.kind });
  revalidatePath(`/admin/operations/sponsors/${v.sponsorId}`);
  return { ok: true, message: t("operations.messages.saved") };
}

export async function toggleDeliverable(id: string): Promise<OpsResult> {
  await assertFeature("ops_sponsors");
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data: d } = await db.from("sponsor_deliverables").select("id,sponsor_id,done_at").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!d) return fail(t, "operations.errors.notFound");
  const { error } = await db.from("sponsor_deliverables").update({ done_at: d.done_at ? null : new Date().toISOString() }).eq("id", id).eq("org_id", me.orgId);
  if (error) return dbFail(t, error.message);
  await writeAudit(me, d.done_at ? "sponsor.deliverable.reopen" : "sponsor.deliverable.done", "sponsors", d.sponsor_id);
  revalidatePath(`/admin/operations/sponsors/${d.sponsor_id}`);
  revalidatePath("/admin/operations/sponsors");
  return { ok: true, message: t("operations.messages.saved") };
}

export async function invoiceSponsor(id: string): Promise<OpsResult<{ invoiceId: string }>> {
  await assertFeature("ops_sponsors");
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data: s } = await db.from("sponsors").select("*").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!s) return fail(t, "operations.errors.notFound");
  if (s.amount <= 0) return fail(t, "operations.errors.nothingToInvoice");
  const { t: tt, f } = await getI18n(me.orgId);
  const period = s.contract_start && s.contract_end ? f.dateRange(s.contract_start, s.contract_end) : "";
  const line = tt("operations.sponsors.invoiceLine", {
    package: s.package_name ?? tt.dynamic(`operations.sponsors.tiers.${s.tier}`), period,
  }).trim();
  const { data, error } = await db.rpc("ops_create_invoice", {
    p_customer: s.customer_id, p_source: "sponsor", p_source_id: id, p_description: line, p_currency: s.currency,
    p_due_on: addDayKey(zonedDayKey(new Date(), f.timeZone), 30), p_lines: [{ description: line, quantity: 1, unit_price: s.amount }] as unknown as Json,
  });
  const invoiceId = (data as { id?: string } | null)?.id;
  if (error || !invoiceId) return dbFail(t, error?.message);
  await writeAudit(me, "sponsor.invoice", "sponsors", id, { invoice_id: invoiceId, amount: s.amount });
  revalidateMoney();
  revalidatePath(`/admin/operations/sponsors/${id}`);
  return { ok: true, message: t("operations.messages.invoiced"), data: { invoiceId } };
}

// ---------------------------------------------------------------------------
// External invoices
// ---------------------------------------------------------------------------
export async function setOpsInvoiceStatus(id: string, status: "paid" | "cancelled" | "issued"): Promise<OpsResult> {
  await assertFeature("ops_sponsors");
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success || !["paid", "cancelled", "issued"].includes(status)) return fail(t, "operations.errors.notFound");
  const { timeZone } = await getLocaleContext(me.orgId);
  const db = await opsDb();
  const { data, error } = await db.from("ops_invoices")
    .update({ status, paid_on: status === "paid" ? zonedDayKey(new Date(), timeZone) : null }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, `ops_invoice.${status}`, "ops_invoices", id);
  revalidateMoney();
  return { ok: true, message: t("operations.messages.saved") };
}

// ---------------------------------------------------------------------------
// Campaigns + donations
// ---------------------------------------------------------------------------
export async function saveCampaign(id: string | null, input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  await assertFeature("ops_sponsors");
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(campaignSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const { currency } = await getLocaleContext(me.orgId);
  const row = {
    slug: v.slug, title: v.title, description: v.description, goal_amount: v.goalAmount, currency: v.currency ?? currency,
    starts_on: v.startsOn, ends_on: v.endsOn, is_public: v.isPublic, status: v.status,
  };
  const db = await opsDb();
  const res = id
    ? await db.from("fundraising_campaigns").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("fundraising_campaigns").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "campaign.update" : "campaign.create", "fundraising_campaigns", res.data[0].id, { goal: v.goalAmount, status: v.status, public: v.isPublic });
  revalidateMoney();
  notifyWebsite(me.orgId, "campaigns");
  revalidatePath(`/club/donate/${v.slug}`);
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

export async function recordDonation(input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  await assertFeature("ops_sponsors");
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(donationSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  let donorId = v.donorId;
  if (!donorId && v.donorName) {
    const c = await ensureCustomer(db, me, { kind: "person", name: v.donorName, email: v.donorEmail });
    if (!c.id) return dbFail(t, c.error?.message);
    donorId = c.id;
  }
  let currency = v.currency;
  if (!currency && v.campaignId) {
    const { data: camp } = await db.from("fundraising_campaigns").select("currency").eq("id", v.campaignId).eq("org_id", me.orgId).maybeSingle();
    currency = camp?.currency ?? null;
  }
  currency ??= (await getLocaleContext(me.orgId)).currency;
  const { data, error } = await db.from("donations").insert({
    org_id: me.orgId, campaign_id: v.campaignId, donor_id: donorId, amount: v.amount, currency, donated_on: v.donatedOn, purpose: v.purpose,
    method: v.method, is_anonymous: v.isAnonymous, notes: v.notes, created_by: me.id,
  }).select("id");
  if (error || !data?.length) return dbFail(t, error?.message);
  await writeAudit(me, "donation.record", "donations", data[0].id, { amount: v.amount, currency, campaign_id: v.campaignId });
  revalidateMoney();
  notifyWebsite(me.orgId, "campaigns");
  return { ok: true, message: t("operations.messages.donationRecorded"), data: { id: data[0].id } };
}

export async function refundDonation(id: string): Promise<OpsResult> {
  await assertFeature("ops_sponsors");
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data, error } = await db.from("donations").update({ status: "refunded" }).eq("id", id).eq("org_id", me.orgId).eq("status", "received").select("id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, "donation.refund", "donations", id);
  revalidateMoney();
  notifyWebsite(me.orgId, "campaigns");
  return { ok: true, message: t("operations.messages.saved") };
}

/**
 * Public donation page: Stripe Checkout on the club's connected account.
 * The org is resolved from the request host (never from the client); the
 * campaign must be public and open. The webhook records the gift.
 */
export async function startDonationCheckout(input: Record<string, unknown>): Promise<OpsResult<{ url: string }>> {
  await assertFeature("ops_sponsors");
  const tenant = await getTenant();
  const t = await getTranslations(tenant.id);
  if (!tenant.id) return fail(t, "operations.errors.notFound");
  const p = parseInput(publicDonationSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = opsAdminDb();
  const { data: c } = await db.from("fundraising_campaigns").select("id,slug,title,currency,status,starts_on,ends_on,is_public")
    .eq("id", v.campaignId).eq("org_id", tenant.id).maybeSingle();
  const { timeZone } = await getLocaleContext(tenant.id);
  if (!c || !c.is_public || !campaignOpen({ status: c.status, startsOn: c.starts_on, endsOn: c.ends_on }, zonedDayKey(new Date(), timeZone))) {
    return fail(t, "operations.errors.campaignClosed");
  }
  const stripe = getStripe();
  const profile = await getOrgPaymentProfile(tenant.id);
  if (!stripe || !profile.stripeReady) return fail(t, "operations.errors.onlineUnavailable");
  try {
    const amountMinor = toMinorUnits(v.amount, c.currency);
    const fee = profile.stripeAccountId ? await applicationFee(tenant.id, amountMinor) : 0;
    const metadata: Record<string, string> = {
      purpose: "donation", org_id: tenant.id, campaign_id: c.id, donor_name: v.name.slice(0, 160), anonymous: v.anonymous ? "1" : "0",
    };
    const back = `${await orgReturnOrigin(tenant.id)}/club/donate/${c.slug}`;
    const label = t("operations.donate.checkoutLabel", { club: tenant.name, campaign: c.title });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ quantity: 1, price_data: { currency: c.currency.toLowerCase(), unit_amount: amountMinor, product_data: { name: label.slice(0, 250) } } }],
      customer_email: v.email,
      locale: "auto",
      metadata,
      payment_intent_data: { metadata, description: label.slice(0, 250), ...(fee > 0 ? { application_fee_amount: fee } : {}) },
      success_url: `${back}?thanks=1`,
      cancel_url: back,
    }, connectOptions(profile));
    if (!session.url) return fail(t, "operations.errors.onlineUnavailable");
    return { ok: true, data: { url: session.url } };
  } catch (e) {
    logError("operations.donate.checkout", e);
    return fail(t, "operations.errors.onlineUnavailable");
  }
}
