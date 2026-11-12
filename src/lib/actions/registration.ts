"use server";

import { z } from "zod";
import { getTranslations } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getOrgAlertRecipients } from "@/lib/data/org-alert-recipients";
import { sendEmail } from "@/lib/email/resend";
import { registrationConfirmation, adminRegistrationAlert } from "@/lib/email/templates";
import type { Json } from "@/types/database";
import { requireRole, writeAudit, type ActionResult as PeopleResult } from "@/lib/people/server";
import {
  registrationEditSchema,
  registrationCreateSchema,
  cancelSchema,
  firstIssueKey,
  type RegistrationEditInput,
  type RegistrationCreateInput,
} from "@/lib/people/validation";
import { logError } from "@/lib/log";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const childSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required"),
  lastName: z.string().trim().min(1, "Last name is required"),
  dob: z.string().trim().min(1, "Date of birth is required").refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v) < new Date(),
    "Enter a valid past date",
  ),
  gender: z.string().optional().default(""),
  allergies: z.string().optional().default(""),
  conditions: z.string().optional().default(""),
  medicalNotes: z.string().optional().default(""),
});

const schema = z.object({
  programSlug: z.string().min(1),
  parent: z.object({
    name: z.string().trim().min(1, "Your name is required"),
    email: z.string().trim().email("Enter a valid email"),
    phone: z.string().trim().min(3, "Phone is required"),
    address: z.string().optional().default(""),
    emergencyName: z.string().trim().min(1, "Emergency contact name is required"),
    emergencyPhone: z.string().trim().min(3, "Emergency contact phone is required"),
  }),
  children: z.array(childSchema).min(1, "Add at least one child"),
  consents: z.array(z.string()).default([]),
});

export type RegistrationInput = z.infer<typeof schema>;
export type SubmitResult = { ok: false; formError?: string; errors?: Record<string, string> };

function flatten(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) out[issue.path.join(".")] = issue.message;
  return out;
}

