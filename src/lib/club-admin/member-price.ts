import "server-only";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { caAdminDb } from "./db";

/**
 * Member vs non-member pricing hook.
 *
 *   isMember(familyId, day)  — an active membership of the family covers the day
 *   applyMemberPrices(...)   — after a camp registration / training package
 *                              purchase: a member family pays the optional
 *                              member price (camp_price_options.member_price,
 *                              credit_packages.member_price). The difference is
 *                              a negative line on the still unpaid invoice.
 *
 * Both run with the service client; callers have already resolved the org and
 * checked the user. Never fatal: a failure leaves the list price.
 */
export async function isMember(orgId: string, familyId: string, day?: string | null): Promise<boolean> {
  const db = caAdminDb();
  const { data: fam } = await db.from("families").select("id").eq("id", familyId).eq("org_id", orgId).maybeSingle();
  if (!fam) return false;
  const { data, error } = await db.rpc("is_member", { p_family: familyId, p_on: day ?? null });
  if (error) {
    logError("clubadmin.isMember", error);
    return false;
  }
  return data === true;
}

export async function applyMemberPrices(
  orgId: string,
  kind: "camp_registration" | "training_purchase",
  ids: (string | null | undefined)[],
): Promise<number> {
  const list = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!list.length) return 0;
  let applied = 0;
  try {
    const t = await getTranslations(orgId);
    const label = t("clubadmin.membership.memberPriceLine");
    const db = caAdminDb();
    // Only rows of this org (the RPC re-reads them; this keeps a stray id out).
    const table = kind === "camp_registration" ? "registrations" : "training_package_purchases";
    const { data: rows } = await db.from(table).select("id,invoice_id").eq("org_id", orgId).in("id", list);
    const typed = (rows ?? []) as { id: string; invoice_id: string | null }[];
    for (const r of typed) {
      const { data, error } = await db.rpc("apply_member_price", { p_kind: kind, p_id: r.id, p_label: label });
      if (error) logError("clubadmin.memberPrice", error, { kind });
      else if ((data as { applied?: boolean } | null)?.applied) applied += 1;
    }
    await applySponsorships(typed.map((r) => r.invoice_id));
  } catch (e) {
    logError("clubadmin.memberPrice", e, { kind });
  }
  return applied;
}

/**
 * Sponsored players: camp and training-package invoices are sponsored once
 * the final (member) price is known (public.sponsorship_apply_service: a
 * labelled credit note, settled when nothing is left). Never fatal.
 */
async function applySponsorships(invoiceIds: (string | null)[]): Promise<void> {
  const ids = Array.from(new Set(invoiceIds.filter((x): x is string => !!x)));
  if (!ids.length) return;
  const admin = createAdminClient();
  for (const id of ids) {
    const { error } = await admin.rpc("sponsorship_apply_service", { p_invoice: id });
    if (error) logError("sponsorship.applyAfterMemberPrice", error);
  }
}
