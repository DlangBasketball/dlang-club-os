/** Error codes raised by the finance report functions -> translation keys (pure). */
export const REPORT_ERROR_CODES = ["NOT_AUTHORIZED", "SEASON_NOT_FOUND", "MONTH_OUTSIDE_SEASON", "TEAM_NOT_FOUND", "INVALID_DATE"] as const;
export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[number];

export function reportErrorKey(message: string | null | undefined): `financeReports.errors.${ReportErrorCode | "generic"}` {
  const m = message ?? "";
  const code = REPORT_ERROR_CODES.find((c) => m.includes(c));
  return `financeReports.errors.${code ?? "generic"}`;
}
