import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getEditionRegistrations } from "@/lib/camps/data";
import { csvCell } from "@/lib/camps/logic";
import { getTranslations } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";

export const dynamic = "force-dynamic";

/**
 * Registrations of one camp edition as CSV (admin / finance of the club).
 * Holds contact details of guardians: no medical data, and every export is
 * written to the audit log.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; editionId: string }> }) {
  const { id, editionId } = await params;
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance")) || !(await tenantMatchesOrg(me.orgId))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const { data, error } = await getEditionRegistrations(me.orgId, editionId);
  if (error) return new NextResponse("Error", { status: 500 });
  if (!data?.edition || data.edition.programId !== id) return new NextResponse("Not found", { status: 404 });
  const t = await getTranslations(me.orgId);

  const header = [
    t("camps.export.athlete"), t("camps.export.dob"), t("camps.export.family"), t("camps.export.membership"), t("common.email"), t("common.phone"),
    t("camps.register.ageGroup"), t("camps.export.option"), t("camps.export.days"), t("camps.register.lunch"),
    t("camps.export.listAmount"), t("camps.export.discountAmount"), t("common.amount"), t("camps.export.currency"),
    t("camps.export.discounts"), t("common.status"), t("camps.export.invoice"), t("camps.export.registeredAt"),
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const r of data.rows) {
    lines.push([
      r.athleteName, r.dob, r.familyName, r.membership ? t.dynamic(`camps.membership.${r.membership}`, undefined, r.membership) : "",
      r.contactEmail, r.contactPhone, r.ageGroup, r.optionLabel, r.days.join(" "),
      r.includesLunch === null ? "" : r.includesLunch ? t("common.yes") : t("common.no"),
      r.listAmount?.toFixed(2) ?? "", r.discountAmount?.toFixed(2) ?? "", r.amount?.toFixed(2) ?? "", r.currency,
      r.discounts.join("; "), r.status, r.invoiceNumber, r.createdAt.slice(0, 10),
    ].map((v) => csvCell(v as string | number | null)).join(","));
  }
  await writeAudit({ id: me.id, orgId: me.orgId }, "camp.edition.export", "camp_editions", editionId, { rows: data.rows.length });
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="camp-${data.edition.startsOn}-${editionId.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
