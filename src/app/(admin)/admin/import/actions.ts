"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translator";
import { SITE_URL } from "@/lib/constants";
import { captureException } from "@/lib/observability/error-reporting";
import { logger } from "@/lib/observability/logger";
import { writeAudit } from "@/lib/people/server";
import {
  buildImportPlanFromTable, MAX_BYTES, parseCsv, TEMPLATE_COLUMNS, type DateOrder, type ExistingData, type ImportPlan, type Issue,
} from "@/lib/import/families";
import { buildRegistrationPlan, programmeIndex, REGISTRATION_ALIASES, REGISTRATION_COLUMNS, type RegistrationExisting, type RegistrationPlan } from "@/lib/import/registrations";
import { applyMapping, checkMapping, suggestMapping } from "@/lib/import/mapping";
import { looksLikeXlsx, parseXlsx, XLSX_MAX_BYTES } from "@/lib/import/xlsx";

/**
 * Spreadsheet import (CSV or .xlsx): families & athletes, or existing
 * registrations. Admin only; the org comes from the session. Every step
 * re-reads and re-validates the file server-side (the browser's preview and
 * column mapping are never trusted as-is).
 */
export type ImportKind = "families" | "registrations";
export type ShownIssue = { row: number; field?: string; message: string };

export type ImportResult = {
  ok: boolean;
  mode: "dry-run" | "commit";
  kind: ImportKind;
  error?: string;
  /** Totals by key (labels: forms.import.totals.<key>). */
  totals?: Record<string, number>;
  errors: ShownIssue[];
  warnings: ShownIssue[];
  /** First few families / registrations, for the preview table. */
  preview?: { title: string; badge?: string; lines: string[] }[];
  committed?: Record<string, number>;
};

export type InspectResult =
  | { ok: true; kind: ImportKind; headers: string[]; mapping: string[]; targets: string[]; sample: string[][]; rows: number; format: "csv" | "xlsx" }
  | { ok: false; error: string };

const ISSUE_CAP = 300;
const TARGETS: Record<ImportKind, readonly string[]> = { families: TEMPLATE_COLUMNS, registrations: REGISTRATION_COLUMNS };
const ALIASES: Record<ImportKind, Record<string, string>> = { families: {}, registrations: REGISTRATION_ALIASES };

async function gateAdmin() {
  const me = await getSessionUser();
  if (!me || !me.roles.includes("admin") || !me.orgId) return null;
  return me as typeof me & { orgId: string };
}

const kindOf = (fd: FormData): ImportKind => (fd.get("kind") === "registrations" ? "registrations" : "families");

/** File -> table (CSV text or .xlsx workbook). Returns an i18n key on failure. */
async function readTable(fd: FormData): Promise<{ table: string[][]; format: "csv" | "xlsx" } | { errorKey: string; values?: Record<string, string | number> }> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { errorKey: "forms.import.errors.noFile" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (looksLikeXlsx(bytes) || /\.xlsx$/i.test(file.name)) {
    if (file.size > XLSX_MAX_BYTES) return { errorKey: "forms.import.errors.tooLarge", values: { mb: XLSX_MAX_BYTES / 1_000_000 } };
    try {
      return { table: await parseXlsx(bytes), format: "xlsx" };
    } catch {
      return { errorKey: "forms.import.errors.unreadableXlsx" };
    }
  }
  if (/\.xls$/i.test(file.name)) return { errorKey: "forms.import.errors.oldExcel" };
  if (file.size > MAX_BYTES) return { errorKey: "forms.import.errors.tooLarge", values: { mb: MAX_BYTES / 1_000_000 } };
  return { table: parseCsv(new TextDecoder("utf-8").decode(bytes)), format: "csv" };
}

/** Apply the admin's column mapping (validated) or the suggested one. */
function mapped(table: string[][], kind: ImportKind, rawMapping: FormDataEntryValue | null): string[][] | { errorKey: string } {
  if (!table.length) return table;
  const headers = table[0];
  let mapping = suggestMapping(headers, TARGETS[kind], ALIASES[kind]);
  if (typeof rawMapping === "string" && rawMapping) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMapping);
    } catch {
      return { errorKey: "forms.import.errors.mappingInvalid" };
    }
    const c = checkMapping(parsed, headers.length, TARGETS[kind]);
    if (!c.ok) return { errorKey: `forms.import.errors.${c.key}` };
    mapping = c.mapping;
  }
  return applyMapping(table, mapping);
}

