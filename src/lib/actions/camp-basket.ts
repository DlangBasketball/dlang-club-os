"use server";

import { assertFeature, hasFeature } from "@/lib/upgrades/server";
import { applyMemberPrices } from "@/lib/club-admin/member-price";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { campsAdminDb } from "@/lib/camps/db";
import { publicBasketOrg, quoteBasketServer, type BasketQuoteResult } from "@/lib/camps/basket-server";
import { MAX_BASKET_CHILDREN, MAX_BASKET_LINES, type Basket } from "@/lib/camps/basket";
import { campErrorKey } from "@/lib/camps/validation";
import { getRegistrationConfig } from "@/lib/registration-form/server";
import { issueContractsForRegistrations } from "@/lib/contracts/server";
import { attachPlanAtCheckout } from "@/lib/plans/checkout";
import { createGuestAccount, notifyCampRegistration } from "@/lib/camps/checkout-helpers";
import { logError } from "@/lib/log";
import type { Json } from "@/types/database";

/**
 * Camp basket: several weeks (across camps / seasons) for one or more
 * children, one checkout -> one invoice (a line per child-week + discount
 * lines) and one registration per child-week, all or nothing
 * (register_camp_basket). Members (parent app), guests (public pages) and
 * admins / finance on behalf of a family.
 *
 * The org: the session (parent / admin) or the host / the public camp slug
 * the visitor came from (public). Prices are rebuilt here from the database
 * and re-checked by the RPC.
 */

type T = Awaited<ReturnType<typeof getTranslations>>;

export type BasketMode = "public" | "parent" | "admin";
export type BasketContext = { mode: BasketMode; slug?: string | null; familyId?: string | null };

export type BasketQuoteLine = { key: string; listAmount: number; discounts: { name: string; amount: number }[]; total: number };
export type BasketQuoteView = {
  ok: boolean;
  error?: string;
  currency: string;
  lines: BasketQuoteLine[];
  lineErrors: Record<string, string>;
  listTotal: number;
  discountTotal: number;
  total: number;
  firstStart: string | null;
  promo: "applied" | "rejected" | "none";
  promoMessage?: string;
};
/** On success the client empties the basket, then opens redirectTo (invoice / confirmation page). */
export type BasketSubmitResult = { ok: true; invoiceId: string; invoiceNumber: string; redirectTo?: string } | { ok: false; error: string; lineErrors?: Record<string, string> };

const E = (k: string) => `camps.errors.${k}`;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, E("invalidDate"));
const childRef = z.string().regex(/^c\d{1,3}$/, E("invalidRequest"));

const childSchema = z.object({
  ref: childRef,
  athleteId: z.string().uuid(E("invalidRequest")).nullable().optional(),
  firstName: z.string().trim().max(80, E("tooLong")).default(""),
  lastName: z.string().trim().max(80, E("tooLong")).default(""),
  dob: z.string().trim().max(10).default(""),
  gender: z.string().max(20).optional().default(""),
  allergies: z.string().max(1000, E("tooLong")).optional().default(""),
  conditions: z.string().max(1000, E("tooLong")).optional().default(""),
  medicalNotes: z.string().max(2000, E("tooLong")).optional().default(""),
});
const lineSchema = z.object({
  key: z.string().regex(/^l\d{3,4}$/, E("invalidRequest")),
  childRef,
  programId: z.string().uuid(E("invalidRequest")),
  editionId: z.string().uuid(E("invalidRequest")),
  ageGroupId: z.string().max(40).default(""),
  daysCount: z.number().int().min(1).max(63).nullable(),
  lunch: z.enum(["", "yes", "no"]),
  days: z.array(isoDate).max(63),
});
const basketSchema = z.object({
  children: z.array(childSchema).min(1, E("noChildren")).max(MAX_BASKET_CHILDREN, E("tooMany")),
  lines: z.array(lineSchema).min(1, "camps.basket.errors.empty").max(MAX_BASKET_LINES, "camps.basket.errors.tooManyLines"),
  promoCode: z.string().trim().max(40).default(""),
});
export type BasketInput = z.input<typeof basketSchema>;

const contextSchema = z.object({
  mode: z.enum(["public", "parent", "admin"]),
  slug: z.string().max(120).nullable().optional(),
  familyId: z.string().uuid().nullable().optional(),
});

