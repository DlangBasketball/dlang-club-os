import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/get-user";
import { logError } from "@/lib/log";
import { participantsDb } from "./db";
import {
  ACTIVE_ATHLETE_COOKIE, ALL_ATHLETES, resolveActiveAthlete, resolveAthleteFilter, type AthleteFilter,
} from "./active-athlete";

export type MyAthleteTeam = { id: string; name: string; jerseyNumber: number | null };
export type MyAthleteProgramme = { id: string; registrationId: string; name: string; kind: string; status: string; balance: number | null };
export type MyAthleteMembership = { id: string; name: string; status: string; balance: number | null };
export type MyAthleteRequest = { id: string; status: "pending" | "info_requested"; subjectKind: string; name: string | null };
export type MyAthleteLink = {
  id: string; relation: string; canRegister: boolean; canPay: boolean; canSeeMedical: boolean; receivesEmails: boolean; canEditProfile: boolean;
};
export type MyAthlete = {
  id: string; firstName: string; lastName: string; name: string; dob: string | null; gender: string | null; status: string;
  familyId: string | null; kind: "self" | "child" | "linked"; age: number | null;
  /** "A child I'm linked to" (this child only): relation + what the adult may do. Null for own family / self. */
  link: MyAthleteLink | null;
  sports: { heightCm: number | null; weightKg: number | null; positionPref: string | null; jerseySize: string | null; preferredJerseyNumber: number | null };
  teams: MyAthleteTeam[]; programmes: MyAthleteProgramme[]; memberships: MyAthleteMembership[]; requests: MyAthleteRequest[];
  pendingCorrections: number;
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/** Raw row of my_athletes() -> MyAthlete. Exported for tests. */
export function toMyAthlete(r: Record<string, unknown>): MyAthlete {
  const s = (r.sports ?? {}) as Record<string, unknown>;
  const first = String(r.first_name ?? "");
  const last = String(r.last_name ?? "");
  return {
    id: String(r.id), firstName: first, lastName: last, name: `${first} ${last}`.trim(),
    dob: (r.dob as string | null) ?? null, gender: (r.gender as string | null) ?? null, status: String(r.status ?? "active"),
    familyId: (r.family_id as string | null) ?? null, kind: r.kind === "self" ? "self" : r.kind === "linked" ? "linked" : "child", age: num(r.age),
    link: r.kind === "linked" && r.link && typeof r.link === "object" ? (() => {
      const l = r.link as Record<string, unknown>;
      return {
        id: String(l.id), relation: String(l.relation ?? "other_carer"), canRegister: l.can_register === true, canPay: l.can_pay === true,
        canSeeMedical: l.can_see_medical === true, receivesEmails: l.receives_emails === true, canEditProfile: l.can_edit_profile === true,
      };
    })() : null,
    sports: {
      heightCm: num(s.height_cm), weightKg: num(s.weight_kg), positionPref: (s.position_pref as string | null) ?? null,
      jerseySize: (s.jersey_size as string | null) ?? null, preferredJerseyNumber: num(s.preferred_jersey_number),
    },
    teams: ((r.teams ?? []) as Record<string, unknown>[]).map((t) => ({ id: String(t.id), name: String(t.name ?? ""), jerseyNumber: num(t.jersey_number) })),
    programmes: ((r.programmes ?? []) as Record<string, unknown>[]).map((p) => ({
      id: String(p.id), registrationId: String(p.registration_id), name: String(p.name ?? ""), kind: String(p.kind ?? ""),
      status: String(p.status ?? ""), balance: num(p.balance),
    })),
    memberships: ((r.memberships ?? []) as Record<string, unknown>[]).map((m) => ({
      id: String(m.id), name: String(m.name ?? ""), status: String(m.status ?? ""), balance: num(m.balance),
    })),
    requests: ((r.requests ?? []) as Record<string, unknown>[]).map((q) => ({
      id: String(q.id), status: q.status === "info_requested" ? "info_requested" : "pending", subjectKind: String(q.subject_kind ?? ""),
      name: (q.name as string | null) ?? null,
    })),
    pendingCorrections: Number(r.pending_corrections ?? 0),
  };
}

/**
 * The athletes the signed-in adult manages in the current club (own self
 * profile + children of their families), with teams, programmes and open
 * requests. One database read per request (React cache).
 */
export const getMyAthletes = cache(async (): Promise<MyAthlete[]> => {
  const db = await participantsDb();
  const { data, error } = await db.rpc("my_athletes", {});
  if (error) {
    logError("participants.myAthletes", error);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toMyAthlete);
});

export type ActiveAthleteState = {
  athletes: MyAthlete[];
  /** Validated active athlete id, "all", or null (no preference yet). */
  active: string | typeof ALL_ATHLETES | null;
};

/** The adult's athletes + the validated active athlete (cookie re-checked on every read). */
export const getActiveAthleteState = cache(async (): Promise<ActiveAthleteState> => {
  const me = await getSessionUser();
  if (!me?.orgId) return { athletes: [], active: null };
  const [athletes, jar] = await Promise.all([getMyAthletes(), cookies()]);
  const active = resolveActiveAthlete({
    cookie: jar.get(ACTIVE_ATHLETE_COOKIE)?.value, userId: me.id, orgId: me.orgId, authorisedIds: athletes.map((a) => a.id),
  });
  return { athletes, active };
});

/**
 * Athlete filter of a per-athlete page: explicit ?athlete= (validated), else
 * the active athlete, else all (lists) / the first athlete.
 */
export async function athleteFilterFor(param: string | string[] | null | undefined, opts: { allowAll: boolean }): Promise<AthleteFilter & { athletes: MyAthlete[] }> {
  const { athletes, active } = await getActiveAthleteState();
  const f = resolveAthleteFilter({ param, active, authorisedIds: athletes.map((a) => a.id), allowAll: opts.allowAll });
  return { ...f, athletes };
}
