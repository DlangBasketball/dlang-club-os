"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { campsDb } from "@/lib/camps/db";
import { campErrorKey, discountRow, discountSchema, firstIssueKey, type DiscountInput } from "@/lib/camps/validation";

/**
 * Discounts admin (shared model: camps, training, any programme / service).
 * Create / edit / enable / disable: admins. Applying a manual discount to a
 * registration: admin or finance (apply_manual_discount RPC).
 */
export type DiscountActionResult = { ok: true; id?: string; disabled?: boolean } | { ok: false; error: string };

const uuid = z.string().uuid();

async function requireStaff(roles: ("admin" | "finance")[]) {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.some((r) => (roles as string[]).includes(r))) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return me as typeof me & { orgId: string };
}

async function fail(key: string, orgId?: string | null): Promise<DiscountActionResult> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("camps.errors.generic")) };
}

export async function saveDiscount(id: string | null, input: DiscountInput): Promise<DiscountActionResult> {
  const me = await requireStaff(["admin"]);
  if (!me) return fail("camps.errors.notPermitted");
  if (id && !uuid.safeParse(id).success) return fail("camps.errors.invalidRequest", me.orgId);
  const p = discountSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error), me.orgId);
  const db = await campsDb();
  if (p.data.scope === "program" && p.data.scopeProgramId) {
    const { data } = await db.from("programs").select("id").eq("id", p.data.scopeProgramId).eq("org_id", me.orgId).maybeSingle();
    if (!data) return fail("camps.errors.notFound", me.orgId);
  }
  if (p.data.scope === "service" && p.data.scopeServiceId) {
    const { data } = await db.from("training_services").select("id").eq("id", p.data.scopeServiceId).eq("org_id", me.orgId).maybeSingle();
    if (!data) return fail("camps.errors.notFound", me.orgId);
  }
  const row = discountRow(p.data);
  const res = id
    ? await db.from("discounts").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("discounts").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return fail(campErrorKey(res.error.message), me.orgId);
  if (!res.data?.length) return fail("camps.errors.notFound", me.orgId);
  revalidatePath("/admin/discounts");
  return { ok: true, id: res.data[0].id };
}

export async function setDiscountActive(id: string, active: boolean): Promise<DiscountActionResult> {
  const me = await requireStaff(["admin"]);
  if (!me) return fail("camps.errors.notPermitted");
  if (!uuid.safeParse(id).success) return fail("camps.errors.invalidRequest", me.orgId);
  const db = await campsDb();
  const { data, error } = await db.from("discounts").update({ is_active: !!active }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return fail(campErrorKey(error.message), me.orgId);
  if (!data?.length) return fail("camps.errors.notFound", me.orgId);
  revalidatePath("/admin/discounts");
  return { ok: true, id };
}

/** Deletes an unused discount; a discount that was ever applied is disabled instead (history stays). */
export async function deleteDiscount(id: string): Promise<DiscountActionResult> {
  const me = await requireStaff(["admin"]);
  if (!me) return fail("camps.errors.notPermitted");
  if (!uuid.safeParse(id).success) return fail("camps.errors.invalidRequest", me.orgId);
  const db = await campsDb();
  const { count } = await db.from("applied_discounts").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("discount_id", id);
  if ((count ?? 0) > 0) {
    const res = await setDiscountActive(id, false);
    return res.ok ? { ok: true, id, disabled: true } : res;
  }
  const { data, error } = await db.from("discounts").delete().eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) {
    if (/foreign key|violates/i.test(error.message)) {
      const res = await setDiscountActive(id, false);
      return res.ok ? { ok: true, id, disabled: true } : res;
    }
    return fail(campErrorKey(error.message), me.orgId);
  }
  if (!data?.length) return fail("camps.errors.notFound", me.orgId);
  revalidatePath("/admin/discounts");
  return { ok: true };
}

/** Admin / finance: take a discount off one camp registration (credit note when the invoice is issued). */
export async function applyManualDiscount(registrationId: string, discountId: string, reason: string, amount?: number | null): Promise<DiscountActionResult> {
  const me = await requireStaff(["admin", "finance"]);
  if (!me) return fail("camps.errors.notPermitted");
  if (!uuid.safeParse(registrationId).success || !uuid.safeParse(discountId).success) return fail("camps.errors.invalidRequest", me.orgId);
  const r = z.string().trim().min(1, "camps.errors.reasonRequired").max(500, "camps.errors.tooLong").safeParse(reason);
  if (!r.success) return fail(firstIssueKey(r.error), me.orgId);
  const amt = amount === null || amount === undefined || Number.isNaN(amount) ? null : Number(amount);
  if (amt !== null && !(amt > 0 && amt <= 1_000_000)) return fail("camps.errors.value", me.orgId);
  const db = await campsDb();
  const { data, error } = await db.rpc("apply_manual_discount", { p_registration: registrationId, p_discount: discountId, p_reason: r.data, p_amount: amt });
  if (error) return fail(campErrorKey(error.message), me.orgId);
  const res = (data ?? {}) as { applied_discount_id?: string };
  revalidatePath(`/admin/registrations/${registrationId}`);
  revalidatePath("/admin/invoices");
  return { ok: true, id: res.applied_discount_id };
}