const publicChildStrict = childSchema.extend({
  firstName: z.string().trim().min(1, "registration.errors.required").max(80, E("tooLong")),
  lastName: z.string().trim().min(1, "registration.errors.required").max(80, E("tooLong")),
  dob: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "registration.errors.required").refine((v) => Date.parse(v) < Date.now(), "registration.errors.required"),
});
const parentSchema = z.object({
  name: z.string().trim().min(1, "registration.errors.required").max(120, E("tooLong")),
  email: z.string().trim().email("registration.errors.email").max(200),
  phone: z.string().trim().min(3, "registration.errors.required").max(40),
  address: z.string().trim().max(300).optional().default(""),
  emergencyName: z.string().trim().min(1, "registration.errors.required").max(120),
  emergencyPhone: z.string().trim().min(3, "registration.errors.required").max(40),
});
export type BasketParentInput = z.input<typeof parentSchema>;
const accountSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("link") }),
  z.object({ mode: z.literal("password"), password: z.string().min(10, E("password")).max(72, E("password")) }),
]);
export type BasketAccountInput = z.input<typeof accountSchema>;
const consentsSchema = z.array(z.string().max(80)).max(50).default([]);

/** Instalment count from the client: 0 (pay in full) or 2–24; the database decides what is allowed. */
function safeCount(n: unknown): number {
  const v = Number(n);
  return Number.isInteger(v) && v >= 2 && v <= 24 ? v : 0;
}

const lineMessage = (t: T, code: string) => t.dynamic(`camps.errors.db.${code}`, undefined, t("camps.errors.generic"));

// ---------------------------------------------------------------------------
// Context: org + family + verified children
// ---------------------------------------------------------------------------
type Resolved = {
  orgId: string; mode: BasketMode; familyId: string | null; profileId: string | null; actorName: string | null;
  /** child ref -> athlete id (existing children only) */
  refs: Map<string, string>;
  slug: string | null;
};

/** Families the signed-in guardian belongs to, inside their org. */
async function guardianFamilies(profileId: string, orgId: string): Promise<string[]> {
  const db = campsAdminDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", profileId);
  const ids = (links ?? []).map((l) => l.family_id);
  if (!ids.length) return [];
  const { data: fams } = await db.from("families").select("id").eq("org_id", orgId).in("id", ids);
  return (fams ?? []).map((f) => f.id);
}

async function resolveContext(ctxInput: BasketContext, children: Basket["children"]): Promise<Resolved | null> {
  const c = contextSchema.safeParse(ctxInput);
  if (!c.success) return null;
  const ctx = c.data;
  if (ctx.mode === "public") {
    const orgId = await publicBasketOrg(ctx.slug ?? null);
    if (!orgId) return null;
    if (children.some((k) => k.athleteId)) return null;
    return { orgId, mode: "public", familyId: null, profileId: null, actorName: null, refs: new Map(), slug: ctx.slug ?? null };
  }
  const me = await getSessionUser();
  if (!me?.orgId || !(await tenantMatchesOrg(me.orgId))) return null;
  const db = campsAdminDb();
  const ids = children.map((k) => k.athleteId).filter((x): x is string => !!x);
  if (ids.length !== children.length) return null;
  let familyId: string | null = null;
  if (ctx.mode === "parent") {
    if (!me.roles.includes("parent")) return null;
    const families = await guardianFamilies(me.id, me.orgId);
    if (!families.length) return null;
    const { data: athletes } = await db.from("athletes").select("id,family_id").eq("org_id", me.orgId).in("family_id", families).in("id", ids);
    if ((athletes ?? []).length !== new Set(ids).size) return null;
    const fams = new Set((athletes ?? []).map((a) => a.family_id));
    if (fams.size !== 1) return null; // one family per checkout (one invoice)
    familyId = Array.from(fams)[0];
  } else {
    if (!me.roles.includes("admin") && !me.roles.includes("finance")) return null;
    if (!ctx.familyId) return null;
    const { data: fam } = await db.from("families").select("id").eq("id", ctx.familyId).eq("org_id", me.orgId).maybeSingle();
    if (!fam) return null;
    const { data: athletes } = await db.from("athletes").select("id").eq("org_id", me.orgId).eq("family_id", fam.id).in("id", ids);
    if ((athletes ?? []).length !== new Set(ids).size) return null;
    familyId = fam.id;
  }
  return {
    orgId: me.orgId, mode: ctx.mode, familyId, profileId: me.id, actorName: me.fullName ?? me.email ?? null,
    refs: new Map(children.map((k) => [k.ref, k.athleteId as string])), slug: null,
  };
}

