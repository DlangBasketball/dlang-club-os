import "server-only";
import { getSessionUser, type SessionUser } from "@/lib/auth/get-user";
import { logError } from "@/lib/log";
import { formsAdminDb, formsDb, FORM_FILES_BUCKET, SIGNED_URL_TTL, type FormAssignmentRow, type FormsClient, type FormSubmissionRow } from "./db";
import { parseDefinition, type FormDefinition, type FormType, type AssignmentScope, type Renewal } from "./schema";
import { completionStatus, hasUnpublishedChanges, summarise, type CompletionStatus, type CompletionSummary, type Answers } from "./logic";

/**
 * Server-side reads for forms. Admin views use the user's RLS-scoped client
 * (admins read their org); scope evaluation (which athletes an assignment
 * covers) uses the service role filtered by the session's org, because it
 * needs registrations / team memberships / purchases a parent cannot list.
 */
type Me = SessionUser & { orgId: string };
export type Res<T> = { data: T; error: null } | { data: null; error: string };

async function me(roles: ("admin" | "parent" | "coach" | "finance")[]): Promise<Me | null> {
  const u = await getSessionUser();
  if (!u?.orgId || !roles.some((r) => u.roles.includes(r))) return null;
  return u as Me;
}

export const todayIso = () => new Date().toISOString().slice(0, 10);

export type FormListItem = {
  id: string; title: string; description: string | null; formType: FormType; status: string; version: number | null;
  assignments: number; submissions: number; updatedAt: string;
};

export async function listForms(): Promise<Res<FormListItem[]>> {
  const u = await me(["admin"]);
  if (!u) return { data: null, error: "forbidden" };
  const db = await formsDb();
  const [forms, versions, asg, subs] = await Promise.all([
    db.from("forms").select("*").eq("org_id", u.orgId).order("updated_at", { ascending: false }),
    db.from("form_versions").select("id,form_id,version").eq("org_id", u.orgId),
    db.from("form_assignments").select("id,form_id,is_active").eq("org_id", u.orgId),
    db.from("form_submissions").select("form_id,status").eq("org_id", u.orgId),
  ]);
  if (forms.error) return { data: null, error: forms.error.message };
  const vById = new Map((versions.data ?? []).map((v) => [v.id, v.version]));
  return {
    data: (forms.data ?? []).map((f) => ({
      id: f.id, title: f.title, description: f.description, formType: f.form_type as FormType, status: f.status,
      version: f.current_version_id ? vById.get(f.current_version_id) ?? null : null,
      assignments: (asg.data ?? []).filter((a) => a.form_id === f.id && a.is_active).length,
      submissions: (subs.data ?? []).filter((s) => s.form_id === f.id && s.status === "submitted").length,
      updatedAt: f.updated_at,
    })),
    error: null,
  };
}

export type Assignment = {
  id: string; formId: string; scope: AssignmentScope; programId: string | null; teamId: string | null; trainingServiceId: string | null;
  targetName: string | null; renewal: Renewal; renewalMonths: number | null; dueDate: string | null; isRequired: boolean; isActive: boolean;
};
export type Targets = { programs: { id: string; name: string; kind: string }[]; teams: { id: string; name: string }[]; services: { id: string; name: string }[] };

export async function loadTargets(db: FormsClient, orgId: string): Promise<Targets> {
  const [p, t, s] = await Promise.all([
    db.from("programs").select("id,name,kind,is_active").eq("org_id", orgId).order("name"),
    db.from("teams").select("id,name,is_active").eq("org_id", orgId).order("name"),
    db.from("training_services").select("id,name,is_active").eq("org_id", orgId).order("name"),
  ]);
  return {
    programs: (p.data ?? []).map((x) => ({ id: x.id, name: x.name, kind: String(x.kind) })),
    teams: (t.data ?? []).map((x) => ({ id: x.id, name: x.name })),
    services: (s.data ?? []).map((x) => ({ id: x.id, name: x.name })),
  };
}

function toAssignment(a: FormAssignmentRow, targets: Targets): Assignment {
  const targetName =
    a.scope === "program" ? targets.programs.find((p) => p.id === a.program_id)?.name ?? null
    : a.scope === "team" ? targets.teams.find((p) => p.id === a.team_id)?.name ?? null
    : a.scope === "training_service" ? targets.services.find((p) => p.id === a.training_service_id)?.name ?? null
    : null;
  return {
    id: a.id, formId: a.form_id, scope: a.scope as AssignmentScope, programId: a.program_id, teamId: a.team_id,
    trainingServiceId: a.training_service_id, targetName, renewal: a.renewal as Renewal, renewalMonths: a.renewal_months,
    dueDate: a.due_date, isRequired: a.is_required, isActive: a.is_active,
  };
}

