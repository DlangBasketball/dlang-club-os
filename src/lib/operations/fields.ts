import type { Translator } from "@/lib/i18n/translator";
import { CONDITIONS, EQUIPMENT_CATEGORIES, SPONSOR_STATUSES, SPONSOR_TIERS } from "./validation";
import type { SponsorRow } from "./db";

/** Sponsor form: an existing customer, or a new company with its contact. */
export function sponsorFields(t: Translator, currency: string, customers: { value: string; label: string }[], s: SponsorRow | null) {
  return [
    { name: "customerId", label: t("operations.sponsors.company"), type: "select" as const, defaultValue: s?.customer_id,
      options: [{ value: "", label: t("operations.sponsors.newCompany") }, ...customers] },
    ...(s ? [] : [
      { name: "companyName", label: t("operations.sponsors.companyName") },
      { name: "contactName", label: t("operations.customers.contact") },
      { name: "email", label: t("common.email"), type: "email" as const },
      { name: "phone", label: t("common.phone") },
    ]),
    { name: "tier", label: t("operations.sponsors.tier"), type: "select" as const, defaultValue: s?.tier ?? "partner",
      options: SPONSOR_TIERS.map((x) => ({ value: x, label: t.dynamic(`operations.sponsors.tiers.${x}`) })) },
    { name: "packageName", label: t("operations.sponsors.package"), defaultValue: s?.package_name },
    { name: "amount", label: t("operations.sponsors.amount", { currency: s?.currency ?? currency }), type: "number" as const, step: "0.01", min: 0, defaultValue: s?.amount ?? 0 },
    { name: "contractStart", label: t("operations.sponsors.contractStart"), type: "date" as const, defaultValue: s?.contract_start },
    { name: "contractEnd", label: t("operations.sponsors.contractEnd"), type: "date" as const, defaultValue: s?.contract_end },
    { name: "renewalReminderDays", label: t("operations.sponsors.reminderDays"), type: "number" as const, min: 0, max: 365, defaultValue: s?.renewal_reminder_days ?? 60 },
    { name: "status", label: t("common.status"), type: "select" as const, defaultValue: s?.status ?? "active",
      options: SPONSOR_STATUSES.map((x) => ({ value: x, label: t.dynamic(`operations.sponsors.statuses.${x}`) })) },
    { name: "notes", label: t("common.notes"), type: "textarea" as const, rows: 2, defaultValue: s?.notes },
  ];
}

/** Field definitions for the operations forms (labels translated on the server). */
export function equipmentFields(
  t: Translator,
  venues: { id: string; name: string }[],
  item: { name: string; category: string; venue_id: string | null; quantity: number; condition: string; purchase_date: string | null; purchase_value: number | null; notes: string | null; is_active: boolean } | null,
) {
  return [
    { name: "name", label: t("operations.equipment.name"), required: true, defaultValue: item?.name },
    { name: "category", label: t("operations.equipment.category"), type: "select" as const, defaultValue: item?.category ?? "other",
      options: EQUIPMENT_CATEGORIES.map((c) => ({ value: c, label: t.dynamic(`operations.equipment.categories.${c}`) })) },
    { name: "venueId", label: t("operations.equipment.location"), type: "select" as const, defaultValue: item?.venue_id,
      options: [{ value: "", label: t("common.none") }, ...venues.map((v) => ({ value: v.id, label: v.name }))] },
    { name: "quantity", label: t("operations.equipment.quantity"), type: "number" as const, min: 0, defaultValue: item?.quantity ?? 1, required: true },
    { name: "condition", label: t("operations.equipment.condition"), type: "select" as const, defaultValue: item?.condition ?? "good",
      options: CONDITIONS.map((c) => ({ value: c, label: t.dynamic(`operations.conditions.${c}`) })) },
    { name: "purchaseDate", label: t("operations.equipment.purchaseDate"), type: "date" as const, defaultValue: item?.purchase_date },
    { name: "purchaseValue", label: t("operations.equipment.purchaseValue"), type: "number" as const, step: "0.01", min: 0, defaultValue: item?.purchase_value },
    { name: "notes", label: t("common.notes"), type: "textarea" as const, defaultValue: item?.notes, rows: 2 },
    { name: "isActive", label: t("operations.common.active"), type: "checkbox" as const, defaultValue: item?.is_active ?? true },
  ];
}
