"use server";

import { applyMemberPrices } from "@/lib/club-admin/member-price";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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
import { createGuestAccount as createGuestAccountShared, notifyCampRegistration } from "@/lib/camps/checkout-helpers";
import type { Json } from "@/types/database";
import { logError } from "@/lib/log";
import { getRegistrationConfig, storeRegistrationExtras, type ChildAnswers } from "@/lib/registration-form/server";
import { resolveConfig, validateRegistrationExtras, type BuiltinField, type ChildExtras } from "@/lib/registration-form/config";
import { issueContractsForRegistrations } from "@/lib/contracts/server";
import { attachPlanAtCheckout } from "@/lib/plans/checkout";
import { HIDDEN_ATHLETE_STATUS_FILTER } from "@/lib/people/person-delete";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import { classifyCamper, type CampAgeBand } from "@/lib/camps/age-approval";
import { submitApprovalRequests } from "@/lib/camps/approval-server";
import { holdThirdPartyCamp, thirdPartyIds } from "@/lib/public-entry/server";
import { ageOn } from "@/lib/camps/logic";
import { consentErrorCode } from "@/lib/public-entry/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EntryClient } from "@/lib/public-entry/db";

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
  const { data: athletes } = await db.from("athletes").select("id,family_id,dob,first_name,last_name").eq("org_id", me.orgId).in("family_id", families).not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER);
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
  const startsOn = camp.editions.find((e) => e.id === v.editionId)?.startsOn ?? null;
  const children: QuoteChild[] = v.children
    .filter((c) => c.priceOptionId)
    // Children in the approval band are priced once approved (not in the quote).
    .filter((c) => bandOf(camp!, startsOn, c.athleteId ? dobs.get(c.athleteId) ?? null : c.dob ?? null) !== "approval")
    .map((c) => ({ key: c.key, priceOptionId: c.priceOptionId, ageGroupId: c.ageGroupId, days: c.days, dob: c.athleteId ? dobs.get(c.athleteId) ?? null : c.dob }));
  if (!children.length) return { ...emptyView(camp.program.currency, ""), ok: true };
  const q = buildCampQuote({ camp, editionId: v.editionId, children, discounts, promoCode: v.promoCode, existingSiblings: existing, partial: true });
  if (!q.ok) return emptyView(camp.program.currency, tt.dynamic(`camps.errors.db.${q.error}`, undefined, tt("camps.errors.generic")));
  return view(q.quote, v.promoCode, tt);
}

/** Age band of a child for the chosen week (standard when the camp has no band). */
function bandOf(camp: PublicCamp, startsOn: string | null, dob: string | null): CampAgeBand {
  const ages = camp.program.ages;
  if (!ages || ages.approvalAgeMin === null) return "standard";
  return classifyCamper(dob, startsOn, ages).band;
}

function payloadDiscounts(q: BatchQuote, key: string, promoCode: string) {
  const item = q.items.find((i) => i.key === key);
  return (item?.discounts ?? []).map((d) => ({ discount_id: d.discountId, amount: d.amount, code: d.rule === "promo_code" ? promoCode.trim().toUpperCase() : null }));
}

function promoBlocks(q: BatchQuote, promoCode: string): boolean {
  return promoCode.trim() !== "" && q.promoRejection !== null && q.promoRejection !== "NOT_COMBINABLE";
}

