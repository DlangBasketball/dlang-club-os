import "server-only";
import { DEFAULT_PLAN_SETTINGS, PRODUCT_TYPES, type PlanSettings, type ProductType } from "@/lib/payments/plans";
import { plansAdminDb, type PlanSettingsRow } from "./db";

/** Row -> camelCase settings (defaults when the club never saved any). */
export function toPlanSettings(row: Partial<PlanSettingsRow> | null | undefined): PlanSettings {
  if (!row) return { ...DEFAULT_PLAN_SETTINGS };
  return {
    enabled: Boolean(row.enabled),
    productTypes: (row.product_types ?? []).filter((p): p is ProductType => (PRODUCT_TYPES as readonly string[]).includes(p)),
    allowedCounts: (row.allowed_counts ?? DEFAULT_PLAN_SETTINGS.allowedCounts).map(Number),
    minAmount: Number(row.min_amount ?? 0),
    feeKind: (row.fee_kind as PlanSettings["feeKind"]) ?? "none",
    feeValue: Number(row.fee_value ?? 0),
    firstAtSignup: Boolean(row.first_at_signup),
    scheduleKind: row.schedule_kind === "custom" ? "custom" : "monthly",
    dayOfMonth: Number(row.day_of_month ?? 1),
    customDates: row.custom_dates ?? [],
    campLastDaysBefore: row.camp_last_days_before ?? null,
    autopayEnabled: Boolean(row.autopay_enabled),
    retryDays: (row.retry_days ?? DEFAULT_PLAN_SETTINGS.retryDays).map(Number),
    remindBeforeDays: Number(row.remind_before_days ?? 3),
    overdueRepeatDays: Number(row.overdue_repeat_days ?? 7),
    mandateVersion: row.mandate_version ?? "1",
  };
}

/** Club rules, read with the service role (public checkout pages have no session). */
export async function loadPlanSettings(orgId: string): Promise<PlanSettings> {
  const { data } = await plansAdminDb().from("payment_plan_settings").select("*").eq("org_id", orgId).maybeSingle();
  return toPlanSettings(data as PlanSettingsRow | null);
}

/** Org time zone (for "today" in the club's calendar). */
export async function orgTimeZone(orgId: string): Promise<string | null> {
  const { data } = await plansAdminDb().from("organizations").select("timezone").eq("id", orgId).maybeSingle();
  return ((data as { timezone?: string | null } | null)?.timezone) ?? null;
}