function toView(res: BasketQuoteResult, promoCode: string, t: T): BasketQuoteView {
  const lineErrors: Record<string, string> = {};
  for (const e of res.check.errors) lineErrors[e.key] = lineMessage(t, e.code);
  const q = res.quote;
  const entered = promoCode.trim() !== "";
  const rejected = !!q && entered && q.promoRejection !== null;
  const firstStart = res.check.lines.map((l) => l.startsOn).sort()[0] ?? null;
  return {
    ok: true,
    currency: q?.currency ?? res.check.lines[0]?.currency ?? "",
    lines: (q?.items ?? []).map((i) => ({ key: i.key, listAmount: i.listAmount, total: i.total, discounts: i.discounts.map((d) => ({ name: d.name, amount: d.amount })) })),
    lineErrors,
    listTotal: q?.listTotal ?? 0,
    discountTotal: q?.discountTotal ?? 0,
    total: q?.total ?? 0,
    firstStart,
    promo: !entered || !q ? "none" : rejected ? "rejected" : "applied",
    promoMessage: rejected ? t.dynamic(`camps.promo.${q!.promoRejection}`, undefined, t("camps.promo.UNKNOWN_CODE")) : undefined,
  };
}

const emptyView = (error: string): BasketQuoteView => ({
  ok: false, error, currency: "", lines: [], lineErrors: {}, listTotal: 0, discountTotal: 0, total: 0, firstStart: null, promo: "none",
});

/** Live price of the basket (no writes). */
export async function quoteCampBasket(ctx: BasketContext, input: BasketInput): Promise<BasketQuoteView> {
  const t0 = await getTranslations();
  const p = basketSchema.safeParse(input);
  if (!p.success) return emptyView(t0.dynamic(p.error.issues[0]?.message ?? E("generic"), undefined, t0("camps.errors.generic")));
  const r = await resolveContext(ctx, p.data.children);
  if (!r) return emptyView(t0("camps.errors.notPermitted"));
  const t = await getTranslations(r.orgId);
  const res = await quoteBasketServer({
    orgId: r.orgId, basket: p.data, promoCode: p.data.promoCode, requirePublic: r.mode === "public",
    familyId: r.familyId, refs: r.refs, strict: false, ignoreWindow: r.mode === "admin",
  });
  return toView(res, p.data.promoCode, t);
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
function parseBasketErrors(details: string | null | undefined, t: T): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const arr = JSON.parse(details ?? "[]") as { key?: string | null; code?: string }[];
    for (const e of Array.isArray(arr) ? arr : []) if (e?.key && e.code) out[e.key] = lineMessage(t, e.code);
  } catch {
    /* not JSON: no per-line detail */
  }
  return out;
}

type CheckoutExtras = {
  consents: string[];
  instalments: number;
  parent?: z.output<typeof parentSchema>;
  account?: z.output<typeof accountSchema>;
};

