"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getTranslations } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTenant, orgMatchesTenant, tenantMatchesOrg } from "@/lib/tenant/server";
import { campsAdminDb } from "@/lib/camps/db";
import { getMemberCamp, getPublicCamp, loadPricingDiscounts, type PublicCamp } from "@/lib/camps/data";
import { buildCampQuote, type QuoteChild } from "@/lib/camps/quote";
import {
  campErrorKey, campParentRegistrationSchema, campPublicRegistrationSchema, firstIssueKey,
  type CampParentRegistrationInput, type CampPublicRegistrationInput,
} from "@/lib/camps/validation";
import type { BatchQuote } from "@/lib/pricing/discounts";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getOrgAlertRecipients } from "@/lib/data/org-alert-recipients";
import { sendEmail } from "@/lib/email/resend";
import { adminRegistrationAlert, registrationConfirmation } from "@/lib/email/templates";
import type { Json } from "@/types/database";
import { logError } from "@/lib/log";
import { getRegistrationConfig, storeRegistrationExtras, type ChildAnswers } from "@/lib/registration-form/server";
import { resolveConfig, validateRegistrationExtras, type BuiltinField, type ChildExtras } from "@/lib/registration-form/config";
import { issueContractsForRegistrations } from "@/lib/contracts/server";

/**
 * Camp registration (public camp page + parent app).
 *
 * Tenant: the club is always the one that owns the camp, resolved server-side
 * from the slug (public) or the signed-in parent's org (parent app), and must
 * match the host's tenant. Prices are never taken from the client: the quote
 * is rebuilt here from the database and re-checked by register_camp().
 */

export type QuoteLine = { name: string; amount: number };
export type QuoteItem = { key: string; listAmount: number; discounts: QuoteLine[]; total: number };
export type QuoteView = {
  ok: boolean;
  error?: string;
  currency: string;
  items: QuoteItem[];
  listTotal: number;
  discountTotal: number;
  total: number;
  promo: "applied" | "rejected" | "none";
  promoMessage?: string;
};

export type CampSubmitResult = { ok: false; error: string; errors?: Record<string, string> };

const quoteChild = z.object({
  key: z.string().max(40),
  priceOptionId: z.string().max(40).default(""),
  ageGroupId: z.string().max(40).default(""),
  days: z.array(z.string().max(10)).max(63).default([]),
  dob: z.string().max(10).nullable().default(null),
  athleteId: z.string().max(40).nullable().default(null),
});
const quoteInput = z.object({
  slug: z.string().max(120).optional(),
  programId: z.string().uuid().optional(),
  editionId: z.string().uuid(),
  children: z.array(quoteChild).min(1).max(10),
  promoCode: z.string().max(40).default(""),
});
export type CampQuoteInput = z.input<typeof quoteInput>;

function view(q: BatchQuote, promoCode: string, t: Awaited<ReturnType<typeof getTranslations>>): QuoteView {
  const entered = promoCode.trim() !== "";
  const rejected = entered && q.promoRejection !== null;
  return {
    ok: true,
    currency: q.currency,
    items: q.items.map((i) => ({ key: i.key, listAmount: i.listAmount, total: i.total, discounts: i.discounts.map((d) => ({ name: d.name, amount: d.amount })) })),
    listTotal: q.listTotal,
    discountTotal: q.discountTotal,
    total: q.total,
    promo: !entered ? "none" : rejected ? "rejected" : "applied",
    promoMessage: rejected ? t.dynamic(`camps.promo.${q.promoRejection}`, undefined, t("camps.promo.UNKNOWN_CODE")) : undefined,
  };
}

const emptyView = (currency: string, error: string): QuoteView => ({ ok: false, error, currency, items: [], listTotal: 0, discountTotal: 0, total: 0, promo: "none" });

/** Parent app: the signed-in user's families (guardian links) inside their org. */
async function guardianFamilies(profileId: string, orgId: string): Promise<string[]> {
  const db = campsAdminDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", profileId);
  const ids = (links ?? []).map((l) => l.family_id);
  if (!ids.length) return [];
  const { data: fams } = await db.from("families").select("id").eq("org_id", orgId).in("id", ids);
  return (fams ?? []).map((f) => f.id);
}