// ---------------------------------------------------------------------------
// Public submission
// ---------------------------------------------------------------------------
export async function submitRegistration(input: RegistrationInput): Promise<SubmitResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: flatten(parsed.error) };
  const data = parsed.data;

  const supabase = createAdminClient();

  // Re-resolve the program server-side (never trust client price/id).
  const { data: program } = await supabase
    .from("programs")
    .select("id,org_id,name,price_chf,is_public,is_active")
    .eq("slug", data.programSlug)
    .maybeSingle();
  if (!program || !program.is_public || !program.is_active) {
    return { ok: false, formError: "This program is no longer open for registration." };
  }

  // Enforce required consents (authoritative — from the DB, not the client).
  const { data: forms } = await supabase
    .from("consent_forms")
    .select("key,is_required")
    .eq("org_id", program.org_id)
    .eq("is_active", true);
  const required = (forms ?? []).filter((f) => f.is_required).map((f) => f.key);
  const accepted = new Set(data.consents);
  const missing = required.filter((k) => !accepted.has(k));
  if (missing.length > 0) {
    return { ok: false, formError: `Please accept all required agreements: ${missing.join(", ")}.` };
  }

  // Client IP for the consent/waiver audit trail.
  const hdrs = await headers();
  const ip = (hdrs.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  const payload = {
    program_id: program.id,
    parent: {
      name: data.parent.name,
      email: data.parent.email,
      phone: data.parent.phone,
      address: data.parent.address,
      emergency_name: data.parent.emergencyName,
      emergency_phone: data.parent.emergencyPhone,
    },
    children: data.children.map((c) => ({
      first_name: c.firstName,
      last_name: c.lastName,
      dob: c.dob,
      gender: c.gender,
      allergies: c.allergies,
      conditions: c.conditions,
      medical_notes: c.medicalNotes,
    })),
    consents: data.consents,
    ip,
  };

  const { data: result, error } = await supabase.rpc("register_public", {
    p_payload: payload as unknown as Json,
  });
  if (error) {
    console.error("[register] rpc error:", error);
    if (/REGISTRATION_CLOSED|PROGRAM_NOT_OPEN|AGE_OUT_OF_RANGE/.test(error.message ?? "")) {
      const t = await getTranslations();
      const key = /AGE_OUT_OF_RANGE/.test(error.message ?? "") ? "editOps.registration.ageOutOfRange" : "editOps.registration.closed";
      return { ok: false, formError: t(key) };
    }
    if (/VPC_REQUIRED/.test(error.message ?? "")) {
      return {
        ok: false,
        formError: "Children under 13 can't be registered online for this club. Please contact the club to register them.",
      };
    }
    return { ok: false, formError: "We couldn't complete your registration. Please try again." };
  }

  const r = (result ?? {}) as {
    invoice_number?: string;
    total_chf?: number;
    family_id?: string;
  };
  const invoiceNumber = r.invoice_number ?? "";
  const total = Number(r.total_chf ?? 0);

  // Confirmation + admin alert. Email failure must NOT roll back the (committed) registration.
  try {
    const childNames = data.children.map((c) => `${c.firstName} ${c.lastName}`);
    // The club's own name, brand, currency, time zone and host (never the platform apex).
    const org = await getOrgEmailContext(program.org_id);
    const clubName = org.clubName;
    const conf = registrationConfirmation({
      ...org.brand,
      parentName: data.parent.name,
      programName: program.name,
      children: childNames,
      invoiceNumber,
      totalChf: total,
      dueDateLabel: org.f.date(new Date(Date.now() + 14 * 864e5)),
      manageUrl: org.link("/login"),
    });
    await sendEmail({ to: data.parent.email, subject: conf.subject, html: conf.html, fromName: org.senderName ?? clubName });

    // The club's own staff only (per-org setting or its admins): the alert
    // names the parent and children, so it never goes to a shared inbox.
    const adminInboxes = await getOrgAlertRecipients(program.org_id);
    if (adminInboxes.length) {
      const alert = adminRegistrationAlert({
        ...org.brand,
        programName: program.name,
        parentName: data.parent.name,
        children: childNames,
        totalChf: total,
        invoiceNumber,
      });
      for (const to of adminInboxes) {
        await sendEmail({ to, subject: alert.subject, html: alert.html, fromName: org.senderName ?? clubName });
      }
    }
  } catch (e) {
    console.error("[register] email error (non-fatal):", e);
  }

  redirect(`/register/${data.programSlug}/success?ref=${encodeURIComponent(invoiceNumber)}`);
}

// ---------------------------------------------------------------------------
// Admin: update a registration's status
// ---------------------------------------------------------------------------
const STATUSES = ["pending", "confirmed", "waitlist", "cancelled", "completed"] as const;
export type RegistrationStatus = (typeof STATUSES)[number];

