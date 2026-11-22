import type { Translator } from "@/lib/i18n/translator";
import type { SelectionPaymentRow } from "./selection-report";

/** "Paid in full" / "Monthly: 10 × CHF 150.00" (screen and Excel). */
export function selectionPlanLabel(r: SelectionPaymentRow, t: Translator, money: (n: number, c: string) => string): string {
  if (r.arrangementKind === "monthly") {
    return r.installmentCount && r.monthlyAmount
      ? t("financeReports.selection.plans.monthly", { count: r.installmentCount, amount: money(r.monthlyAmount, r.currency) })
      : t("financeReports.selection.plans.monthlyOpen");
  }
  if (r.arrangementKind === "full") return t("financeReports.selection.plans.full");
  return "—";
}