type ParentContext = { orgId: string; profileId: string; familyId: string; athletes: Map<string, { dob: string | null; name: string }>; existingSiblings: number };

/** Resolves the parent's family + athletes for the chosen children (all from one family). */
async function parentContext(camp: PublicCamp, athleteIds: string[]): Promise<ParentContext | null> {
  const me = await getSessionUser();
  if (!me?.orgId || me.orgId !== camp.program.orgId || !(await tenantMatchesOrg(me.orgId))) return null;
  const families = await guardianFamilies(me.id, me.orgId);
  if (!families.length) return null;
  const db = campsAdminDb();
  const { data: athletes } = await db.from("athletes").select("id,family_id,dob,first_name,last_name").eq("org_id", me.orgId).in("family_id", families);
  const map = new Map((athletes ?? []).map((a) => [a.id, a]));
  const chosen = athleteIds.map((id) => map.get(id));
  if (chosen.some((a) => !a)) return null;
  const familyId = chosen[0]!.family_id;
  if (chosen.some((a) => a!.family_id !== familyId)) return null;
  // Siblings already registered for this camp (any edition), not among the chosen children.
  const { data: regs } = await db.from("registrations").select("athlete_id").eq("org_id", me.orgId).eq("program_id", camp.program.id)
    .in("status", ["pending", "confirmed", "completed"]).in("athlete_id", (athletes ?? []).filter((a) => a.family_id === familyId).map((a) => a.id));
  const existing = new Set((regs ?? []).map((r) => r.athlete_id).filter((id) => !athleteIds.includes(id)));
  return {
    orgId: me.orgId, profileId: me.id, familyId,
    athletes: new Map(chosen.map((a) => [a!.id, { dob: a!.dob, name: `${a!.first_name} ${a!.last_name}` }])),
    existingSiblings: existing.size,
  };
}

async function publicCampFor(slug: string): Promise<PublicCamp | null> {
  const camp = await getPublicCamp(slug);
  if (!camp) return null;
  // A club-named host may only serve its own club's camps.
  if (!orgMatchesTenant(camp.program.orgId, await getTenant())) return null;
  return camp;
}

/** Live price breakdown (no writes). Public: by slug; parent app: by programme id. */
export async function quoteCamp(input: CampQuoteInput): Promise<QuoteView> {
  const p = quoteInput.safeParse(input);
  const t = await getTranslations();
  if (!p.success) return emptyView("", t("camps.errors.generic"));
  const v = p.data;
  let camp: PublicCamp | null = null;
  let discountsFamily: string | null = null;
  let existing = 0;
  let dobs = new Map<string, string | null>();
  if (v.slug) {
    camp = await publicCampFor(v.slug);
  } else if (v.programId) {
    const me = await getSessionUser();
    if (me?.orgId) camp = await getMemberCamp(me.orgId, v.programId);
    if (camp) {
      const ids = v.children.map((c) => c.athleteId).filter((x): x is string => !!x);
      const ctx = ids.length ? await parentContext(camp, ids) : null;
      if (ctx) {
        discountsFamily = ctx.familyId;
        existing = ctx.existingSiblings;
        dobs = new Map(Array.from(ctx.athletes.entries()).map(([k, a]) => [k, a.dob]));
      }
    }
  }
  if (!camp) return emptyView("", t("camps.errors.db.PROGRAM_NOT_OPEN"));
  const tt = await getTranslations(camp.program.orgId);
  const discounts = await loadPricingDiscounts(camp.program.orgId, discountsFamily);
  const children: QuoteChild[] = v.children
    .filter((c) => c.priceOptionId)
    .map((c) => ({ key: c.key, priceOptionId: c.priceOptionId, ageGroupId: c.ageGroupId, days: c.days, dob: c.athleteId ? dobs.get(c.athleteId) ?? null : c.dob }));
  if (!children.length) return { ...emptyView(camp.program.currency, ""), ok: true };
  const q = buildCampQuote({ camp, editionId: v.editionId, children, discounts, promoCode: v.promoCode, existingSiblings: existing, partial: true });
  if (!q.ok) return emptyView(camp.program.currency, tt.dynamic(`camps.errors.db.${q.error}`, undefined, tt("camps.errors.generic")));
  return view(q.quote, v.promoCode, tt);
}

