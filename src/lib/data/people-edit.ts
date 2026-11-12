import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sportsDb } from "@/lib/sportsops/db";

/**
 * Reads for the admin editors (athlete / registration / family). All through
 * the signed-in user's client, so RLS scopes every row to the caller's org.
 */

export type Opt = { id: string; label: string };

export type AthleteRegistrationRow = { id: string; programId: string; programName: string; status: string; cancellationReason: string | null };
export type AthleteTeamRow = { teamId: string; teamName: string; jerseyNumber: number | null; position: string | null; status: string };
export type ConsentRecordRow = {
  id: string;
  formId: string;
  formTitle: string;
  version: number;
  status: string;
  acceptedAt: string;
  source: string;
  signerName: string | null;
  acceptedByName: string | null;
  recordedByName: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
};
export type ConsentFormOpt = { id: string; label: string; version: number };

export type AthleteEditContext = {
  families: Opt[];
  programs: Opt[];
  registrations: AthleteRegistrationRow[];
  teams: AthleteTeamRow[];
  consents: ConsentRecordRow[];
  consentForms: ConsentFormOpt[];
  guardians: Opt[];
};

const uniq = (ids: (string | null | undefined)[]) => Array.from(new Set(ids.filter((x): x is string => Boolean(x))));

export async function getAthleteEditContext(athleteId: string, familyId: string): Promise<AthleteEditContext> {
  const supabase = await createClient();
  const sports = await sportsDb(); // teams / team_memberships are typed in the sports-ops client
  const [families, programs, regs, teamRows, consents, forms, members] = await Promise.all([
    supabase.from("families").select("id,name").order("name"),
    supabase.from("programs").select("id,name,is_active").order("name"),
    supabase.from("registrations").select("id,program_id,status,cancellation_reason").eq("athlete_id", athleteId).order("created_at", { ascending: false }),
    sports.from("team_memberships").select("team_id,jersey_number,position,status").eq("athlete_id", athleteId),
    supabase
      .from("consent_acceptances")
      .select("id,consent_form_id,accepted_version,status,accepted_at,source,signer_name,accepted_by,recorded_by,withdrawn_at,withdrawal_reason")
      .eq("athlete_id", athleteId)
      .order("accepted_at", { ascending: false }),
    supabase.from("consent_forms").select("id,title,version,is_active,key").order("key").order("version", { ascending: false }),
    supabase.from("family_members").select("profile_id,relation").eq("family_id", familyId),
  ]);

  const teamIds = uniq((teamRows.data ?? []).map((r) => r.team_id));
  const profileIds = uniq([
    ...(members.data ?? []).map((m) => m.profile_id),
    ...(consents.data ?? []).flatMap((c) => [c.accepted_by, c.recorded_by]),
  ]);
  const [teams, profiles] = await Promise.all([
    teamIds.length ? sports.from("teams").select("id,name").in("id", teamIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    profileIds.length ? supabase.from("profiles").select("id,full_name,email").in("id", profileIds) : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
  ]);
  const pName = new Map((programs.data ?? []).map((p) => [p.id, p.name]));
  const tName = new Map(((teams.data ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const who = new Map(((profiles.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, p.full_name || p.email]));
  const fTitle = new Map((forms.data ?? []).map((f) => [f.id, f.title]));

  return {
    families: (families.data ?? []).map((f) => ({ id: f.id, label: f.name })),
    programs: (programs.data ?? []).filter((p) => p.is_active).map((p) => ({ id: p.id, label: p.name })),
    registrations: (regs.data ?? []).map((r) => ({
      id: r.id,
      programId: r.program_id,
      programName: pName.get(r.program_id) ?? "—",
      status: r.status,
      cancellationReason: r.cancellation_reason,
    })),
    teams: ((teamRows.data ?? []) as { team_id: string; jersey_number: number | null; position: string | null; status: string }[]).map((r) => ({
      teamId: r.team_id,
      teamName: tName.get(r.team_id) ?? "—",
      jerseyNumber: r.jersey_number,
      position: r.position,
      status: r.status,
    })),
    consents: (consents.data ?? []).map((c) => ({
      id: c.id,
      formId: c.consent_form_id,
      formTitle: fTitle.get(c.consent_form_id) ?? "—",
      version: c.accepted_version,
      status: c.status,
      acceptedAt: c.accepted_at,
      source: c.source ?? "online",
      signerName: c.signer_name,
      acceptedByName: c.accepted_by ? who.get(c.accepted_by) ?? null : null,
      recordedByName: c.recorded_by ? who.get(c.recorded_by) ?? null : null,
      withdrawnAt: c.withdrawn_at,
      withdrawalReason: c.withdrawal_reason,
    })),
    consentForms: (forms.data ?? []).filter((f) => f.is_active).map((f) => ({ id: f.id, label: f.title, version: f.version })),
    guardians: (members.data ?? []).map((m) => ({ id: m.profile_id, label: who.get(m.profile_id) ?? "—" })),
  };
}

/** Active programmes of the caller's org, for the registration editor. */
export async function listProgramOptions(): Promise<Opt[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("programs").select("id,name,is_active").order("name");
  return (data ?? []).map((p) => ({ id: p.id, label: p.is_active ? p.name : `${p.name} *` }));
}
