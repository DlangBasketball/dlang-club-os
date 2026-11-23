import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { answerRows, type RegistrationAnswerView } from "@/lib/registration-form/server";
import { campRegistrationState, type CampRegistrationState } from "./age-approval";

/**
 * Reads of the camp age approval workflow, all through the signed-in user's
 * RLS client (registrations_select: finance/admin of the org, the child's
 * guardians). Pages add their own role checks on top.
 */
type Db = SupabaseClient;
async function db(): Promise<Db> {
  return (await createClient()) as unknown as Db;
}

type RegRow = {
  id: string; athlete_id: string; program_id: string; camp_edition_id: string; status: string; created_at: string;
  camp_days: string[] | null; camp_includes_lunch: boolean | null; camp_age_group_id: string | null;
  price_amount: number | string | null; price_currency: string | null; price_snapshot: Record<string, unknown> | null;
  invoice_id: string | null; approval_status: string | null; approval_age: number | null; approval_requested_at: string | null;
  approval_decided_at: string | null; approval_note: string | null; registered_by: string | null;
};
const REG_COLS = "id,athlete_id,program_id,camp_edition_id,status,created_at,camp_days,camp_includes_lunch,camp_age_group_id,price_amount,price_currency,price_snapshot,invoice_id,approval_status,approval_age,approval_requested_at,approval_decided_at,approval_note,registered_by";

export type ApprovalQueueItem = {
  id: string; submittedAt: string | null; ageOnStart: number | null;
  athleteId: string; athleteName: string;
  programId: string; programName: string;
  edition: { id: string; name: string | null; startsOn: string; endsOn: string; capacity: number | null; taken: number };
  family: { name: string | null; email: string | null; phone: string | null };
  submittedBy: { name: string | null; email: string | null } | null;
  optionLabel: string | null; ageGroup: string | null; days: string[]; includesLunch: boolean | null;
  amount: number | null; currency: string | null;
  answers: RegistrationAnswerView[];
  consents: { title: string; version: number; acceptedAt: string }[];
};

/** Number of open requests of the club (admin badge). */
export async function countPendingApprovals(orgId: string): Promise<number> {
  const { count } = await (await db()).from("registrations").select("id", { count: "exact", head: true })
    .eq("org_id", orgId).eq("approval_status", "pending");
  return count ?? 0;
}

