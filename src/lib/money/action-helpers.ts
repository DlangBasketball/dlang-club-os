import "server-only";
import { revalidatePath } from "next/cache";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";

/**
 * Shared plumbing for the money-editing server actions (invoices, payments,
 * credits). The org always comes from the session (profiles.org_id via
 * getSessionUser); the RPCs re-check role and org in the database.
 */
export type MoneyResult = { ok: true; message?: string } | { ok: false; error: string };

/** Error codes raised by the money RPCs (migration 20250420095900) that have a translated message. */
export const MONEY_ERROR_CODES = [
  "NOT_AUTHORIZED", "INVOICE_NOT_FOUND", "INVOICE_NOT_DRAFT", "INVOICE_IS_DRAFT", "INVOICE_CANCELLED",
  "INVOICE_WRITTEN_OFF", "INVOICE_LOCKED", "CREDIT_EXCEEDS_AMOUNT_DUE", "USE_CANCEL", "NOTHING_TO_WRITE_OFF",
  "INVALID_AMOUNT", "INVALID_TOTAL", "INVALID_QUANTITY", "INVALID_DISCOUNT", "INVALID_TAX_RATE", "INVALID_LOCALE",
  "NO_ITEMS", "ITEM_DESCRIPTION_REQUIRED", "FAMILY_NOT_FOUND", "REASON_REQUIRED", "ALREADY_VOIDED",
  "ALREADY_CANCELLED", "CANNOT_CANCEL", "HAS_PAYMENTS", "NOT_CANCELLED", "WAS_PAID", "USE_REOPEN",
  "ADJUSTMENT_NOT_FOUND", "INVALID_METHOD", "INVALID_DATE", "PAYMENT_NOT_FOUND", "STRIPE_PAYMENT_LOCKED",
  "NOT_VOIDABLE", "NOT_EDITABLE", "CURRENCY_MISMATCH", "CREDIT_ALREADY_USED", "NO_OVERPAYMENT",
  "AMOUNT_EXCEEDS_OVERPAYMENT", "INVOICE_NOT_PAYABLE", "NOTHING_DUE", "NO_CREDIT", "AMOUNT_TOO_HIGH",
  "CREDIT_NEGATIVE", "INVALID_CURRENCY", "ATHLETE_NOT_FOUND", "INVALID_CATEGORY", "INVALID_CREDITS",
  "NO_CHANGE", "BELOW_USED", "TAX_LOCKED", "REMINDERS_PAUSED", "INVALID_KIND",
] as const;
export type MoneyErrorCode = (typeof MONEY_ERROR_CODES)[number];

/** Finds the first known error code in a database / validation message. */
export function moneyErrorCode(message: string | null | undefined): MoneyErrorCode | null {
  const m = message ?? "";
  for (const code of MONEY_ERROR_CODES) if (new RegExp(`\\b${code}\\b`).test(m)) return code;
  return null;
}

/** Admin or finance of the caller's own club, else null. */
export async function requireMoneyStaff(): Promise<(SessionUser & { orgId: string }) | null> {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) return null;
  return me as SessionUser & { orgId: string };
}

export async function moneyT(): Promise<Translator> {
  return getTranslations();
}

/** Translated failure for an RPC / validation error; unknown errors get a generic message (details stay in logs). */
export function moneyFail(t: Translator, error: { message?: string } | string | null | undefined): MoneyResult {
  const msg = typeof error === "string" ? error : error?.message ?? "";
  const code = moneyErrorCode(msg);
  if (code) return { ok: false, error: t.dynamic(`editMoney.errors.${code}`, undefined, t("editMoney.errors.generic")) };
  if (msg) console.error("[money] action failed:", msg);
  return { ok: false, error: t("editMoney.errors.generic") };
}

export function notPermitted(t: Translator): MoneyResult {
  return { ok: false, error: t("editMoney.errors.NOT_AUTHORIZED") };
}

export function invalidInput(t: Translator): MoneyResult {
  return { ok: false, error: t("editMoney.errors.invalidInput") };
}

/** Revalidate every admin/parent view that shows invoice money. */
export function revalidateMoney(invoiceIds: (string | null | undefined)[] = []) {
  for (const id of invoiceIds) {
    if (!id) continue;
    revalidatePath(`/admin/invoices/${id}`);
    revalidatePath(`/admin/invoices/${id}/edit`);
    revalidatePath(`/parent/invoices/${id}`);
  }
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/invoices/reconcile");
  revalidatePath("/admin/payments");
  revalidatePath("/admin/credits");
  revalidatePath("/parent/invoices");
}