async function checkout(ctxInput: BasketContext, input: BasketInput, extras: CheckoutExtras): Promise<BasketSubmitResult & { orgId?: string; slug?: string | null; regIds?: string[] }> {
  const t0 = await getTranslations();
  const p = basketSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t0.dynamic(p.error.issues[0]?.message ?? E("generic"), undefined, t0("camps.errors.generic")) };
  const v = p.data;
  const r = await resolveContext(ctxInput, v.children);
  if (!r) return { ok: false, error: t0("camps.errors.notPermitted") };
  if (!(await hasFeature(r.orgId, "camp_basket"))) return { ok: false, error: t0("camps.errors.notPermitted") };
  const t = await getTranslations(r.orgId);

  // Children of a public basket: names + date of birth (the rest optional).
  if (r.mode === "public") {
    for (const c of v.children) {
      if (!v.lines.some((l) => l.childRef === c.ref)) continue;
      const k = publicChildStrict.safeParse(c);
      if (!k.success) return { ok: false, error: t("camps.basket.errors.childDetails") };
    }
  }

  const res = await quoteBasketServer({
    orgId: r.orgId, basket: v, promoCode: v.promoCode, requirePublic: r.mode === "public",
    familyId: r.familyId, refs: r.refs, strict: true, ignoreWindow: r.mode === "admin",
  });
  if (res.check.errors.length || !res.quote) {
    const lineErrors: Record<string, string> = {};
    for (const e of res.check.errors) lineErrors[e.key] = lineMessage(t, e.code);
    return { ok: false, error: t("camps.basket.errors.fixLines"), lineErrors };
  }
  const q = res.quote;
  if (v.promoCode.trim() !== "" && q.promoRejection !== null && q.promoRejection !== "NOT_COMBINABLE") {
    return { ok: false, error: t.dynamic(`camps.promo.${q.promoRejection}`, undefined, t("camps.promo.UNKNOWN_CODE")) };
  }

  // Consents (one club: the same forms on every camp) and extra-question forms.
  const anyCamp = res.camps.values().next().value;
  const missing = (anyCamp?.consents ?? []).filter((c) => c.required && !extras.consents.includes(c.key));
  if (missing.length) return { ok: false, error: t("registration.consents.missing") };
  for (const camp of res.camps.values()) {
    const cfg = await getRegistrationConfig(r.orgId, camp.program.id);
    if (cfg.questions.some((qq) => (qq as { required?: boolean }).required)) {
      return { ok: false, error: t("camps.basket.errors.needsForm", { camp: camp.program.name }) };
    }
  }

  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
  const byKey = new Map(q.items.map((i) => [i.key, i]));
  const usedRefs = new Set(res.check.lines.map((l) => l.childRef));
  const payload = {
    org_id: r.orgId,
    mode: r.mode,
    family_id: r.familyId,
    registered_by: r.profileId,
    parent: extras.parent ? {
      name: extras.parent.name, email: extras.parent.email, phone: extras.parent.phone, address: extras.parent.address,
      emergency_name: extras.parent.emergencyName, emergency_phone: extras.parent.emergencyPhone,
    } : undefined,
    children: v.children.filter((c) => usedRefs.has(c.ref)).map((c) => (r.mode === "public"
      ? { ref: c.ref, first_name: c.firstName, last_name: c.lastName, dob: c.dob, gender: c.gender, allergies: c.allergies, conditions: c.conditions, medical_notes: c.medicalNotes }
      : { ref: c.ref, athlete_id: c.athleteId })),
    lines: res.check.lines.map((l) => ({
      key: l.key, child_ref: l.childRef, program_id: l.programId, edition_id: l.editionId, age_group_id: l.ageGroupId,
      price_option_id: l.optionId, days: l.days, list_amount: byKey.get(l.key)!.listAmount,
      discounts: byKey.get(l.key)!.discounts.map((d) => ({ discount_id: d.discountId, amount: d.amount, code: d.rule === "promo_code" ? v.promoCode.trim().toUpperCase() : null })),
    })),
    consents: extras.consents,
    ip,
  };
  const { data, error } = await campsAdminDb().rpc("register_camp_basket", { p_payload: payload as unknown as Json });
  if (error) {
    if (/BASKET_INVALID/.test(error.message)) {
      return { ok: false, error: t("camps.basket.errors.fixLines"), lineErrors: parseBasketErrors(error.details, t) };
    }
    logError("camp.basketCheckout", error, { orgId: r.orgId });
    return { ok: false, error: t.dynamic(campErrorKey(error.message), undefined, t("camps.errors.generic")) };
  }
  const out = (data ?? {}) as { invoice_id?: string; invoice_number?: string; total?: number; lines?: { registration_id: string }[] };
  const regIds = (out.lines ?? []).map((l) => l.registration_id);
  // Member families pay the optional member price (never fatal).
  if (await applyMemberPrices(r.orgId, "camp_registration", regIds) && out.invoice_id) {
    const { data: inv } = await campsAdminDb().from("invoices").select("total_chf").eq("id", out.invoice_id).eq("org_id", r.orgId).maybeSingle();
    if (inv) out.total = Number((inv as { total_chf: number | string }).total_chf);
  }
  await issueContractsForRegistrations(r.orgId, regIds, r.profileId ?? undefined);
  const plan = await attachPlanAtCheckout(r.orgId, out.invoice_id, safeCount(extras.instalments), "camp");
  if (!plan.ok) logError("camp.basketPlan", new Error(plan.code), { orgId: r.orgId });
  const names = Array.from(new Set(res.check.lines.map((l) => res.camps.get(l.programId)?.program.name ?? ""))).filter(Boolean).join(" · ");
  const kidNames = v.children.filter((c) => usedRefs.has(c.ref)).map((c) => `${c.firstName} ${c.lastName}`.trim()).filter(Boolean);
  if (r.mode === "public" && extras.parent) {
    if (extras.account) await createGuestAccount(r.orgId, extras.parent.email, extras.parent.name, extras.account, t.locale);
    await notifyCampRegistration(r.orgId, names, extras.parent.name, extras.parent.email, kidNames, out.invoice_number ?? "", Number(out.total ?? 0));
  } else {
    await notifyCampRegistration(r.orgId, names, r.actorName ?? "", null, kidNames, out.invoice_number ?? "", Number(out.total ?? 0));
  }
  revalidatePath("/parent/invoices");
  revalidatePath("/parent/camps", "layout");
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/registrations");
  for (const id of res.camps.keys()) revalidatePath(`/admin/programs/${id}`);
  const firstSlug = res.check.lines.map((l) => res.camps.get(l.programId)?.program.slug).find(Boolean) ?? null;
  return { ok: true, invoiceId: out.invoice_id ?? "", invoiceNumber: out.invoice_number ?? "", orgId: r.orgId, slug: firstSlug, regIds };
}

