import { NextResponse } from "next/server";
import { getI18n } from "@/lib/i18n/server";
import { audit, requireMe } from "@/lib/club-admin/server";
import { caDb } from "@/lib/club-admin/db";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { loadJsOffer } from "@/lib/club-admin/js-server";
import { buildParticipantsCsv, buildSessionsCsv, type JsLabels } from "@/lib/club-admin/js";
import { jsExportSchema } from "@/lib/club-admin/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /admin/js/export?program=&from=&to=&part=participants|sessions&ahv=1
 * J+S activity export (CSV) for MANUAL upload to the national database (NDS).
 * Field formats: [Verify with J+S/NDS]. Admin only; AHV numbers only when
 * asked for and stored with consent (decrypted by an admin-only, audited RPC).
 */
export async function GET(req: Request) {
  const me = await requireMe(["admin"]);
  if (!me || !(await tenantMatchesOrg(me.orgId))) return new NextResponse(null, { status: 404 });
  const u = new URL(req.url);
  const p = jsExportSchema.safeParse({
    programId: u.searchParams.get("program"), from: u.searchParams.get("from"), to: u.searchParams.get("to"),
    part: u.searchParams.get("part") ?? "participants", ahv: u.searchParams.get("ahv") === "1",
  });
  if (!p.success) return new NextResponse(null, { status: 400 });
  const v = p.data;
  const { t, ctx } = await getI18n();
  const data = await loadJsOffer(me.orgId, v.programId, v.from, v.to, ctx.timeZone);
  if (!data.program) return new NextResponse(null, { status: 404 });

  const labels: JsLabels = {
    lastName: t("clubadmin.js.csv.lastName"), firstName: t("clubadmin.js.csv.firstName"), dob: t("clubadmin.js.csv.dob"),
    sex: t("clubadmin.js.csv.sex"), nationality: t("clubadmin.js.csv.nationality"), ahv: t("clubadmin.js.csv.ahv"),
    total: t("clubadmin.js.csv.total"), date: t("clubadmin.js.csv.date"), start: t("clubadmin.js.csv.start"),
    minutes: t("clubadmin.js.csv.minutes"), coach: t("clubadmin.js.csv.coach"), coachNumber: t("clubadmin.js.csv.coachNumber"),
    present: t("clubadmin.js.csv.present"), location: t("clubadmin.js.csv.location"),
  };

  let csv: string;
  if (v.part === "sessions") {
    csv = buildSessionsCsv(data.sessions, data.marks, labels);
  } else {
    let people = data.participants;
    if (v.ahv && people.length) {
      const { data: nums, error } = await (await caDb()).rpc("js_ahv_numbers", { p_athletes: people.map((x) => x.id) });
      if (error) return new NextResponse(null, { status: 403 });
      const map = new Map(((nums ?? []) as { athlete_id: string; ahv: string }[]).map((n) => [n.athlete_id, n.ahv]));
      people = people.map((x) => ({ ...x, ahv: map.get(x.id) ?? "" }));
    }
    csv = buildParticipantsCsv(data.sessions, people, data.marks, labels, v.ahv);
  }
  await audit(me, "js.export", "programs", v.programId, { part: v.part, ahv: v.ahv, from: v.from, to: v.to, rows: data.participants.length });
  const slug = (data.program.js_offer_number || data.program.name).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="js-${slug}-${v.part}-${v.from}_${v.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