/** Open requests with everything the admin reviews (no medical data). */
export async function listApprovalQueue(orgId: string): Promise<ApprovalQueueItem[]> {
  const c = await db();
  const { data } = await c.from("registrations").select(REG_COLS).eq("org_id", orgId).eq("approval_status", "pending")
    .order("approval_requested_at", { ascending: true }).limit(200);
  const rows = (data ?? []) as RegRow[];
  if (!rows.length) return [];
  const uniq = <T,>(xs: (T | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is T => x !== null && x !== undefined)));
  const athleteIds = uniq(rows.map((r) => r.athlete_id));
  const editionIds = uniq(rows.map((r) => r.camp_edition_id));
  const programIds = uniq(rows.map((r) => r.program_id));
  const groupIds = uniq(rows.map((r) => r.camp_age_group_id));
  const byIds = uniq(rows.map((r) => r.registered_by));
  const [ath, eds, progs, groups, taken, answers, consents, people] = await Promise.all([
    c.from("athletes").select("id,first_name,last_name,family_id").eq("org_id", orgId).in("id", athleteIds),
    c.from("camp_editions").select("id,name,starts_on,ends_on,capacity").eq("org_id", orgId).in("id", editionIds),
    c.from("programs").select("id,name").eq("org_id", orgId).in("id", programIds),
    groupIds.length ? c.from("camp_age_groups").select("id,label").eq("org_id", orgId).in("id", groupIds) : Promise.resolve({ data: [] }),
    c.from("registrations").select("camp_edition_id").eq("org_id", orgId).in("camp_edition_id", editionIds).in("status", ["pending", "confirmed"]),
    c.from("registration_answers").select("registration_id,answers,questions").eq("org_id", orgId).in("registration_id", rows.map((r) => r.id)),
    c.from("consent_acceptances").select("athlete_id,program_id,accepted_version,accepted_at,consent_form_id,status").eq("org_id", orgId)
      .in("athlete_id", athleteIds).in("program_id", programIds).eq("status", "accepted"),
    byIds.length ? c.from("profiles").select("id,full_name,email").in("id", byIds) : Promise.resolve({ data: [] }),
  ]);
  const athletes = new Map(((ath.data ?? []) as { id: string; first_name: string; last_name: string; family_id: string }[]).map((a) => [a.id, a]));
  const familyIds = uniq(Array.from(athletes.values()).map((a) => a.family_id));
  const formIds = uniq(((consents.data ?? []) as { consent_form_id: string }[]).map((x) => x.consent_form_id));
  const [fams, forms] = await Promise.all([
    familyIds.length ? c.from("families").select("id,name,contact_email,phone").eq("org_id", orgId).in("id", familyIds) : Promise.resolve({ data: [] }),
    formIds.length ? c.from("consent_forms").select("id,title").eq("org_id", orgId).in("id", formIds) : Promise.resolve({ data: [] }),
  ]);
  const families = new Map(((fams.data ?? []) as { id: string; name: string | null; contact_email: string | null; phone: string | null }[]).map((f) => [f.id, f]));
  const editions = new Map(((eds.data ?? []) as { id: string; name: string | null; starts_on: string; ends_on: string; capacity: number | null }[]).map((e) => [e.id, e]));
  const programs = new Map(((progs.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const groupLabels = new Map(((groups.data ?? []) as { id: string; label: string }[]).map((g) => [g.id, g.label]));
  const formTitles = new Map(((forms.data ?? []) as { id: string; title: string }[]).map((f) => [f.id, f.title]));
  const profiles = new Map(((people.data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => [p.id, p]));
  const takenBy = new Map<string, number>();
  for (const t of (taken.data ?? []) as { camp_edition_id: string }[]) takenBy.set(t.camp_edition_id, (takenBy.get(t.camp_edition_id) ?? 0) + 1);
  const answersBy = new Map(((answers.data ?? []) as { registration_id: string; answers: unknown; questions: unknown }[]).map((a) => [a.registration_id, a]));
  const consentRows = (consents.data ?? []) as { athlete_id: string; program_id: string; accepted_version: number; accepted_at: string; consent_form_id: string }[];

  return rows.map((r): ApprovalQueueItem => {
    const a = athletes.get(r.athlete_id);
    const f = a ? families.get(a.family_id) : undefined;
    const e = editions.get(r.camp_edition_id);
    const snap = (r.price_snapshot ?? {}) as { option_label?: string };
    const ans = answersBy.get(r.id);
    const by = r.registered_by ? profiles.get(r.registered_by) : undefined;
    return {
      id: r.id, submittedAt: r.approval_requested_at, ageOnStart: r.approval_age,
      athleteId: r.athlete_id, athleteName: a ? `${a.first_name} ${a.last_name}` : "",
      programId: r.program_id, programName: programs.get(r.program_id) ?? "",
      edition: { id: r.camp_edition_id, name: e?.name ?? null, startsOn: e?.starts_on ?? "", endsOn: e?.ends_on ?? "", capacity: e?.capacity ?? null, taken: takenBy.get(r.camp_edition_id) ?? 0 },
      family: { name: f?.name ?? null, email: f?.contact_email ?? null, phone: f?.phone ?? null },
      submittedBy: by ? { name: by.full_name, email: by.email } : null,
      optionLabel: snap.option_label ?? null, ageGroup: r.camp_age_group_id ? groupLabels.get(r.camp_age_group_id) ?? null : null,
      days: r.camp_days ?? [], includesLunch: r.camp_includes_lunch,
      amount: r.price_amount === null ? null : Number(r.price_amount), currency: r.price_currency,
      answers: ans ? answerRows(ans.questions, ans.answers) : [],
      consents: consentRows.filter((x) => x.athlete_id === r.athlete_id && x.program_id === r.program_id)
        .map((x) => ({ title: formTitles.get(x.consent_form_id) ?? "", version: x.accepted_version, acceptedAt: x.accepted_at })),
    };
  });
}

export type FamilyCampRegistration = {
  id: string; athleteId: string; athleteName: string; programName: string;
  editionName: string | null; startsOn: string; endsOn: string; state: CampRegistrationState;
  amount: number | null; currency: string | null; note: string | null; decidedAt: string | null;
  invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null;
};

/**
 * Camp weeks of the guardian's own children (parent "My bookings"): open
 * requests, approved ones awaiting payment, confirmed and declined. RLS
 * returns the guardian's children only.
 */
export async function listFamilyCampRegistrations(orgId: string, athleteIds: string[]): Promise<FamilyCampRegistration[]> {
  if (!athleteIds.length) return [];
  const c = await db();
  const { data } = await c.from("registrations").select(REG_COLS).eq("org_id", orgId).in("athlete_id", athleteIds)
    .not("camp_edition_id", "is", null).order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as RegRow[];
  if (!rows.length) return [];
  const uniq = (xs: (string | null)[]) => Array.from(new Set(xs.filter((x): x is string => !!x)));
  const [ath, eds, progs, invs] = await Promise.all([
    c.from("athletes").select("id,first_name,last_name").in("id", uniq(rows.map((r) => r.athlete_id))),
    c.from("camp_editions").select("id,name,starts_on,ends_on").in("id", uniq(rows.map((r) => r.camp_edition_id))),
    c.from("programs").select("id,name").in("id", uniq(rows.map((r) => r.program_id))),
    uniq(rows.map((r) => r.invoice_id)).length ? c.from("invoices").select("id,number,status").in("id", uniq(rows.map((r) => r.invoice_id))) : Promise.resolve({ data: [] }),
  ]);
  const athletes = new Map(((ath.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  const editions = new Map(((eds.data ?? []) as { id: string; name: string | null; starts_on: string; ends_on: string }[]).map((e) => [e.id, e]));
  const programs = new Map(((progs.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const invoices = new Map(((invs.data ?? []) as { id: string; number: string; status: string }[]).map((i) => [i.id, i]));
  return rows
    // A cancelled week that never was an approval request stays out of the list.
    .filter((r) => r.status !== "cancelled" || r.approval_status === "declined")
    .map((r) => {
      const e = editions.get(r.camp_edition_id);
      const inv = r.invoice_id ? invoices.get(r.invoice_id) : undefined;
      return {
        id: r.id, athleteId: r.athlete_id, athleteName: athletes.get(r.athlete_id) ?? "", programName: programs.get(r.program_id) ?? "",
        editionName: e?.name ?? null, startsOn: e?.starts_on ?? "", endsOn: e?.ends_on ?? "",
        state: campRegistrationState({ status: r.status, approvalStatus: r.approval_status }),
        amount: r.price_amount === null ? null : Number(r.price_amount), currency: r.price_currency,
        note: r.approval_status === "approved" || r.approval_status === "declined" ? r.approval_note : null,
        decidedAt: r.approval_decided_at,
        invoiceId: inv ? r.invoice_id : null, invoiceNumber: inv?.number ?? null, invoiceStatus: inv?.status ?? null,
      };
    });
}