export async function updateRegistrationStatus(
  id: string,
  status: RegistrationStatus,
): Promise<{ ok: boolean; error?: string }> {
  const me = await getSessionUser();
  if (!me || !(me.roles.includes("admin") || me.roles.includes("finance"))) {
    return { ok: false, error: "Not permitted" };
  }
  if (!STATUSES.includes(status)) return { ok: false, error: "Invalid status" };

  const supabase = await createClient();
  const { error } = await supabase.from("registrations").update({ status }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/registrations/${id}`);
  revalidatePath("/admin/registrations");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Admin: edit a registration (programme, status, notes), cancel with reason,
// enrol an athlete. Admin only; the org comes from the session and every
// referenced programme / athlete is re-resolved inside that org.
// ---------------------------------------------------------------------------

async function programInOrg(programId: string, orgId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("programs").select("id").eq("id", programId).eq("org_id", orgId).maybeSingle();
  return !!data;
}

function revalidateRegistration(id: string, athleteId?: string | null) {
  revalidatePath(`/admin/registrations/${id}`);
  revalidatePath("/admin/registrations");
  if (athleteId) {
    revalidatePath(`/admin/athletes/${athleteId}`);
    revalidatePath(`/admin/athletes/${athleteId}/edit`);
  }
}

export async function updateRegistration(id: string, input: RegistrationEditInput): Promise<PeopleResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = registrationEditSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };

  const supabase = await createClient();
  const { data: reg } = await supabase
    .from("registrations")
    .select("id,athlete_id,program_id,status,cancelled_at")
    .eq("id", id)
    .eq("org_id", me.orgId)
    .maybeSingle();
  if (!reg) return { ok: false, error: t("editPeople.errors.notFound") };
  if (!(await programInOrg(p.data.programId, me.orgId))) return { ok: false, error: t("editPeople.errors.programNotFound") };

  if (p.data.programId !== reg.program_id) {
    const { data: dup } = await supabase
      .from("registrations")
      .select("id")
      .eq("athlete_id", reg.athlete_id)
      .eq("program_id", p.data.programId)
      .neq("id", id)
      .maybeSingle();
    if (dup) return { ok: false, error: t("editPeople.registrations.duplicate") };
  }

  const cancelled = p.data.status === "cancelled";
  const keepCancelledAt = reg.status === "cancelled" && reg.cancelled_at;
  const { error } = await supabase
    .from("registrations")
    .update({
      program_id: p.data.programId,
      status: p.data.status,
      notes: p.data.notes,
      cancellation_reason: cancelled ? p.data.cancellationReason : null,
      cancelled_at: cancelled ? (keepCancelledAt ? reg.cancelled_at : new Date().toISOString()) : null,
      cancelled_by: cancelled ? me.id : null,
    })
    .eq("id", id)
    .eq("org_id", me.orgId);
  if (error) {
    logError("updateRegistration", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (p.data.programId !== reg.program_id) {
    await writeAudit(me, "registration.program.change", "registrations", id, { from: reg.program_id, to: p.data.programId });
  }
  revalidateRegistration(id, reg.athlete_id);
  return { ok: true, message: t("editPeople.saved") };
}

export async function cancelRegistration(id: string, reason: string): Promise<PeopleResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = cancelSchema.safeParse({ reason });
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("registrations")
    .update({ status: "cancelled", cancellation_reason: p.data.reason, cancelled_at: new Date().toISOString(), cancelled_by: me.id })
    .eq("id", id)
    .eq("org_id", me.orgId)
    .select("athlete_id");
  if (error) {
    logError("cancelRegistration", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  if (!data?.length) return { ok: false, error: t("editPeople.errors.notFound") };
  await writeAudit(me, "registration.cancel", "registrations", id);
  revalidateRegistration(id, data[0].athlete_id);
  return { ok: true, message: t("editPeople.registrations.cancelled") };
}

/** Enrol an athlete in a programme from the admin side (no invoice is created here). */
export async function createRegistration(input: RegistrationCreateInput): Promise<PeopleResult<{ id: string }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("editPeople.errors.forbidden") };
  const p = registrationCreateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t.dynamic(firstIssueKey(p.error)) };
  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id").eq("id", p.data.athleteId).eq("org_id", me.orgId).maybeSingle();
  if (!athlete) return { ok: false, error: t("editPeople.errors.notFound") };
  if (!(await programInOrg(p.data.programId, me.orgId))) return { ok: false, error: t("editPeople.errors.programNotFound") };
  const { data: dup } = await supabase
    .from("registrations")
    .select("id")
    .eq("athlete_id", p.data.athleteId)
    .eq("program_id", p.data.programId)
    .maybeSingle();
  if (dup) return { ok: false, error: t("editPeople.registrations.duplicate") };
  const { data, error } = await supabase
    .from("registrations")
    .insert({ org_id: me.orgId, athlete_id: p.data.athleteId, program_id: p.data.programId, status: p.data.status, registered_by: me.id })
    .select("id")
    .single();
  if (error || !data) {
    logError("createRegistration", error);
    return { ok: false, error: t("editPeople.errors.saveFailed") };
  }
  revalidateRegistration(data.id, p.data.athleteId);
  return { ok: true, message: t("editPeople.registrations.enrolled"), data: { id: data.id } };
}