function payloadDiscounts(q: BatchQuote, key: string, promoCode: string) {
  const item = q.items.find((i) => i.key === key);
  return (item?.discounts ?? []).map((d) => ({ discount_id: d.discountId, amount: d.amount, code: d.rule === "promo_code" ? promoCode.trim().toUpperCase() : null }));
}

function promoBlocks(q: BatchQuote, promoCode: string): boolean {
  return promoCode.trim() !== "" && q.promoRejection !== null && q.promoRejection !== "NOT_COMBINABLE";
}

async function siteBase(orgId: string): Promise<string> {
  const org = await getOrgEmailContext(orgId);
  return org.link("/");
}

/**
 * Guest account for a non-member family: the parent chose a password or a
 * sign-in link. register_camp() already created the pending parent
 * invitation for THIS club and family, so the new login is linked to them
 * by handle_new_user() — never to a club named by the client.
 */
async function createGuestAccount(orgId: string, email: string, name: string, account: { mode: "none" | "password" | "link"; password?: string }, locale: string) {
  if (account.mode === "none") return;
  const base = (await siteBase(orgId)).replace(/\/$/, "");
  const redirectTo = `${base}/auth/callback?next=/parent/home`;
  try {
    if (account.mode === "password" && account.password) {
      const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // Sends the email-confirmation message; an existing account is left untouched.
      const { error } = await anon.auth.signUp({ email, password: account.password, options: { emailRedirectTo: redirectTo, data: { full_name: name, locale } } });
      if (error) logError("camp.guestSignup", error);
    } else {
      const admin = campsAdminDb();
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { invited_role: "parent", full_name: name, locale } });
      if (error && !/already/i.test(error.message)) logError("camp.guestInvite", error);
    }
  } catch (e) {
    logError("camp.guestAccount", e);
  }
}

async function notify(orgId: string, programName: string, parentName: string, parentEmail: string | null, children: string[], invoiceNumber: string, total: number) {
  try {
    const org = await getOrgEmailContext(orgId);
    if (parentEmail) {
      const conf = registrationConfirmation({
        ...org.brand, parentName, programName, children, invoiceNumber, totalChf: total,
        dueDateLabel: org.f.date(new Date(Date.now() + 14 * 864e5)), manageUrl: org.link("/login"),
      });
      await sendEmail({ to: parentEmail, subject: conf.subject, html: conf.html, fromName: org.senderName ?? org.clubName });
    }
    for (const to of await getOrgAlertRecipients(orgId)) {
      const alert = adminRegistrationAlert({ ...org.brand, programName, parentName, children, totalChf: total, invoiceNumber });
      await sendEmail({ to, subject: alert.subject, html: alert.html, fromName: org.senderName ?? org.clubName });
    }
  } catch (e) {
    logError("camp.notify", e);
  }
}

const accountSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("link") }),
  z.object({ mode: z.literal("password"), password: z.string().min(10, "camps.errors.password").max(72, "camps.errors.password") }),
]);
export type GuestAccountInput = z.input<typeof accountSchema>;

function flatten(err: z.ZodError, t: Awaited<ReturnType<typeof getTranslations>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[i.path.join(".")] = t.dynamic(i.message, undefined, t("camps.errors.generic"));
  return out;
}