/** Step 1: read the file and propose a column mapping (writes nothing). */
export async function inspectImport(fd: FormData): Promise<InspectResult> {
  const t = await getTranslations();
  const me = await gateAdmin();
  if (!me) return { ok: false, error: t("forms.import.errors.adminOnly") };
  const kind = kindOf(fd);
  const r = await readTable(fd);
  if ("errorKey" in r) return { ok: false, error: t.dynamic(r.errorKey, r.values) };
  if (r.table.length < 2) return { ok: false, error: t("forms.import.issues.noRows") };
  const headers = r.table[0].map((h, i) => h || `#${i + 1}`);
  return {
    ok: true, kind, headers, format: r.format, targets: [...TARGETS[kind]], rows: r.table.length - 1,
    mapping: suggestMapping(headers, TARGETS[kind], ALIASES[kind]), sample: r.table.slice(1, 6),
  };
}

async function loadFamilyExisting(orgId: string): Promise<ExistingData> {
  const supabase = await createClient();
  const [fams, aths, invs, profs] = await Promise.all([
    supabase.from("families").select("id, name").eq("org_id", orgId),
    supabase.from("athletes").select("first_name, last_name, dob").eq("org_id", orgId),
    supabase.from("invitations").select("email").eq("org_id", orgId).eq("status", "pending"),
    supabase.from("profiles").select("email").eq("org_id", orgId),
  ]);
  const familiesByName = new Map<string, string[]>();
  for (const f of (fams.data ?? []) as { id: string; name: string }[]) {
    const k = f.name.trim().toLowerCase();
    familiesByName.set(k, [...(familiesByName.get(k) ?? []), f.id]);
  }
  const athleteKeys = new Set<string>(
    ((aths.data ?? []) as { first_name: string; last_name: string; dob: string }[]).map(
      (a) => `${a.first_name.trim().toLowerCase()}|${a.last_name.trim().toLowerCase()}|${a.dob}`,
    ),
  );
  const knownEmails = new Set<string>();
  for (const r of [...((invs.data ?? []) as { email: string }[]), ...((profs.data ?? []) as { email: string }[])])
    if (r.email) knownEmails.add(r.email.toLowerCase());
  return { familiesByName, athleteKeys, knownEmails };
}

async function loadRegistrationExisting(orgId: string): Promise<RegistrationExisting> {
  const supabase = await createClient();
  const [aths, progs, regs] = await Promise.all([
    supabase.from("athletes").select("id, first_name, last_name, dob").eq("org_id", orgId),
    supabase.from("programs").select("id, slug, name").eq("org_id", orgId),
    supabase.from("registrations").select("athlete_id, program_id").eq("org_id", orgId),
  ]);
  const athletes = new Map<string, string>();
  for (const a of (aths.data ?? []) as { id: string; first_name: string; last_name: string; dob: string }[])
    athletes.set(`${a.first_name.trim().toLowerCase()}|${a.last_name.trim().toLowerCase()}|${a.dob}`, a.id);
  return {
    athletes,
    programmes: programmeIndex((progs.data ?? []) as { id: string; slug: string | null; name: string }[]),
    registrations: new Set(((regs.data ?? []) as { athlete_id: string; program_id: string }[]).map((r) => `${r.athlete_id}|${r.program_id}`)),
  };
}

const show = (t: Translator, issues: Issue[]): ShownIssue[] =>
  issues.slice(0, ISSUE_CAP).map((i) => ({ row: i.row, field: i.field, message: t.dynamic(`forms.import.issues.${i.key}`, i.values, i.key) }));

function familySummary(t: Translator, plan: ImportPlan, mode: ImportResult["mode"]): ImportResult {
  return {
    ok: plan.errors.length === 0, mode, kind: "families", totals: plan.totals, errors: show(t, plan.errors), warnings: show(t, plan.warnings),
    preview: plan.families.slice(0, 25).map((f) => ({
      title: f.name,
      badge: f.existingFamilyId ? t("forms.import.existingFamily") : undefined,
      lines: [
        f.athletes.map((a) => `${a.first_name} ${a.last_name} (${a.dob})`).join(" · ") || t("forms.import.noNewAthletes"),
        ...(f.guardians.length ? [t("forms.import.invite", { emails: f.guardians.map((g) => `${g.email} · ${g.relation}`).join(", ") })] : []),
      ],
    })),
  };
}