export type FormDetail = {
  id: string; title: string; description: string | null; formType: FormType; status: string;
  draft: FormDefinition; currentVersion: { id: string; version: number; publishedAt: string } | null;
  versions: { id: string; version: number; publishedAt: string; submissions: number }[];
  unpublishedChanges: boolean; assignments: Assignment[]; targets: Targets;
};

export async function getFormDetail(id: string): Promise<Res<FormDetail | null>> {
  const u = await me(["admin"]);
  if (!u) return { data: null, error: "forbidden" };
  const db = await formsDb();
  const { data: f, error } = await db.from("forms").select("*").eq("id", id).eq("org_id", u.orgId).maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!f) return { data: null, error: null };
  const [versions, asg, subs, targets] = await Promise.all([
    db.from("form_versions").select("*").eq("form_id", id).eq("org_id", u.orgId).order("version", { ascending: false }),
    db.from("form_assignments").select("*").eq("form_id", id).eq("org_id", u.orgId).order("created_at"),
    db.from("form_submissions").select("form_version_id,status").eq("form_id", id).eq("org_id", u.orgId),
    loadTargets(db, u.orgId),
  ]);
  const current = (versions.data ?? []).find((v) => v.id === f.current_version_id) ?? null;
  return {
    data: {
      id: f.id, title: f.title, description: f.description, formType: f.form_type as FormType, status: f.status,
      draft: parseDefinition(f.draft_schema),
      currentVersion: current ? { id: current.id, version: current.version, publishedAt: current.published_at } : null,
      versions: (versions.data ?? []).map((v) => ({
        id: v.id, version: v.version, publishedAt: v.published_at,
        submissions: (subs.data ?? []).filter((s) => s.form_version_id === v.id && s.status === "submitted").length,
      })),
      unpublishedChanges: hasUnpublishedChanges(f.draft_schema, current?.schema ?? null),
      assignments: (asg.data ?? []).map((a) => toAssignment(a, targets)),
      targets,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Scope evaluation + completion
// ---------------------------------------------------------------------------
type AthleteLite = { id: string; name: string; familyId: string; dob: string | null };

/** Athletes an assignment covers (active athletes of the org; optional restriction to `onlyAthletes`). */
export async function scopeAthletes(orgId: string, a: Pick<FormAssignmentRow, "scope" | "program_id" | "team_id" | "training_service_id">, onlyAthletes?: string[]): Promise<string[]> {
  const db = formsAdminDb();
  let ids: string[] = [];
  if (a.scope === "all_members") {
    let q = db.from("athletes").select("id").eq("org_id", orgId).eq("status", "active");
    if (onlyAthletes) q = q.in("id", onlyAthletes);
    const { data } = await q;
    ids = (data ?? []).map((r) => r.id);
  } else if (a.scope === "program" && a.program_id) {
    let q = db.from("registrations").select("athlete_id").eq("org_id", orgId).eq("program_id", a.program_id).in("status", ["pending", "confirmed"]);
    if (onlyAthletes) q = q.in("athlete_id", onlyAthletes);
    const { data } = await q;
    ids = (data ?? []).map((r) => r.athlete_id);
  } else if (a.scope === "team" && a.team_id) {
    let q = db.from("team_memberships").select("athlete_id,status").eq("org_id", orgId).eq("team_id", a.team_id).neq("status", "inactive");
    if (onlyAthletes) q = q.in("athlete_id", onlyAthletes);
    const { data } = await q;
    ids = (data ?? []).map((r) => r.athlete_id);
  } else if (a.scope === "training_service" && a.training_service_id) {
    let q = db.from("training_package_purchases").select("athlete_id").eq("org_id", orgId).eq("service_id", a.training_service_id).in("status", ["pending", "active"]);
    if (onlyAthletes) q = q.in("athlete_id", onlyAthletes);
    const { data } = await q;
    ids = (data ?? []).map((r) => r.athlete_id);
  }
  return Array.from(new Set(ids));
}

export type AthleteCompletion = { athleteId: string; name: string; familyId: string; status: CompletionStatus; submissionId: string | null; validUntil: string | null };
export type AssignmentCompletion = {
  assignment: Assignment; formId: string; formTitle: string; formType: FormType; summary: CompletionSummary; athletes: AthleteCompletion[];
};

/** Latest non-voided submission per (form, athlete). */
function latestByFormAthlete(subs: Pick<FormSubmissionRow, "id" | "form_id" | "athlete_id" | "submitted_at" | "valid_until" | "status">[]) {
  const m = new Map<string, { id: string; validUntil: string | null; submittedAt: string }>();
  for (const s of subs) {
    if (s.status !== "submitted") continue;
    const k = `${s.form_id}|${s.athlete_id}`;
    const cur = m.get(k);
    if (!cur || s.submitted_at > cur.submittedAt) m.set(k, { id: s.id, validUntil: s.valid_until, submittedAt: s.submitted_at });
  }
  return m;
}

/** Admin dashboard: completion per active assignment (optionally of one form / one programme). */
export async function getCompletion(opts: { formId?: string; programId?: string } = {}): Promise<Res<AssignmentCompletion[]>> {
  const u = await me(["admin"]);
  if (!u) return { data: null, error: "forbidden" };
  try {
    const db = await formsDb();
    let aq = db.from("form_assignments").select("*").eq("org_id", u.orgId).eq("is_active", true);
    if (opts.formId) aq = aq.eq("form_id", opts.formId);
    if (opts.programId) aq = aq.eq("program_id", opts.programId);
    const [asg, forms, targets] = await Promise.all([aq, db.from("forms").select("id,title,form_type,status").eq("org_id", u.orgId), loadTargets(db, u.orgId)]);
    if (asg.error) return { data: null, error: asg.error.message };
    const rows = (asg.data ?? []).filter((a) => (forms.data ?? []).some((f) => f.id === a.form_id && f.status === "published"));
    const scoped = await Promise.all(rows.map((a) => scopeAthletes(u.orgId, a)));
    const allIds = Array.from(new Set(scoped.flat()));
    const [aths, subs] = await Promise.all([
      allIds.length ? db.from("athletes").select("id,first_name,last_name,family_id,dob").eq("org_id", u.orgId).in("id", allIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string; family_id: string; dob: string | null }[] }),
      allIds.length && rows.length
        ? db.from("form_submissions").select("id,form_id,athlete_id,submitted_at,valid_until,status").eq("org_id", u.orgId).in("athlete_id", allIds).in("form_id", rows.map((r) => r.form_id))
        : Promise.resolve({ data: [] as FormSubmissionRow[] }),
    ]);
    const athMap = new Map<string, AthleteLite>((aths.data ?? []).map((a) => [a.id, { id: a.id, name: `${a.first_name} ${a.last_name}`, familyId: a.family_id, dob: a.dob }]));
    const latest = latestByFormAthlete(subs.data ?? []);
    const today = todayIso();
    return {
      data: rows.map((a, i) => {
        const form = (forms.data ?? []).find((f) => f.id === a.form_id)!;
        const athletes: AthleteCompletion[] = scoped[i]
          .map((id) => athMap.get(id))
          .filter((x): x is AthleteLite => !!x)
          .map((ath) => {
            const l = latest.get(`${a.form_id}|${ath.id}`) ?? null;
            return { athleteId: ath.id, name: ath.name, familyId: ath.familyId, status: completionStatus(l, a.due_date, today), submissionId: l?.id ?? null, validUntil: l?.validUntil ?? null };
          })
          .sort((x, y) => x.name.localeCompare(y.name));
        return {
          assignment: toAssignment(a, targets), formId: a.form_id, formTitle: form.title, formType: form.form_type as FormType,
          summary: summarise(athletes.map((x) => x.status)), athletes,
        };
      }),
      error: null,
    };
  } catch (e) {
    logError("forms.completion", e);
    return { data: null, error: "load_failed" };
  }
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------
export type SubmissionListItem = {
  id: string; formId: string; formTitle: string; version: number; athleteId: string; athleteName: string; familyId: string;
  submittedAt: string; validUntil: string | null; status: string; signerName: string | null;
};

export async function listSubmissions(opts: { formId?: string; athleteId?: string } = {}): Promise<Res<SubmissionListItem[]>> {
  const u = await me(["admin", "parent"]);
  if (!u) return { data: null, error: "forbidden" };
  const db = await formsDb();
  let q = db.from("form_submissions").select("*").eq("org_id", u.orgId).order("submitted_at", { ascending: false }).limit(500);
  if (opts.formId) q = q.eq("form_id", opts.formId);
  if (opts.athleteId) q = q.eq("athlete_id", opts.athleteId);
  const { data, error } = await q;
  if (error) return { data: null, error: error.message };
  const rows = data ?? [];
  const athIds = Array.from(new Set(rows.map((r) => r.athlete_id)));
  const verIds = Array.from(new Set(rows.map((r) => r.form_version_id)));
  const [aths, vers] = await Promise.all([
    athIds.length ? db.from("athletes").select("id,first_name,last_name").in("id", athIds) : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    verIds.length ? db.from("form_versions").select("id,version,title").in("id", verIds) : Promise.resolve({ data: [] as { id: string; version: number; title: string }[] }),
  ]);
  const aMap = new Map((aths.data ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  const vMap = new Map((vers.data ?? []).map((v) => [v.id, v]));
  return {
    data: rows.map((r) => ({
      id: r.id, formId: r.form_id, formTitle: vMap.get(r.form_version_id)?.title ?? "", version: vMap.get(r.form_version_id)?.version ?? 0,
      athleteId: r.athlete_id, athleteName: aMap.get(r.athlete_id) ?? "", familyId: r.family_id, submittedAt: r.submitted_at,
      validUntil: r.valid_until, status: r.status, signerName: r.signer_name,
    })),
    error: null,
  };
}

export type SubmissionDetail = SubmissionListItem & {
  formType: FormType; definition: FormDefinition; answers: Answers; voidReason: string | null; voidedAt: string | null;
  signaturePath: string | null; fileUrls: Record<string, string>;
};

/** One submission, shown against ITS OWN version. RLS decides who may read it. */
export async function getSubmission(id: string, opts: { signUrls?: boolean } = {}): Promise<Res<SubmissionDetail | null>> {
  const u = await me(["admin", "parent"]);
  if (!u) return { data: null, error: "forbidden" };
  const db = await formsDb();
  const { data: s, error } = await db.from("form_submissions").select("*").eq("id", id).eq("org_id", u.orgId).maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!s) return { data: null, error: null };
  const [{ data: v }, { data: a }] = await Promise.all([
    db.from("form_versions").select("*").eq("id", s.form_version_id).maybeSingle(),
    db.from("athletes").select("id,first_name,last_name").eq("id", s.athlete_id).maybeSingle(),
  ]);
  if (!v) return { data: null, error: null };
  const answers = (s.answers ?? {}) as Answers;
  const fileUrls: Record<string, string> = {};
  if (opts.signUrls) {
    const paths: string[] = [];
    for (const val of Object.values(answers)) {
      const p = (val as { path?: unknown } | null)?.path;
      if (typeof p === "string" && p) paths.push(p);
    }
    if (paths.length) {
      try {
        const { data: signed } = await db.storage.from(FORM_FILES_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL);
        for (const it of signed ?? []) if (it.path && it.signedUrl && !it.error) fileUrls[it.path] = it.signedUrl;
      } catch (e) {
        logError("forms.signUrls", e);
      }
    }
  }
  return {
    data: {
      id: s.id, formId: s.form_id, formTitle: v.title, version: v.version, athleteId: s.athlete_id,
      athleteName: a ? `${a.first_name} ${a.last_name}` : "", familyId: s.family_id, submittedAt: s.submitted_at, validUntil: s.valid_until,
      status: s.status, signerName: s.signer_name, formType: v.form_type as FormType, definition: parseDefinition(v.schema), answers,
      voidReason: s.void_reason, voidedAt: s.voided_at, signaturePath: s.signature_path, fileUrls,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Parent: "My forms"
// ---------------------------------------------------------------------------
export type ParentFormTask = {
  assignmentId: string; formId: string; formTitle: string; formType: FormType; description: string | null; athleteId: string; athleteName: string;
  status: CompletionStatus; dueDate: string | null; validUntil: string | null; submissionId: string | null; isRequired: boolean;
};

/** The guardian's athletes (in their org). */
export async function guardianAthletes(u: Me): Promise<{ id: string; name: string; familyId: string }[]> {
  const db = formsAdminDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", u.id);
  const famIds = (links ?? []).map((l) => l.family_id);
  if (!famIds.length) return [];
  const { data } = await db.from("athletes").select("id,first_name,last_name,family_id,status").eq("org_id", u.orgId).in("family_id", famIds).neq("status", "archived");
  return (data ?? []).map((a) => ({ id: a.id, name: `${a.first_name} ${a.last_name}`, familyId: a.family_id }));
}

export async function parentFormTasks(): Promise<Res<{ tasks: ParentFormTask[]; athletes: { id: string; name: string }[] }>> {
  const u = await me(["parent"]);
  if (!u) return { data: null, error: "forbidden" };
  const athletes = await guardianAthletes(u);
  if (!athletes.length) return { data: { tasks: [], athletes: [] }, error: null };
  const db = await formsDb();
  const [asg, forms] = await Promise.all([
    db.from("form_assignments").select("*").eq("org_id", u.orgId).eq("is_active", true),
    db.from("forms").select("id,title,form_type,status,description").eq("org_id", u.orgId).eq("status", "published"),
  ]);
  const formMap = new Map((forms.data ?? []).map((f) => [f.id, f]));
  const rows = (asg.data ?? []).filter((a) => formMap.has(a.form_id));
  const ids = athletes.map((a) => a.id);
  const scoped = await Promise.all(rows.map((a) => scopeAthletes(u.orgId, a, ids)));
  const { data: subs } = await db.from("form_submissions").select("id,form_id,athlete_id,submitted_at,valid_until,status").eq("org_id", u.orgId).in("athlete_id", ids);
  const latest = latestByFormAthlete(subs ?? []);
  const today = todayIso();
  const tasks: ParentFormTask[] = [];
  const seen = new Set<string>();
  rows.forEach((a, i) => {
    const f = formMap.get(a.form_id)!;
    for (const athId of scoped[i]) {
      const key = `${a.form_id}|${athId}`;
      if (seen.has(key)) continue; // one task per form and child, whichever assignment asks
      seen.add(key);
      const ath = athletes.find((x) => x.id === athId);
      if (!ath) continue;
      const l = latest.get(key) ?? null;
      tasks.push({
        assignmentId: a.id, formId: a.form_id, formTitle: f.title, formType: f.form_type as FormType, description: f.description,
        athleteId: athId, athleteName: ath.name, status: completionStatus(l, a.due_date, today), dueDate: a.due_date,
        validUntil: l?.validUntil ?? null, submissionId: l?.id ?? null, isRequired: a.is_required,
      });
    }
  });
  const order: Record<CompletionStatus, number> = { overdue: 0, expired: 1, missing: 2, expiring: 3, complete: 4 };
  tasks.sort((x, y) => order[x.status] - order[y.status] || x.athleteName.localeCompare(y.athleteName));
  return { data: { tasks, athletes: athletes.map((a) => ({ id: a.id, name: a.name })) }, error: null };
}

export type FillContext = {
  formId: string; versionId: string; version: number; title: string; description: string | null; formType: FormType;
  definition: FormDefinition; athleteId: string; athleteName: string; familyId: string; assignmentId: string | null;
};

/** The current published version for a guardian (or admin) filling a form for one athlete. */
export async function getFillContext(formId: string, athleteId: string, assignmentId: string | null): Promise<Res<FillContext | null>> {
  const u = await me(["parent", "admin"]);
  if (!u) return { data: null, error: "forbidden" };
  const db = await formsDb();
  const { data: f } = await db.from("forms").select("*").eq("id", formId).eq("org_id", u.orgId).eq("status", "published").maybeSingle();
  if (!f?.current_version_id) return { data: null, error: null };
  const { data: v } = await db.from("form_versions").select("*").eq("id", f.current_version_id).maybeSingle();
  if (!v) return { data: null, error: null };
  let athlete: { id: string; name: string; familyId: string } | null = null;
  if (u.roles.includes("admin")) {
    const { data: a } = await db.from("athletes").select("id,first_name,last_name,family_id").eq("id", athleteId).eq("org_id", u.orgId).maybeSingle();
    athlete = a ? { id: a.id, name: `${a.first_name} ${a.last_name}`, familyId: a.family_id } : null;
  }
  if (!athlete) athlete = (await guardianAthletes(u)).find((a) => a.id === athleteId) ?? null;
  if (!athlete) return { data: null, error: null };
  let asgId: string | null = null;
  if (assignmentId) {
    const { data: asg } = await db.from("form_assignments").select("id,form_id").eq("id", assignmentId).eq("org_id", u.orgId).maybeSingle();
    if (asg?.form_id === formId) asgId = asg.id;
  }
  return {
    data: {
      formId, versionId: v.id, version: v.version, title: v.title, description: f.description, formType: v.form_type as FormType,
      definition: parseDefinition(v.schema), athleteId: athlete.id, athleteName: athlete.name, familyId: athlete.familyId, assignmentId: asgId,
    },
    error: null,
  };
}

/** Coach / admin: safety answers (flagged fields) for one athlete; empty for anyone else. */
export async function getSafetyAnswers(athleteId: string): Promise<{ formTitle: string; label: string; answer: string; submittedAt: string }[]> {
  const u = await me(["admin", "coach"]);
  if (!u) return [];
  const db = await formsDb();
  const { data, error } = await db.rpc("form_safety_answers", { p_athlete: athleteId });
  if (error) {
    logError("forms.safety", error);
    return [];
  }
  return (data ?? []).map((r) => ({ formTitle: r.form_title, label: r.field_label, answer: r.answer ?? "", submittedAt: r.submitted_at }));
}