const createGuestAccount = createGuestAccountShared;
const notify = notifyCampRegistration;

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
export async function submitCampPublic(input: CampPublicRegistrationInput, accountInput: GuestAccountInput = { mode: "none" }, instalments = 0, requestId?: string): Promise<CampSubmitResult> {
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

  // Age approval band (6–7 at DLang): children in the band are sent to the club
  // for review (no invoice), which needs an account to receive the decision.
  const startsOn = camp.editions.find((e) => e.id === v.editionId)?.startsOn ?? null;
  const bands = v.children.map((c) => bandOf(camp, startsOn, c.dob || null));
  if (bands.some((b) => b === "too_young" || b === "too_old")) return { ok: false, error: t("camps.errors.db.AGE_OUT_OF_RANGE") };
  const approvalIdx = bands.flatMap((b, i) => (b === "approval" ? [i] : []));
  const standardIdx = bands.flatMap((b, i) => (b === "approval" ? [] : [i]));
  const viewer = await getSessionUser();
  if (approvalIdx.length && !viewer) return { ok: false, error: t("camps.approval.public.needsAccount") };

  const discounts = await loadPricingDiscounts(orgId, null);
  const q = buildCampQuote({
    camp, editionId: v.editionId, discounts, promoCode: v.promoCode,
    children: standardIdx.map((i) => { const c = v.children[i]; return { key: String(i), priceOptionId: c.priceOptionId, ageGroupId: c.ageGroupId, days: c.days, dob: c.dob }; }),
  });
  if (standardIdx.length && !q.ok) return { ok: false, error: t.dynamic(`camps.errors.db.${q.error}`, undefined, t("camps.errors.generic")) };
  const quoteItem = (i: number) => (q.ok ? q.quote.items.find((it) => it.key === String(i)) : undefined);
  if (q.ok && promoBlocks(q.quote, v.promoCode)) return { ok: false, error: t.dynamic(`camps.promo.${q.quote.promoRejection}`, undefined, t("camps.promo.UNKNOWN_CODE")) };

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  // Signed-in visitor (Workstream B): their own family (or a bootstrapped
  // guest family) and children are reused — no duplicate family or child.
  // The profile id comes from the session, never from the client.
  let account: { familyId: string; athleteIds: string[] } | null = null;
  if (viewer) {
    // Same COPPA gate as the public path of register_camp (VPC clubs: no under-13 online).
    if (v.children.some((c) => (ageOn(c.dob, new Date().toISOString().slice(0, 10)) ?? 99) < 13)) {
      const { data: vpc } = await (createAdminClient() as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown }> })
        .rpc("org_requires_vpc", { p_org: orgId });
      if (vpc === true) return { ok: false, error: t.dynamic(campErrorKey("VPC_REQUIRED"), undefined, t("camps.errors.generic")) };
    }
    const { data: res, error: rerr } = await (createAdminClient() as unknown as EntryClient).rpc("public_entry_resolve_children", {
      p_payload: {
        profile_id: viewer.id, program_id: camp.program.id,
        parent: { name: v.parent.name, phone: v.parent.phone, address: keep("address", v.parent.address),
                  emergency_name: v.parent.emergencyName, emergency_phone: v.parent.emergencyPhone },
        children: v.children.map((c) => ({
          first_name: c.firstName, last_name: c.lastName, dob: c.dob, gender: keep("gender", c.gender),
          allergies: keep("allergies", c.allergies), conditions: keep("conditions", c.conditions), medical_notes: keep("medicalNotes", c.medicalNotes),
        })),
      } as unknown as Json,
    });
    if (rerr) {
      logError("camp.registerPublic.resolve", rerr);
      return { ok: false, error: t.dynamic(campErrorKey(rerr.message), undefined, t("camps.errors.generic")) };
    }
    const rr = (res ?? {}) as { family_id?: string; athlete_ids?: string[] };
    if (rr.family_id && rr.athlete_ids?.length === v.children.length) account = { familyId: rr.family_id, athleteIds: rr.athlete_ids };
  }
  if (approvalIdx.length && !account) return { ok: false, error: t("camps.approval.public.needsAccount") };
  if (account && approvalIdx.length) {
    const sent = await submitApprovalRequests({
      orgId, camp, editionId: v.editionId, familyId: account.familyId, profileId: viewer!.id, requestId, ip, consents: v.consents, config,
      children: approvalIdx.map((i) => ({
        athleteId: account!.athleteIds[i], name: `${v.children[i].firstName} ${v.children[i].lastName}`.trim(),
        ageGroupId: v.children[i].ageGroupId, priceOptionId: v.children[i].priceOptionId, days: v.children[i].days, answers: perChild[i]?.answers ?? {},
      })),
    });
    if (!sent.ok) return { ok: false, error: t.dynamic(campErrorKey(sent.error), undefined, t("camps.errors.generic")) };
    if (!standardIdx.length) {
      revalidatePath("/parent/bookings");
      revalidatePersonEverywhere(orgId);
      redirect("/parent/bookings?camp=requested");
    }
  }
  if (account && q.ok) {
    const { data, error } = await campsAdminDb().rpc("register_camp", { p_payload: {
      mode: "parent", program_id: camp.program.id, edition_id: v.editionId, family_id: account.familyId, registered_by: viewer!.id,
      children: standardIdx.map((i) => ({
        athlete_id: account!.athleteIds[i], age_group_id: v.children[i].ageGroupId, price_option_id: v.children[i].priceOptionId, days: v.children[i].days,
        list_amount: quoteItem(i)!.listAmount, discounts: payloadDiscounts(q.quote, String(i), v.promoCode),
      })),
      consents: v.consents, ip,
    } as unknown as Json });
    if (error) {
      logError("camp.registerPublicSignedIn", error);
      return { ok: false, error: t.dynamic(campErrorKey(error.message), undefined, t("camps.errors.generic")) };
    }
    const r = (data ?? {}) as { invoice_id?: string; invoice_number?: string; total?: number; registration_ids?: string[]; athlete_ids?: string[] };
  // The number series (e.g. DL CAMP-…) is assigned after the RPC built its reply: read the final number.
  r.invoice_number = await finalInvoiceNumber(orgId, r.invoice_id, r.invoice_number);
    const regIds = r.registration_ids ?? [];
    const athIds = r.athlete_ids ?? [];
    if (await applyMemberPrices(orgId, "camp_registration", regIds)) r.total = await invoiceTotal(orgId, r.invoice_id, r.total);
    const plan = await attachPlanAtCheckout(orgId, r.invoice_id, safeCount(instalments), "camp");
    await storeRegistrationExtras(orgId, camp.program.id, config, perChild
      .map((pc, i): ChildAnswers => ({ athleteId: athIds[i], registrationId: regIds[i], extras: pc.extras, answers: pc.answers }))
      .filter((x) => x.athleteId && x.registrationId));
    await issueContractsForRegistrations(orgId, regIds, viewer!.id);
    await notify(orgId, camp.program.name, v.parent.name, v.parent.email, v.children.map((c) => `${c.firstName} ${c.lastName}`), r.invoice_number ?? "", Number(r.total ?? 0));
    const qs = new URLSearchParams({ ref: r.invoice_number ?? "", account: "existing" });
    if (approvalIdx.length) qs.set("requested", String(approvalIdx.length));
    if (plan.ok && plan.planId) qs.set("plan", String(safeCount(instalments)));
    revalidatePersonEverywhere(orgId);
    redirect(`/register/${v.programSlug}/success?${qs.toString()}`);
  }

  if (!q.ok) return { ok: false, error: t.dynamic(`camps.errors.db.${q.error}`, undefined, t("camps.errors.generic")) };
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
  const r = (data ?? {}) as { invoice_id?: string; invoice_number?: string; total?: number; registration_ids?: string[]; athlete_ids?: string[] };
  // The number series (e.g. DL CAMP-…) is assigned after the RPC built its reply: read the final number.
  r.invoice_number = await finalInvoiceNumber(orgId, r.invoice_id, r.invoice_number);
  const regIds = r.registration_ids ?? [];
  const athIds = r.athlete_ids ?? [];
  // Member families pay the optional member price (never fatal).
  if (await applyMemberPrices(orgId, "camp_registration", regIds)) r.total = await invoiceTotal(orgId, r.invoice_id, r.total);
  // Instalments chosen at checkout (club rules re-checked in SQL; never fatal).
  const plan = await attachPlanAtCheckout(orgId, r.invoice_id, safeCount(instalments), "camp");
  await storeRegistrationExtras(orgId, camp.program.id, config, perChild
    .map((pc, i): ChildAnswers => ({ athleteId: athIds[i], registrationId: regIds[i], extras: pc.extras, answers: pc.answers }))
    .filter((x) => x.athleteId && x.registrationId));
  await issueContractsForRegistrations(orgId, regIds);
  await createGuestAccount(orgId, v.parent.email, v.parent.name, acc.data, t.locale);
  await notify(orgId, camp.program.name, v.parent.name, v.parent.email, v.children.map((c) => `${c.firstName} ${c.lastName}`), r.invoice_number ?? "", Number(r.total ?? 0));
  const qs = new URLSearchParams({ ref: r.invoice_number ?? "", account: acc.data.mode });
  if (plan.ok && plan.planId) qs.set("plan", String(safeCount(instalments)));
  revalidatePersonEverywhere(orgId);
  redirect(`/register/${v.programSlug}/success?${qs.toString()}`);
}

