"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertFeature } from "@/lib/upgrades/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { campsAdminDb, campsDb } from "@/lib/camps/db";
import { campErrorKey } from "@/lib/camps/validation";
import { validateApprovalBand } from "@/lib/camps/age-approval";
import { notifyFamilyOfDecision } from "@/lib/camps/approval-notify";
import { applyMemberPrices } from "@/lib/club-admin/member-price";
import { issueContractsForRegistrations } from "@/lib/contracts/server";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import { logError } from "@/lib/log";

/**
 * Camp age approval band: admin settings and decisions. Admins of the
 * current club only ("authorised admin"; finance cannot decide). The org comes
 * from the session; camp_approval_decide() re-checks role + org and locks.
 */
export type ApprovalActionResult =
  | { ok: true; outcome?: "approved" | "confirmed" | "declined" | "full"; replayed?: boolean; invoiceId?: string | null; message?: string }
  | { ok: false; error: string };

async function requireAdmin() {
  const me = await getSessionUser();
  if (!me?.orgId || !me.roles.includes("admin")) return null;
  if (!(await tenantMatchesOrg(me.orgId))) return null;
  return me as typeof me & { orgId: string };
}

async function fail(key: string, orgId?: string | null): Promise<ApprovalActionResult> {
  const t = await getTranslations(orgId);
  return { ok: false, error: t.dynamic(key, undefined, t("camps.errors.generic")) };
}

const age = z.union([z.number().int().min(0).max(99), z.null()]);
const bandInput = z.object({ min: age, max: age });

/** Sets (or clears, both null) the approval band of a camp programme. */
export async function saveCampApprovalBand(programId: string, input: { min: number | null; max: number | null }): Promise<ApprovalActionResult> {
  await assertFeature("camps");
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  if (!z.string().uuid().safeParse(programId).success) return fail("camps.errors.invalidRequest", me.orgId);
  const p = bandInput.safeParse(input);
  if (!p.success) return fail("camps.approval.errors.range", me.orgId);
  const db = await campsDb();
  const { data: prog } = await db.from("programs").select("id,min_age").eq("id", programId).eq("org_id", me.orgId).eq("kind", "camp").maybeSingle();
  if (!prog) return fail("camps.errors.notFound", me.orgId);
  const err = validateApprovalBand(p.data.min, p.data.max, (prog as { min_age: number | null }).min_age);
  if (err) return fail(err, me.orgId);
  const { data, error } = await db.from("programs").update({ approval_age_min: p.data.min, approval_age_max: p.data.max })
    .eq("id", programId).eq("org_id", me.orgId).select("id");
  if (error) return fail(campErrorKey(error.message), me.orgId);
  if (!data?.length) return fail("camps.errors.notFound", me.orgId);
  revalidatePath(`/admin/programs/${programId}`);
  revalidatePath("/parent/camps", "layout");
  return { ok: true };
}

const decideInput = z.object({
  registrationId: z.string().uuid(),
  decision: z.enum(["approve", "decline"]),
  note: z.string().trim().max(1000).optional().default(""),
  requestId: z.string().uuid(),
});
export type DecideCampApprovalInput = z.input<typeof decideInput>;

type DecideResult = {
  decided?: boolean; replayed?: boolean; reason?: string; status?: string; approval_status?: string;
  invoice_id?: string | null; invoice_number?: string | null; amount?: number | null; currency?: string | null;
  taken?: number; capacity?: number;
};

/** Approve / decline one request. A retry or double click returns the first decision. */
export async function decideCampApproval(input: DecideCampApprovalInput): Promise<ApprovalActionResult> {
  await assertFeature("camps");
  const me = await requireAdmin();
  if (!me) return fail("camps.errors.notPermitted");
  const p = decideInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0]?.path[0] === "note" ? "camps.approval.errors.noteTooLong" : "camps.errors.invalidRequest", me.orgId);
  const v = p.data;
  const t = await getTranslations(me.orgId);
  const db = await campsDb();
  const { data, error } = await db.rpc("camp_approval_decide", {
    p_registration: v.registrationId, p_decision: v.decision, p_note: v.note || null, p_request_id: v.requestId,
  });
  if (error) {
    logError("camp.approval.decide", error);
    return fail(campErrorKey(error.message), me.orgId);
  }
  const r = (data ?? {}) as DecideResult;
  if (!r.decided) {
    return { ok: true, outcome: "full", message: t("camps.approval.admin.fullMessage", { taken: r.taken ?? 0, capacity: r.capacity ?? 0 }) };
  }
  const outcome = v.decision === "decline" ? "declined" : r.status === "confirmed" ? "confirmed" : "approved";

  if (!r.replayed) {
    const admin = campsAdminDb();
    const { data: reg } = await admin.from("registrations").select("id,athlete_id,program_id,camp_edition_id,invoice_id")
      .eq("id", v.registrationId).eq("org_id", me.orgId).maybeSingle();
    const row = reg as { id: string; athlete_id: string; program_id: string; camp_edition_id: string | null; invoice_id: string | null } | null;
    if (row) {
      let amount = r.amount === null || r.amount === undefined ? null : Number(r.amount);
      if (outcome !== "declined") {
        // Same follow-ups as a regular camp booking (never fatal).
        if (await applyMemberPrices(me.orgId, "camp_registration", [row.id]) && row.invoice_id) {
          const { data: inv } = await admin.from("invoices").select("total_chf").eq("id", row.invoice_id).eq("org_id", me.orgId).maybeSingle();
          if (inv) amount = Number((inv as { total_chf: number | string }).total_chf);
        }
        await issueContractsForRegistrations(me.orgId, [row.id], me.id);
      }
      const [{ data: ath }, { data: prog }, { data: ed }] = await Promise.all([
        admin.from("athletes").select("first_name,family_id").eq("id", row.athlete_id).eq("org_id", me.orgId).maybeSingle(),
        admin.from("programs").select("name").eq("id", row.program_id).eq("org_id", me.orgId).maybeSingle(),
        row.camp_edition_id ? admin.from("camp_editions").select("starts_on,ends_on").eq("id", row.camp_edition_id).eq("org_id", me.orgId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      const a = ath as { first_name: string; family_id: string } | null;
      const e = ed as { starts_on: string; ends_on: string } | null;
      if (a) {
        await notifyFamilyOfDecision({
          orgId: me.orgId, familyId: a.family_id, athleteId: row.athlete_id, programName: (prog as { name: string } | null)?.name ?? "", childName: a.first_name,
          startsOn: e?.starts_on ?? "", endsOn: e?.ends_on ?? "", decision: outcome, note: v.note || null,
          invoiceNumber: r.invoice_number ?? null, amount, currency: r.currency ?? null,
        });
      }
    }
  }
  revalidatePath("/admin/camps/approvals");
  revalidatePath("/admin/programs", "layout");
  revalidatePath("/parent/bookings");
  revalidatePath("/parent/invoices");
  revalidatePersonEverywhere(me.orgId);
  return { ok: true, outcome, replayed: !!r.replayed, invoiceId: r.invoice_id ?? null };
}