function registrationSummary(t: Translator, plan: RegistrationPlan, mode: ImportResult["mode"], names: { athletes: Map<string, string>; programmes: Map<string, string> }): ImportResult {
  return {
    ok: plan.errors.length === 0, mode, kind: "registrations", totals: plan.totals, errors: show(t, plan.errors), warnings: show(t, plan.warnings),
    preview: plan.rows.slice(0, 25).map((r) => ({
      title: names.athletes.get(r.athleteId) ?? "",
      badge: t.dynamic(`status.${r.status}`, undefined, r.status),
      lines: [names.programmes.get(r.programId) ?? ""],
    })),
  };
}

async function namesFor(orgId: string, plan: RegistrationPlan) {
  const supabase = await createClient();
  const aIds = Array.from(new Set(plan.rows.slice(0, 25).map((r) => r.athleteId)));
  const pIds = Array.from(new Set(plan.rows.slice(0, 25).map((r) => r.programId)));
  const [a, p] = await Promise.all([
    aIds.length ? supabase.from("athletes").select("id,first_name,last_name").eq("org_id", orgId).in("id", aIds) : Promise.resolve({ data: [] }),
    pIds.length ? supabase.from("programs").select("id,name").eq("org_id", orgId).in("id", pIds) : Promise.resolve({ data: [] }),
  ]);
  return {
    athletes: new Map(((a.data ?? []) as { id: string; first_name: string; last_name: string }[]).map((x) => [x.id, `${x.first_name} ${x.last_name}`])),
    programmes: new Map(((p.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])),
  };
}

async function plan(fd: FormData, orgId: string, t: Translator) {
  const kind = kindOf(fd);
  const order: DateOrder = fd.get("dateOrder") === "MDY" ? "MDY" : "DMY";
  const r = await readTable(fd);
  if ("errorKey" in r) return { error: t.dynamic(r.errorKey, r.values), kind } as const;
  const table = mapped(r.table, kind, fd.get("mapping"));
  if ("errorKey" in table) return { error: t.dynamic(table.errorKey), kind } as const;
  if (kind === "registrations") {
    const p = buildRegistrationPlan(table, order, await loadRegistrationExisting(orgId));
    return { kind, registrations: p } as const;
  }
  return { kind, families: buildImportPlanFromTable(table, order, await loadFamilyExisting(orgId)) } as const;
}

const failed = (mode: ImportResult["mode"], kind: ImportKind, error: string): ImportResult => ({ ok: false, mode, kind, error, errors: [], warnings: [] });

/** Dry run: parse + validate + compare with existing club data. Writes nothing. */
export async function previewImport(fd: FormData): Promise<ImportResult> {
  const t = await getTranslations();
  const me = await gateAdmin();
  if (!me) return failed("dry-run", kindOf(fd), t("forms.import.errors.adminOnly"));
  const p = await plan(fd, me.orgId, t);
  if ("error" in p) return failed("dry-run", p.kind, p.error ?? "");
  if (p.kind === "registrations") return registrationSummary(t, p.registrations, "dry-run", await namesFor(me.orgId, p.registrations));
  return familySummary(t, p.families, "dry-run");
}

function chunks<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Commit. Re-parses and re-validates the file server-side and refuses to
 * write anything if any row has an error. Supabase JS has no multi-statement
 * transactions, so on a failure part-way the rows created by THIS run are
 * deleted again (compensating rollback).
 */
export async function commitImport(fd: FormData): Promise<ImportResult> {
  const t = await getTranslations();
  const me = await gateAdmin();
  if (!me) return failed("commit", kindOf(fd), t("forms.import.errors.adminOnly"));
  const p = await plan(fd, me.orgId, t);
  if ("error" in p) return failed("commit", p.kind, p.error ?? "");
  if (p.kind === "registrations") return commitRegistrations(me, t, p.registrations);
  return commitFamilies(me, t, p.families, fd.get("sendInvites") === "on");
}

type Admin = { id: string; orgId: string };

async function commitRegistrations(me: Admin, t: Translator, plan: RegistrationPlan): Promise<ImportResult> {
  const result = registrationSummary(t, plan, "commit", await namesFor(me.orgId, plan));
  if (plan.errors.length > 0) return { ...result, ok: false, error: t("forms.import.errors.fixFirst") };
  const supabase = await createClient();
  const rows = plan.rows.map((r) => ({
    id: crypto.randomUUID(), org_id: me.orgId, athlete_id: r.athleteId, program_id: r.programId, status: r.status, notes: r.notes,
    registered_by: me.id, ...(r.registeredOn ? { created_at: `${r.registeredOn}T12:00:00Z` } : {}),
  }));
  const created: string[] = [];
  try {
    for (const c of chunks(rows)) {
      const { error } = await supabase.from("registrations").insert(c as never);
      if (error) throw new Error(`registrations: ${error.message}`);
      created.push(...c.map((r) => r.id));
    }
  } catch (err) {
    const ref = captureException(err, { context: "import.registrations", orgId: me.orgId, userId: me.id });
    for (const ids of chunks(created)) await supabase.from("registrations").delete().in("id", ids);
    return { ...result, ok: false, error: t("forms.import.errors.rolledBack", { ref }) };
  }
  await writeAudit(me, "import.registrations", "registrations", null, { rows: created.length });
  logger.info("registrations import committed", { orgId: me.orgId, registrations: created.length });
  revalidatePath("/admin/registrations");
  return { ...result, ok: true, committed: { registrations: created.length } };
}