/** Public camp page submission (guests and members alike). Redirects on success. */
export async function submitCampPublic(input: CampPublicRegistrationInput, accountInput: GuestAccountInput = { mode: "none" }): Promise<CampSubmitResult> {
  const t0 = await getTranslations();
  const p = campPublicRegistrationSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t0.dynamic(firstIssueKey(p.error), undefined, t0("camps.errors.generic")), errors: flatten(p.error, t0) };
  const acc = accountSchema.safeParse(accountInput);
  if (!acc.success) return { ok: false, error: t0("camps.errors.password"), errors: { password: t0("camps.errors.password") } };
  const v = p.data;

  const camp = await publicCampFor(v.programSlug);
  if (!camp) return { ok: false, error: t0("camps.errors.db.PROGRAM_NOT_OPEN") };
  const orgId = camp.program.orgId;
  const t = await getTranslations(orgId);

  const missing = camp.consents.filter((c) => c.required && !v.consents.includes(c.key));
  if (missing.length) return { ok: false, error: t("registration.consents.missing") };

  // Registration form editor (default config = the original form).
  const config = await getRegistrationConfig(orgId, camp.program.id);
  const extraErrors: Record<string, string> = {};
  for (const [k, key] of Object.entries(validateRegistrationExtras(config, { address: v.parent.address }, {}, "parent").errors)) extraErrors[`parent.${k}`] = t.dynamic(key);
  const perChild = v.children.map((c, i) => {
    const r = validateRegistrationExtras(config, { ...(c.extras as ChildExtras), gender: c.gender, allergies: c.allergies, conditions: c.conditions, medicalNotes: c.medicalNotes }, c.answers, "child");
    for (const [k, key] of Object.entries(r.errors)) extraErrors[`${i}.${k}`] = t.dynamic(key);
    return r;
  });
  if (Object.keys(extraErrors).length) return { ok: false, error: t("forms.errors.fixFields"), errors: extraErrors };
  const keep = (k: BuiltinField, val: string) => (config.builtin[k].shown ? val : "");

  const discounts = await loadPricingDiscounts(orgId, null);
  const q = buildCampQuote({
    camp, editionId: v.editionId, discounts, promoCode: v.promoCode,
    children: v.children.map((c, i) => ({ key: String(i), priceOptionId: c.priceOptionId, ageGroupId: c.ageGroupId, days: c.days, dob: c.dob })),
  });
  if (!q.ok) return { ok: false, error: t.dynamic(`camps.errors.db.${q.error}`, undefined, t("camps.errors.generic")) };
  if (promoBlocks(q.quote, v.promoCode)) return { ok: false, error: t.dynamic(`camps.promo.${q.quote.promoRejection}`, undefined, t("camps.promo.UNKNOWN_CODE")) };

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const payload = {
    mode: "public",
    program_id: camp.program.id,
    edition_id: v.editionId,
    parent: {
      name: v.parent.name, email: v.parent.email, phone: v.parent.phone, address: keep("address", v.parent.address),
      emergency_name: v.parent.emergencyName, emergency_phone: v.parent.emergencyPhone,
    },
    children: v.children.map((c, i) => ({
      first_name: c.firstName, last_name: c.lastName, dob: c.dob, gender: keep("gender", c.gender),
      allergies: keep("allergies", c.allergies), conditions: keep("conditions", c.conditions), medical_notes: keep("medicalNotes", c.medicalNotes),
      age_group_id: c.ageGroupId, price_option_id: c.priceOptionId, days: c.days,
      list_amount: q.quote.items[i].listAmount,
      discounts: payloadDiscounts(q.quote, String(i), v.promoCode),
    })),
    consents: v.consents,
    ip,
  };
  const { data, error } = await campsAdminDb().rpc("register_camp", { p_payload: payload as unknown as Json });
  if (error) {
    logError("camp.registerPublic", error);
    return { ok: false, error: t.dynamic(campErrorKey(error.message), undefined, t("camps.errors.generic")) };
  }
  const r = (data ?? {}) as { invoice_number?: string; total?: number; registration_ids?: string[]; athlete_ids?: string[] };
  const regIds = r.registration_ids ?? [];
  const athIds = r.athlete_ids ?? [];
  await storeRegistrationExtras(orgId, camp.program.id, config, perChild
    .map((pc, i): ChildAnswers => ({ athleteId: athIds[i], registrationId: regIds[i], extras: pc.extras, answers: pc.answers }))
    .filter((x) => x.athleteId && x.registrationId));
  await issueContractsForRegistrations(orgId, regIds);
  await createGuestAccount(orgId, v.parent.email, v.parent.name, acc.data, t.locale);
  await notify(orgId, camp.program.name, v.parent.name, v.parent.email, v.children.map((c) => `${c.firstName} ${c.lastName}`), r.invoice_number ?? "", Number(r.total ?? 0));
  const qs = new URLSearchParams({ ref: r.invoice_number ?? "", account: acc.data.mode });
  redirect(`/register/${v.programSlug}/success?${qs.toString()}`);
}

