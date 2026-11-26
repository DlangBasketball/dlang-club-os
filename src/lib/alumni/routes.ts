import "server-only";
import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/people/server";
import { alumniDb, type AlumniPlacementRow, type AlumniRow } from "./db";
import { getAlumniAccess } from "./data";
import { ALUMNI_TEMPLATE_CSV, alumniToCsv } from "./csv";
import { uuid } from "./rules";

const csvResponse = (body: string, filename: string) =>
  new NextResponse("﻿" + body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });

/**
 * GET <app>/alumni/export — every alumnus with placements as CSV, in the
 * import template's columns (re-importable). ?template=1 returns the empty
 * template with one synthetic example line. Admins and coaches with alumni
 * access only; the export is audit-logged (count only).
 */
export async function exportAlumniCsv(request: Request): Promise<Response> {
  const access = await getAlumniAccess();
  if (!access) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  if (new URL(request.url).searchParams.get("template") === "1") return csvResponse(ALUMNI_TEMPLATE_CSV, "alumni-template.csv");
  const db = await alumniDb();
  const orgId = access.me.orgId;
  const [{ data: people }, { data: pls }] = await Promise.all([
    db.from("alumni").select("*").eq("org_id", orgId).order("last_name").limit(10000),
    db.from("alumni_placements").select("*").eq("org_id", orgId).order("start_date", { ascending: true }).limit(50000),
  ]);
  const byPerson = new Map<string, AlumniPlacementRow[]>();
  for (const p of (pls ?? []) as AlumniPlacementRow[]) byPerson.set(p.alumni_id, [...(byPerson.get(p.alumni_id) ?? []), p]);
  const rows = ((people ?? []) as AlumniRow[]).map((a) => ({ ...a, placements: byPerson.get(a.id) ?? [] }));
  await writeAudit({ id: access.me.id, orgId }, "alumni.exported", "alumni", null, { count: rows.length });
  return csvResponse(alumniToCsv(rows), `alumni_${today}.csv`);
}

/**
 * GET <app>/alumni/<id>/export — data export for one person (access
 * request): profile, placements and contact log as JSON. Audit-logged.
 */
export async function exportAlumnusJson(id: string): Promise<Response> {
  const access = await getAlumniAccess();
  if (!access || !uuid.safeParse(id).success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const db = await alumniDb();
  const orgId = access.me.orgId;
  const { data: a } = await db.from("alumni").select("*").eq("id", id).eq("org_id", orgId).maybeSingle();
  if (!a) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [{ data: placements }, { data: contacts }] = await Promise.all([
    db.from("alumni_placements").select("*").eq("alumni_id", id).eq("org_id", orgId),
    db.from("alumni_contacts").select("kind,direction,summary,happened_at,follow_up_on,follow_up_done,created_at").eq("alumni_id", id).eq("org_id", orgId),
  ]);
  await writeAudit({ id: access.me.id, orgId }, "alumni.data_exported", "alumni", id);
  const strip = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([k]) => !["org_id", "created_by", "updated_by"].includes(k)));
  const body = JSON.stringify({
    exported_at: new Date().toISOString(),
    person: strip(a as Record<string, unknown>),
    placements: ((placements ?? []) as Record<string, unknown>[]).map(strip),
    contact_log: contacts ?? [],
  }, null, 2);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="alumni-data_${id.slice(0, 8)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