/** Parent app submission: existing children of the signed-in guardian's family. */
/** Instalment count from the client: 0 (pay in full) or 2–24; the database decides what is allowed. */
function safeCount(n: unknown): number {
  const v = Number(n);
  return Number.isInteger(v) && v >= 2 && v <= 24 ? v : 0;
}

export async function submitCampParent(input: CampParentRegistrationInput, instalments = 0, requestId?: string): Promise<CampSubmitResult> {
  const t0 = await getTranslations();
  const p = campParentRegistrationSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t0.dynamic(firstIssueKey(p.error), undefined, t0("camps.errors.generic")), errors: flatten(p.error, t0) };
  const v = p.data;
  const me = await getSessionUser();
  if (!me?.orgId) return { ok: false, error: t0("camps.errors.notPermitted") };
  const camp = await getMemberCamp(me.orgId, v.programId);
  if (!camp) return { ok: false, error: t0("camps.errors.db.PROGRAM_NOT_OPEN") };

  // "Someone else" (Workstream B): a participant of another family is booked on
  // its own; the place is held awaiting that child's guardian's consent (no
  // invoice yet; the booker pays once the guardian consented).
  const others = await thirdPartyIds(me.id, me.orgId, v.children.map((c) => c.athleteId));
  if (others.size) {
    if (v.children.length !== 1 || !(await tenantMatchesOrg(me.orgId))) {
      return { ok: false, error: t0("consentRequest.errors.MIXED_PARTICIPANTS") };
    }
    const c = v.children[0];
    const held = await holdThirdPartyCamp({
      orgId: me.orgId, programId: camp.program.id, editionId: v.editionId, athleteId: c.athleteId,
      ageGroupId: c.ageGroupId, priceOptionId: c.priceOptionId, days: c.days, requestId, consents: v.consents,
    });
    if (!held.ok) {
      const own = consentErrorCode(held.message);
      if (own) return { ok: false, error: t0.dynamic(`consentRequest.errors.${own}`, undefined, t0("consentRequest.errors.generic")) };
      logError("camp.registerThirdParty", held.message);
      return { ok: false, error: t0.dynamic(campErrorKey(held.message), undefined, t0("camps.errors.generic")) };
    }
    revalidatePath("/parent/bookings/others");
    revalidatePersonEverywhere(me.orgId);
    redirect(held.consent === "carer" ? "/parent/bookings/others?held=camp_carer" : "/parent/bookings/others?held=camp");
  }

  const ctx = await parentContext(camp, v.children.map((c) => c.athleteId));
  if (!ctx) return { ok: false, error: t0("camps.errors.notPermitted") };
  const t = await getTranslations(ctx.orgId);

  const missing = camp.consents.filter((c) => c.required && !v.consents.includes(c.key));
  if (missing.length) return { ok: false, error: t("registration.consents.missing") };

  // Age approval band: children in the band are submitted for approval (no
  // invoice); below the band / above the maximum they cannot register.
  const startsOn = camp.editions.find((e) => e.id === v.editionId)?.startsOn ?? null;
  const bands = new Map(v.children.map((c) => [c.athleteId, bandOf(camp, startsOn, ctx.athletes.get(c.athleteId)?.dob ?? null)]));
  if (Array.from(bands.values()).some((b) => b === "too_young" || b === "too_old")) {
    return { ok: false, error: t("camps.errors.db.AGE_OUT_OF_RANGE") };
  }
  const approvalKids = v.children.filter((c) => bands.get(c.athleteId) === "approval");
  const standardKids = v.children.filter((c) => bands.get(c.athleteId) !== "approval");

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

  if (approvalKids.length) {
    const h = await headers();
    const sent = await submitApprovalRequests({
      orgId: ctx.orgId, camp, editionId: v.editionId, familyId: ctx.familyId, profileId: ctx.profileId, requestId,
      ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || null, consents: v.consents, config,
      children: approvalKids.map((c) => ({
        athleteId: c.athleteId, name: ctx.athletes.get(c.athleteId)?.name ?? "", ageGroupId: c.ageGroupId, priceOptionId: c.priceOptionId,
        days: c.days, answers: perChild.find((x) => x.athleteId === c.athleteId)?.answers ?? {},
      })),
    });
    if (!sent.ok) return { ok: false, error: t.dynamic(campErrorKey(sent.error), undefined, t("camps.errors.generic")) };
    if (!standardKids.length) {
      revalidatePath("/parent/bookings");
      revalidatePersonEverywhere(ctx.orgId);
      redirect("/parent/bookings?camp=requested");
    }
  }

  const discounts = await loadPricingDiscounts(ctx.orgId, ctx.familyId);
  const q = buildCampQuote({
    camp, editionId: v.editionId, discounts, promoCode: v.promoCode, existingSiblings: ctx.existingSiblings,
    children: standardKids.map((c) => ({ key: c.athleteId, priceOptionId: c.priceOptionId, ageGroupId: c.ageGroupId, days: c.days, dob: ctx.athletes.get(c.athleteId)?.dob ?? null })),
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
    children: standardKids.map((c) => ({
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
  // The number series (e.g. DL CAMP-…) is assigned after the RPC built its reply: read the final number.
  r.invoice_number = await finalInvoiceNumber(ctx.orgId, r.invoice_id, r.invoice_number);
  const regIds = r.registration_ids ?? [];
  const athIds = r.athlete_ids ?? [];
  if (await applyMemberPrices(ctx.orgId, "camp_registration", regIds)) r.total = await invoiceTotal(ctx.orgId, r.invoice_id, r.total);
  await storeRegistrationExtras(ctx.orgId, camp.program.id, config, athIds
    .map((athleteId, i): ChildAnswers => ({ athleteId, registrationId: regIds[i], extras: {}, answers: perChild.find((p) => p.athleteId === athleteId)?.answers ?? {} }))
    .filter((x) => x.athleteId && x.registrationId));
  await issueContractsForRegistrations(ctx.orgId, regIds, ctx.profileId);
  await attachPlanAtCheckout(ctx.orgId, r.invoice_id, safeCount(instalments), "camp");
  await notify(ctx.orgId, camp.program.name, me.fullName ?? me.email ?? "", null, standardKids.map((c) => ctx.athletes.get(c.athleteId)?.name ?? ""), r.invoice_number ?? "", Number(r.total ?? 0));
  revalidatePath("/parent/invoices");
  revalidatePersonEverywhere(ctx.orgId);
  redirect(r.invoice_id ? `/parent/invoices/${r.invoice_id}` : "/parent/invoices");
}

/** Invoice total after the member price hook (falls back to the RPC total). */
async function finalInvoiceNumber(orgId: string, invoiceId: string | undefined, fallback: string | undefined): Promise<string | undefined> {
  if (!invoiceId) return fallback;
  const { data } = await campsAdminDb().from("invoices").select("number").eq("id", invoiceId).eq("org_id", orgId).maybeSingle();
  return (data as { number?: string | null } | null)?.number ?? fallback;
}

async function invoiceTotal(orgId: string, invoiceId: string | undefined, fallback: number | undefined): Promise<number | undefined> {
  if (!invoiceId) return fallback;
  const { data } = await campsAdminDb().from("invoices").select("total_chf").eq("id", invoiceId).eq("org_id", orgId).maybeSingle();
  return data ? Number((data as { total_chf: number | string }).total_chf) : fallback;
}