/** Parent app submission: existing children of the signed-in guardian's family. */
export async function submitCampParent(input: CampParentRegistrationInput): Promise<CampSubmitResult> {
  const t0 = await getTranslations();
  const p = campParentRegistrationSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t0.dynamic(firstIssueKey(p.error), undefined, t0("camps.errors.generic")), errors: flatten(p.error, t0) };
  const v = p.data;
  const me = await getSessionUser();
  if (!me?.orgId) return { ok: false, error: t0("camps.errors.notPermitted") };
  const camp = await getMemberCamp(me.orgId, v.programId);
  if (!camp) return { ok: false, error: t0("camps.errors.db.PROGRAM_NOT_OPEN") };
  const ctx = await parentContext(camp, v.children.map((c) => c.athleteId));
  if (!ctx) return { ok: false, error: t0("camps.errors.notPermitted") };
  const t = await getTranslations(ctx.orgId);

  const missing = camp.consents.filter((c) => c.required && !v.consents.includes(c.key));
  if (missing.length) return { ok: false, error: t("registration.consents.missing") };

  // Custom questions only: the children's records already exist.
  const config = await getRegistrationConfig(ctx.orgId, camp.program.id);
  const questionsOnly = { ...config, builtin: resolveConfig(null).builtin };
  const extraErrors: Record<string, string> = {};
  const perChild = v.children.map((c) => {
    const r = validateRegistrationExtras(questionsOnly, {}, c.answers, "child");
    for (const [k, key] of Object.entries(r.errors)) if (k.startsWith("q.")) extraErrors[`${c.athleteId}.${k}`] = t.dynamic(key);
    return { athleteId: c.athleteId, answers: r.answers };
  });
  if (Object.keys(extraErrors).length) return { ok: false, error: t("forms.errors.fixFields"), errors: extraErrors };

  const discounts = await loadPricingDiscounts(ctx.orgId, ctx.familyId);
  const q = buildCampQuote({
    camp, editionId: v.editionId, discounts, promoCode: v.promoCode, existingSiblings: ctx.existingSiblings,
    children: v.children.map((c) => ({ key: c.athleteId, priceOptionId: c.priceOptionId, ageGroupId: c.ageGroupId, days: c.days, dob: ctx.athletes.get(c.athleteId)?.dob ?? null })),
  });
  if (!q.ok) return { ok: false, error: t.dynamic(`camps.errors.db.${q.error}`, undefined, t("camps.errors.generic")) };
  if (promoBlocks(q.quote, v.promoCode)) return { ok: false, error: t.dynamic(`camps.promo.${q.quote.promoRejection}`, undefined, t("camps.promo.UNKNOWN_CODE")) };

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const payload = {
    mode: "parent",
    program_id: camp.program.id,
    edition_id: v.editionId,
    family_id: ctx.familyId,
    registered_by: ctx.profileId,
    children: v.children.map((c) => ({
      athlete_id: c.athleteId, age_group_id: c.ageGroupId, price_option_id: c.priceOptionId, days: c.days,
      list_amount: q.quote.items.find((i) => i.key === c.athleteId)!.listAmount,
      discounts: payloadDiscounts(q.quote, c.athleteId, v.promoCode),
    })),
    consents: v.consents,
    ip,
  };
  const { data, error } = await campsAdminDb().rpc("register_camp", { p_payload: payload as unknown as Json });
  if (error) {
    logError("camp.registerParent", error);
    return { ok: false, error: t.dynamic(campErrorKey(error.message), undefined, t("camps.errors.generic")) };
  }
  const r = (data ?? {}) as { invoice_id?: string; invoice_number?: string; total?: number; registration_ids?: string[]; athlete_ids?: string[] };
  const regIds = r.registration_ids ?? [];
  const athIds = r.athlete_ids ?? [];
  await storeRegistrationExtras(ctx.orgId, camp.program.id, config, athIds
    .map((athleteId, i): ChildAnswers => ({ athleteId, registrationId: regIds[i], extras: {}, answers: perChild.find((p) => p.athleteId === athleteId)?.answers ?? {} }))
    .filter((x) => x.athleteId && x.registrationId));
  await issueContractsForRegistrations(ctx.orgId, regIds, ctx.profileId);
  await notify(ctx.orgId, camp.program.name, me.fullName ?? me.email ?? "", null, Array.from(ctx.athletes.values()).map((a) => a.name), r.invoice_number ?? "", Number(r.total ?? 0));
  revalidatePath("/parent/invoices");
  redirect(r.invoice_id ? `/parent/invoices/${r.invoice_id}` : "/parent/invoices");
}
