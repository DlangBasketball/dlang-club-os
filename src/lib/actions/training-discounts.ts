"use server";

import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTenant, tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { loadPricingDiscounts } from "@/lib/camps/data";
import { computePrice } from "@/lib/pricing/discounts";
import { applyDiscount, sharedDiscountResolver } from "@/lib/training/pricing";
import { hostNamesOtherClub } from "@/lib/training/format";
import { trainingAdminDb } from "@/lib/training/db";

/**
 * Price preview of a training package / single session with the club's
 * shared discounts (early bird, promo code). Display only: the database
 * re-evaluates and locks promo usage when the purchase is made.
 */
export type TrainingPricePreview = {
  ok: boolean;
  error?: string;
  currency: string;
  listPrice: number;
  discountTotal: number;
  amount: number;
  promo: "none" | "applied" | "rejected";
  promoMessage?: string;
};

const input = z.object({
  serviceId: z.string().uuid(),
  packageId: z.string().uuid().nullable().optional(),
  promoCode: z.string().trim().max(40).optional().default(""),
  start: z.string().max(40).nullable().optional(),
  athleteId: z.string().uuid().nullable().optional(),
  clubSlug: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).optional(),
});

export async function previewTrainingPrice(raw: z.input<typeof input>): Promise<TrainingPricePreview> {
  const empty: TrainingPricePreview = { ok: false, currency: "CHF", listPrice: 0, discountTotal: 0, amount: 0, promo: "none" };
  const p = input.safeParse(raw);
  const t0 = await getTranslations();
  if (!p.success) return { ...empty, error: t0("training.errors.invalidRequest") };
  const v = p.data;
  const admin = trainingAdminDb();

  // Club: the signed-in user's own (on its host), else the public page's slug on its host.
  const me = await getSessionUser();
  let orgId: string | null = null;
  if (me?.orgId && (await tenantMatchesOrg(me.orgId))) orgId = me.orgId;
  else if (!me && v.clubSlug) {
    const tenant = await getTenant();
    if (!hostNamesOtherClub(tenant, v.clubSlug)) {
      const { data: org } = await admin.from("organizations").select("id").eq("slug", v.clubSlug).maybeSingle();
      orgId = org?.id ?? null;
    }
  }
  if (!orgId) return { ...empty, error: t0("training.errors.notFound") };
  const t = await getTranslations(orgId);

  const { data: svc } = await admin.from("training_services").select("id,price_chf,currency").eq("id", v.serviceId).eq("org_id", orgId).eq("is_active", true).maybeSingle();
  if (!svc) return { ...empty, error: t("training.errors.notFound") };
  let list = Number(svc.price_chf ?? 0);
  if (v.packageId) {
    const { data: pkg } = await admin.from("credit_packages").select("price_chf").eq("id", v.packageId).eq("org_id", orgId).eq("service_id", v.serviceId).eq("is_active", true).maybeSingle();
    if (!pkg) return { ...empty, error: t("training.errors.notFound") };
    list = Number(pkg.price_chf ?? 0);
  }
  const { data: org } = await admin.from("organizations").select("currency").eq("id", orgId).maybeSingle();
  const currency = (svc.currency ?? (org as { currency?: string | null } | null)?.currency ?? "CHF").toUpperCase();

  // Per-family promo limits count for the athlete's family (guardian / admin view).
  let familyId: string | null = null;
  if (me && v.athleteId) {
    const { data: a } = await admin.from("athletes").select("family_id").eq("id", v.athleteId).eq("org_id", orgId).maybeSingle();
    familyId = (a as { family_id?: string } | null)?.family_id ?? null;
  }
  const discounts = await loadPricingDiscounts(orgId, familyId);
  const startsOn = v.start && !Number.isNaN(Date.parse(v.start)) ? new Date(v.start).toISOString().slice(0, 10) : null;
  const now = new Date();
  const preview = applyDiscount(list, currency, { serviceId: v.serviceId, packageId: v.packageId ?? null },
    sharedDiscountResolver(discounts, { now, promoCode: v.promoCode, startsOn }));
  let promo: TrainingPricePreview["promo"] = "none";
  let promoMessage: string | undefined;
  if (v.promoCode) {
    const q = computePrice({ kind: "training", serviceId: v.serviceId, currency, listAmount: list, startsOn }, discounts.filter((d) => d.rule !== "sibling"), { now, promoCode: v.promoCode });
    promo = q.promoRejection ? "rejected" : "applied";
    if (q.promoRejection) promoMessage = t.dynamic(`shop.promo.${q.promoRejection}`, undefined, t("shop.promo.UNKNOWN_CODE"));
  }
  return { ok: true, currency, listPrice: list, discountTotal: preview.discountTotal, amount: preview.amount, promo, promoMessage };
}
