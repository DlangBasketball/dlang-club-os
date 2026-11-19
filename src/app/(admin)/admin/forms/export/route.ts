import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { formsDb } from "@/lib/forms/db";
import { displayAnswer } from "@/lib/forms/logic";
import { resolveConfig } from "@/lib/registration-form/config";
import { writeAudit } from "@/lib/people/server";

/** CSV cell escaping; a leading = + - @ is neutralised (spreadsheet formula injection). */
function cell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /admin/forms/export?program=<id>: one row per registration of the
 * programme with the configured built-ins and every custom answer. Admins
 * only (answers can contain health information); every export is audited.
 */
export async function GET(request: Request) {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const programId = new URL(request.url).searchParams.get("program") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(programId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const t = await getTranslations();
  const db = await formsDb();
  const { data: program } = await db.from("programs").select("id,name,slug").eq("id", programId).eq("org_id", me.orgId).maybeSingle();
  if (!program) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [{ data: regs }, { data: answers }, { data: cfgRow }] = await Promise.all([
    db.from("registrations").select("id,athlete_id,status,created_at").eq("org_id", me.orgId).eq("program_id", programId).order("created_at"),
    db.from("registration_answers").select("registration_id,answers,questions").eq("org_id", me.orgId).eq("program_id", programId),
    db.from("registration_form_configs").select("builtin,questions").eq("org_id", me.orgId).eq("program_id", programId).maybeSingle(),
  ]);
  const athIds = Array.from(new Set((regs ?? []).map((r) => r.athlete_id)));
  const { data: aths } = athIds.length
    ? await db.from("athletes").select("id,first_name,last_name,dob,school,nationality,jersey_size,dominant_hand,position_pref").in("id", athIds)
    : { data: [] as { id: string; first_name: string; last_name: string; dob: string; school: string | null; nationality: string | null; jersey_size: string | null; dominant_hand: string | null; position_pref: string | null }[] };
  const aMap = new Map((aths ?? []).map((a) => [a.id, a]));
  const ansMap = new Map((answers ?? []).map((a) => [a.registration_id, a]));
  const config = resolveConfig(cfgRow ? { builtin: cfgRow.builtin, questions: cfgRow.questions } : null);
  // Questions: the current config first, then any older ones still present in stored answers.
  const questions = [...config.questions];
  for (const a of answers ?? []) for (const q of resolveConfig({ questions: a.questions }).questions) if (!questions.some((x) => x.id === q.id)) questions.push(q);
  const answerable = questions.filter((q) => q.type !== "info");
  const extraCols = (["school", "nationality", "jerseySize", "dominantHand", "positionPref"] as const).filter((k) => config.builtin[k].shown);
  const colOf = { school: "school", nationality: "nationality", jerseySize: "jersey_size", dominantHand: "dominant_hand", positionPref: "position_pref" } as const;
  const labels = { yes: t("common.yes"), no: t("common.no"), accepted: t("forms.view.accepted") };

  const header = [
    t("forms.export.firstName"), t("forms.export.lastName"), t("forms.export.dob"), t("forms.export.status"), t("forms.export.registeredAt"),
    ...extraCols.map((k) => t.dynamic(`forms.builtin.${k}`)), ...answerable.map((q) => q.label),
  ];
  const lines = (regs ?? []).map((r) => {
    const a = aMap.get(r.athlete_id);
    const ans = (ansMap.get(r.id)?.answers ?? {}) as Record<string, unknown>;
    return [
      a?.first_name, a?.last_name, a?.dob, r.status, r.created_at.slice(0, 10),
      ...extraCols.map((k) => (a ? (a[colOf[k]] as string | null) : null)),
      ...answerable.map((q) => displayAnswer(q, ans[q.id], labels)),
    ].map(cell).join(",");
  });
  await writeAudit({ id: me.id, orgId: me.orgId }, "forms.registrationAnswers.export", "registration_answers", null, { programId, rows: lines.length });
  const name = (program.slug ?? "programme").replace(/[^a-z0-9-]/gi, "-");
  return new NextResponse("﻿" + [header.map(cell).join(","), ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="registrations-${name}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
