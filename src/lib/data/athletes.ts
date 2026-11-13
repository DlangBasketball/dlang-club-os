import { createClient } from "@/lib/supabase/server";

export type Result<T> = { data: T; error: null } | { data: null; error: string };
const ok = <T>(data: T): Result<T> => ({ data, error: null });
const fail = (error: string): Result<never> => ({ data: null, error });

const uniq = (ids: (string | null | undefined)[]) =>
  Array.from(new Set(ids.filter((x): x is string => Boolean(x))));

export type AthleteCore = {
  id: string;
  familyId: string;
  familyName: string | null;
  firstName: string;
  lastName: string;
  dob: string;
  gender: string | null;
  nationality: string | null;
  school: string | null;
  jerseySize: string | null;
  dominantHand: string | null;
  positionPref: string | null;
  status: string;
  notes: string | null;
  photoPath: string | null;
  orgId: string;
};

export type Medical = {
  allergies: string | null;
  conditions: string | null;
  medications: string | null;
  insurance: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
} | null;

/** Subset visible to coaches via the SECURITY DEFINER athlete_safety() RPC. */
export type SafetyInfo = {
  allergies: string | null;
  conditions: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
} | null;

export type TimelineEvent = {
  id: string;
  kind: "registration" | "attendance" | "consent";
  label: string;
  sublabel: string | null;
  at: string;
  tone: "maroon" | "success" | "warning" | "neutral";
};

export type AthleteProgram = { id: string; name: string; status: string };

export type AthleteDetail = {
  athlete: AthleteCore;
  medical: Medical; // full record (admin/guardian only; null otherwise)
  safety: SafetyInfo; // coach-safe subset (always access-checked)
  programs: AthleteProgram[];
  timeline: TimelineEvent[];
};

export async function getAthleteDetail(id: string): Promise<Result<AthleteDetail | null>> {
  const supabase = await createClient();

  const { data: a, error } = await supabase
    .from("athletes")
    .select(
      "id,org_id,family_id,first_name,last_name,dob,gender,nationality,school,jersey_size,dominant_hand,position_pref,status,notes,photo_path",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return fail(error.message);
  if (!a) return ok(null);

  const [familyRes, medicalRes, safetyRes, regsRes, marksRes, consentsRes] =
    await Promise.all([
      supabase.from("families").select("name").eq("id", a.family_id).maybeSingle(),
      supabase
        .from("athlete_medical")
        .select(
          "allergies,conditions,medications,insurance,emergency_contact_name,emergency_contact_phone,notes",
        )
        .eq("athlete_id", id)
        .maybeSingle(),
      supabase.rpc("athlete_safety", { p_athlete: id }),
      supabase.from("registrations").select("id,status,created_at,program_id").eq("athlete_id", id).order("created_at", { ascending: false }),
      supabase.from("attendance_marks").select("id,status,marked_at,attendance_session_id").eq("athlete_id", id).order("marked_at", { ascending: false }),
      supabase.from("consent_acceptances").select("id,accepted_at,consent_form_id,status").eq("athlete_id", id).order("accepted_at", { ascending: false }),
    ]);

  // resolve program / session / consent names
  const programIds = uniq((regsRes.data ?? []).map((r) => r.program_id));
  const sessionIds = uniq((marksRes.data ?? []).map((m) => m.attendance_session_id));
  const consentIds = uniq((consentsRes.data ?? []).map((c) => c.consent_form_id));

  const [programs, sessions, consentForms] = await Promise.all([
    programIds.length ? supabase.from("programs").select("id,name").in("id", programIds) : Promise.resolve({ data: [] }),
    sessionIds.length ? supabase.from("attendance_sessions").select("id,program_id,session_date").in("id", sessionIds) : Promise.resolve({ data: [] }),
    consentIds.length ? supabase.from("consent_forms").select("id,title").in("id", consentIds) : Promise.resolve({ data: [] }),
  ]);
  const pName = new Map((programs.data as { id: string; name: string }[] ?? []).map((p) => [p.id, p.name]));
  const sProgram = new Map((sessions.data as { id: string; program_id: string | null }[] ?? []).map((s) => [s.id, s.program_id]));
  const cTitle = new Map((consentForms.data as { id: string; title: string }[] ?? []).map((c) => [c.id, c.title]));

  const attTone: Record<string, TimelineEvent["tone"]> = {
    present: "success",
    late: "warning",
    absent: "neutral",
    excused: "neutral",
  };

  const timeline: TimelineEvent[] = [
    ...(regsRes.data ?? []).map((r) => ({
      id: `reg-${r.id}`,
      kind: "registration" as const,
      label: `Registered for ${pName.get(r.program_id) ?? "a program"}`,
      sublabel: r.status,
      at: r.created_at,
      tone: "maroon" as const,
    })),
    ...(marksRes.data ?? []).map((m) => {
      const pid = sProgram.get(m.attendance_session_id);
      return {
        id: `att-${m.id}`,
        kind: "attendance" as const,
        label: `Marked ${m.status}`,
        sublabel: pid ? pName.get(pid) ?? null : null,
        at: m.marked_at,
        tone: attTone[m.status] ?? "neutral",
      };
    }),
    ...(consentsRes.data ?? []).map((c) => ({
      id: `con-${c.id}`,
      kind: "consent" as const,
      label: `${c.status === "accepted" ? "Accepted" : c.status} ${cTitle.get(c.consent_form_id) ?? "consent"}`,
      sublabel: null,
      at: c.accepted_at,
      tone: "neutral" as const,
    })),
  ].sort((x, y) => (y.at ?? "").localeCompare(x.at ?? ""));

  const m = medicalRes.data;
  const s = safetyRes.data?.[0] ?? null;

  return ok({
    athlete: {
      id: a.id,
      familyId: a.family_id,
      familyName: familyRes.data?.name ?? null,
      firstName: a.first_name,
      lastName: a.last_name,
      dob: a.dob,
      gender: a.gender,
      nationality: a.nationality,
      school: a.school,
      jerseySize: a.jersey_size,
      dominantHand: a.dominant_hand,
      positionPref: a.position_pref,
      status: a.status,
      notes: a.notes,
      photoPath: a.photo_path,
      orgId: a.org_id,
    },
    medical: m
      ? {
          allergies: m.allergies,
          conditions: m.conditions,
          medications: m.medications,
          insurance: m.insurance,
          emergencyContactName: m.emergency_contact_name,
          emergencyContactPhone: m.emergency_contact_phone,
          notes: m.notes,
        }
      : null,
    safety: s
      ? {
          allergies: s.allergies,
          conditions: s.conditions,
          emergencyContactName: s.emergency_contact_name,
          emergencyContactPhone: s.emergency_contact_phone,
        }
      : null,
    programs: (regsRes.data ?? []).map((r) => ({
      id: r.id,
      name: pName.get(r.program_id) ?? "Program",
      status: r.status,
    })),
    timeline,
  });
}
