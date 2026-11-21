"use server";

import { assertFeature } from "@/lib/upgrades/server";
import { revalidatePath } from "next/cache";
import { caDb } from "@/lib/club-admin/db";
import { audit, dbErrorKey, done, fail, removePrivateFile, requireMe, signedFileUrl, uploadPrivateFile, type CaResult } from "@/lib/club-admin/server";
import { familyRecipients, sendNotice } from "@/lib/club-admin/notify";
import { firstIssueKey, incidentSchema, uuid, type IncidentInput } from "@/lib/club-admin/validation";

/**
 * Injury & incident log. Admin or a coach of the athlete reports and follows
 * up (RLS: can_write_incident); guardians read; finance never. Audit rows
 * never carry the description or health details (redacting trigger + intent
 * rows with ids only).
 */
function revalidateIncidents(id?: string) {
  revalidatePath("/admin/incidents");
  revalidatePath("/coach/incidents");
  revalidatePath("/parent/incidents");
  if (id) revalidatePath(`/admin/incidents/${id}`);
}

export async function saveIncident(id: string | null, input: IncidentInput): Promise<CaResult<{ id: string }>> {
  await assertFeature("injury_log");
  const me = await requireMe(["admin", "coach"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const p = incidentSchema.safeParse(input);
  if (!p.success) return fail(firstIssueKey(p.error));
  const v = p.data;
  const row = {
    athlete_id: v.athleteId, occurred_at: v.occurredAt, program_id: v.programId, team_id: v.teamId, location: v.location,
    description: v.description, body_part: v.bodyPart, severity: v.severity, first_aid_given: v.firstAidGiven,
    first_aid_details: v.firstAidDetails, first_aid_by: v.firstAidBy, parents_informed_at: v.parentsInformedAt,
    parents_informed_how: v.parentsInformedHow, referral: v.referral, follow_up_notes: v.followUpNotes,
    return_status: v.returnStatus, cleared_on: v.clearedOn,
    // Only an admin closes a report (coaches edit while it is open).
    ...(me.roles.includes("admin") ? { status: v.status } : {}),
  };
  const db = await caDb();
  const res = id
    ? await db.from("incident_reports").update(row).eq("id", id).eq("org_id", me.orgId).select("id,athlete_id").maybeSingle()
    : await db.from("incident_reports").insert({ ...row, org_id: me.orgId, reported_by: me.id }).select("id,athlete_id").single();
  if (res.error || !res.data) return fail(res.error ? dbErrorKey(res.error.message) : "clubadmin.errors.notFound");
  await audit(me, id ? "incident.update" : "incident.create", "incident_reports", res.data.id, { severity: v.severity });

  if (!id) {
    // Tell the guardians a report exists (no details in the message; they read it in the app).
    const { data: a } = await db.from("athletes").select("first_name,family_id").eq("id", res.data.athlete_id).maybeSingle();
    if (a) {
      await sendNotice({
        orgId: me.orgId, kind: "incidentRecorded", recipients: await familyRecipients(me.orgId, a.family_id),
        params: { child: a.first_name, date: v.occurredAt, dateTime: true }, link: "/parent/incidents",
      });
    }
  }
  revalidateIncidents(res.data.id);
  return done("clubadmin.saved", { id: res.data.id });
}

/** Upload the return-to-play clearance document (FormData: file). */
export async function uploadClearance(id: string, fd: FormData): Promise<CaResult> {
  await assertFeature("injury_log");
  const me = await requireMe(["admin", "coach"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const db = await caDb();
  const { data: cur } = await db.from("incident_reports").select("id,clearance_file_path").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!cur) return fail("clubadmin.errors.notFound");
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("clubadmin.errors.noFile");
  const u = await uploadPrivateFile(me.orgId, "incidents", id, file);
  if (!u.ok) return fail(u.key);
  // RLS decides whether this user may write the report.
  const { data, error } = await db.from("incident_reports").update({ clearance_file_path: u.path, clearance_file_name: u.name })
    .eq("id", id).eq("org_id", me.orgId).select("id");
  if (error || !data?.length) {
    await removePrivateFile(u.path);
    return fail(error ? dbErrorKey(error.message) : "clubadmin.errors.forbidden");
  }
  await removePrivateFile(cur.clearance_file_path);
  await audit(me, "incident.clearance.upload", "incident_reports", id);
  revalidateIncidents(id);
  return done("clubadmin.incidents.clearanceUploaded");
}

/** Signed URL of the clearance document (anyone who can read the report — RLS). */
export async function clearanceFileUrl(id: string): Promise<CaResult<{ url: string }>> {
  await assertFeature("injury_log");
  const me = await requireMe(["admin", "coach", "parent"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const { data: r } = await (await caDb()).from("incident_reports").select("id,clearance_file_path").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!r) return fail("clubadmin.errors.notFound");
  const url = await signedFileUrl(me, "incidents", id, r.clearance_file_path, "incident_reports", id);
  return url ? { ok: true, data: { url } } : fail("clubadmin.errors.noFile");
}

export async function deleteIncident(id: string): Promise<CaResult> {
  await assertFeature("injury_log");
  const me = await requireMe(["admin"]);
  if (!me) return fail("clubadmin.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail("clubadmin.errors.invalid");
  const { data, error } = await (await caDb()).from("incident_reports").delete().eq("id", id).eq("org_id", me.orgId).select("id,clearance_file_path");
  if (error) return fail(dbErrorKey(error.message));
  if (!data?.length) return fail("clubadmin.errors.notFound");
  await removePrivateFile(data[0].clearance_file_path);
  await audit(me, "incident.delete", "incident_reports", id);
  revalidateIncidents();
  return done("clubadmin.deleted");
}
