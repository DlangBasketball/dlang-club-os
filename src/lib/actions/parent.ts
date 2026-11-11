"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/email/resend";
import { bookingConfirmation, coachBookingAlert } from "@/lib/email/templates";
import { formatDate, formatTime } from "@/lib/utils";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireParent() {
  const me = await getSessionUser();
  if (!me || !(me.roles.includes("parent") || me.roles.includes("admin"))) return null;
  return me;
}

// --- Contact details (own profile + own family) ----------------------------
const contactSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required"),
  profilePhone: z.string().optional().default(""),
  familyId: z.string().uuid().optional(),
  familyPhone: z.string().optional().default(""),
  familyAddress: z.string().optional().default(""),
  contactEmail: z.string().email("Enter a valid email").optional().or(z.literal("")),
});
export type ContactInput = z.input<typeof contactSchema>;

export async function updateContact(input: ContactInput): Promise<ActionResult> {
  const me = await requireParent();
  if (!me) return { ok: false, error: "Not permitted" };
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid details" };
  const d = parsed.data;

  const supabase = await createClient();
  const { error: pErr } = await supabase.from("profiles").update({ full_name: d.fullName, phone: d.profilePhone || null }).eq("id", me.id);
  if (pErr) return { ok: false, error: pErr.message };

  if (d.familyId) {
    const patch: Record<string, string | null> = { phone: d.familyPhone || null, address: d.familyAddress || null };
    if (d.contactEmail) patch.contact_email = d.contactEmail;
    const { error: fErr } = await supabase.from("families").update(patch).eq("id", d.familyId);
    if (fErr) return { ok: false, error: fErr.message };
  }
  revalidatePath("/parent/account");
  return { ok: true };
}

// --- Medical update (guardian write; the audit trigger logs every change) ---
const medicalSchema = z.object({
  allergies: z.string().optional().default(""),
  conditions: z.string().optional().default(""),
  medications: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  emergencyContactName: z.string().optional().default(""),
  emergencyContactPhone: z.string().optional().default(""),
});
export type MedicalInput = z.input<typeof medicalSchema>;

export async function updateChildMedical(athleteId: string, input: MedicalInput): Promise<ActionResult> {
  const me = await requireParent();
  if (!me) return { ok: false, error: "Not permitted" };
  const parsed = medicalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid medical details" };
  const d = parsed.data;

  const supabase = await createClient();
  // org_id required for insert path; RLS guardian_write + audit trigger handle the rest.
  const { data: athlete } = await supabase.from("athletes").select("org_id").eq("id", athleteId).maybeSingle();
  if (!athlete) return { ok: false, error: "Child not found" };

  const { error } = await supabase.from("athlete_medical").upsert(
    {
      org_id: (athlete as { org_id: string }).org_id,
      athlete_id: athleteId,
      allergies: d.allergies || null,
      conditions: d.conditions || null,
      medications: d.medications || null,
      notes: d.notes || null,
      emergency_contact_name: d.emergencyContactName || null,
      emergency_contact_phone: d.emergencyContactPhone || null,
    },
    { onConflict: "athlete_id" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/parent/children/${athleteId}`);
  return { ok: true };
}

// --- Notifications ----------------------------------------------------------
export async function markNotificationRead(id: string): Promise<ActionResult> {
  const me = await requireParent();
  if (!me) return { ok: false, error: "Not permitted" };
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/parent/notifications");
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const me = await requireParent();
  if (!me) return { ok: false, error: "Not permitted" };
  const supabase = await createClient();
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/parent/notifications");
  revalidatePath("/parent/home");
  return { ok: true };
}