async function commitFamilies(me: Admin, t: Translator, plan: ImportPlan, sendInvites: boolean): Promise<ImportResult> {
  const result = familySummary(t, plan, "commit");
  if (plan.errors.length > 0) return { ...result, ok: false, error: t("forms.import.errors.fixFirst") };

  const supabase = await createClient();
  const familyRows: Record<string, unknown>[] = [];
  const athleteRows: Record<string, unknown>[] = [];
  const inviteRows: Record<string, unknown>[] = [];
  for (const fam of plan.families) {
    const familyId = fam.existingFamilyId ?? crypto.randomUUID();
    if (!fam.existingFamilyId) familyRows.push({ id: familyId, org_id: me.orgId, name: fam.name, address: fam.address, phone: fam.phone });
    for (const a of fam.athletes)
      athleteRows.push({
        id: crypto.randomUUID(), org_id: me.orgId, family_id: familyId, first_name: a.first_name, last_name: a.last_name, dob: a.dob,
        gender: a.gender, school: a.school, jersey_size: a.jersey_size, nationality: a.nationality,
      });
    for (const g of fam.guardians)
      inviteRows.push({ id: crypto.randomUUID(), org_id: me.orgId, email: g.email, role: "parent", family_id: familyId, relation: g.relation, invited_by: me.id });
  }

  const created = { families: [] as string[], athletes: [] as string[], invitations: [] as string[] };
  try {
    for (const c of chunks(familyRows)) {
      const { error } = await supabase.from("families").insert(c as never);
      if (error) throw new Error(`families: ${error.message}`);
      created.families.push(...c.map((r) => r.id as string));
    }
    for (const c of chunks(athleteRows)) {
      const { error } = await supabase.from("athletes").insert(c as never);
      if (error) throw new Error(`athletes: ${error.message}`);
      created.athletes.push(...c.map((r) => r.id as string));
    }
    for (const c of chunks(inviteRows)) {
      const { error } = await supabase.from("invitations").insert(c as never);
      if (error) throw new Error(`invitations: ${error.message}`);
      created.invitations.push(...c.map((r) => r.id as string));
    }
  } catch (err) {
    const ref = captureException(err, { context: "import.commit", orgId: me.orgId, userId: me.id });
    for (const ids of chunks(created.invitations)) await supabase.from("invitations").delete().in("id", ids);
    for (const ids of chunks(created.athletes)) await supabase.from("athletes").delete().in("id", ids);
    for (const ids of chunks(created.families)) await supabase.from("families").delete().in("id", ids);
    return { ...result, ok: false, error: t("forms.import.errors.rolledBack", { ref }) };
  }

  // Optional: send the invite emails now. Off by default — clubs usually
  // announce the new system first, then send invites in one batch.
  let invitesSent = 0;
  let inviteFailures = 0;
  if (sendInvites && inviteRows.length > 0) {
    const admin = createAdminClient();
    for (const inv of inviteRows) {
      const { error } = await admin.auth.admin.inviteUserByEmail(inv.email as string, {
        redirectTo: `${SITE_URL}/auth/callback?next=/onboarding`,
        data: { invited_role: "parent" },
      });
      if (error) inviteFailures++;
      else invitesSent++;
    }
  }

  await writeAudit(me, "import.families", "families", null, {
    families: created.families.length, athletes: created.athletes.length, invitations: created.invitations.length,
  });
  logger.info("spreadsheet import committed", {
    orgId: me.orgId, families: created.families.length, athletes: created.athletes.length, invitations: created.invitations.length, invitesSent, inviteFailures,
  });
  revalidatePath("/admin/families");
  revalidatePath("/admin/athletes");
  revalidatePath("/admin/invitations");
  return {
    ...result,
    ok: true,
    committed: {
      families: created.families.length, athletes: created.athletes.length, invitations: created.invitations.length, invitesSent, inviteFailures,
    },
  };
}