/** Parent app: the signed-in guardian's own children. On success: the invoice. */
export async function checkoutCampBasketParent(input: BasketInput, consents: string[], instalments = 0): Promise<BasketSubmitResult> {
  await assertFeature("camp_basket");
  const t0 = await getTranslations();
  const c = consentsSchema.safeParse(consents);
  if (!c.success) return { ok: false, error: t0("camps.errors.invalidRequest") };
  const res = await checkout({ mode: "parent" }, input, { consents: c.data, instalments });
  if (!res.ok) return res;
  return { ok: true, invoiceId: res.invoiceId, invoiceNumber: res.invoiceNumber, redirectTo: res.invoiceId ? `/parent/invoices/${res.invoiceId}` : "/parent/invoices" };
}

/** Public pages (guests and members alike): the family + children are created once for the whole basket. */
export async function checkoutCampBasketPublic(slug: string | null, input: BasketInput, parent: BasketParentInput,
  consents: string[], account: BasketAccountInput = { mode: "none" }, instalments = 0): Promise<BasketSubmitResult> {
  const t0 = await getTranslations();
  const pp = parentSchema.safeParse(parent);
  if (!pp.success) return { ok: false, error: t0.dynamic(pp.error.issues[0]?.message ?? E("generic"), undefined, t0("camps.errors.generic")) };
  const acc = accountSchema.safeParse(account);
  if (!acc.success) return { ok: false, error: t0("camps.errors.password") };
  const c = consentsSchema.safeParse(consents);
  if (!c.success) return { ok: false, error: t0("camps.errors.invalidRequest") };
  const res = await checkout({ mode: "public", slug }, input, { consents: c.data, instalments, parent: pp.data, account: acc.data });
  if (!res.ok) return res;
  const qs = new URLSearchParams({ ref: res.invoiceNumber, account: acc.data.mode });
  if (safeCount(instalments)) qs.set("plan", String(safeCount(instalments)));
  // The confirmation page shows the invoice number only (no invoice id / personal data in the URL).
  return { ok: true, invoiceId: "", invoiceNumber: res.invoiceNumber, redirectTo: `/register/${encodeURIComponent(res.slug ?? slug ?? "")}/success?${qs.toString()}` };
}

/** Admin / finance: a multi-week booking on behalf of a family of the club. */
export async function checkoutCampBasketAdmin(familyId: string, input: BasketInput, consents: string[], instalments = 0): Promise<BasketSubmitResult> {
  await assertFeature("camp_basket");
  const t0 = await getTranslations();
  const c = consentsSchema.safeParse(consents);
  if (!c.success || !z.string().uuid().safeParse(familyId).success) return { ok: false, error: t0("camps.errors.invalidRequest") };
  const res = await checkout({ mode: "admin", familyId }, input, { consents: c.data, instalments });
  if (!res.ok) return res;
  revalidatePath(`/admin/families/${familyId}`);
  return { ok: true, invoiceId: res.invoiceId, invoiceNumber: res.invoiceNumber };
}
