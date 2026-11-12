"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/get-user";
import { SITE_URL } from "@/lib/constants";
import { captureException } from "@/lib/observability/error-reporting";
import { logger } from "@/lib/observability/logger";
import { buildImportPlan, MAX_BYTES, type DateOrder, type ExistingData, type ImportPlan, type Issue } from "./csv";

export type ImportResult = {
  ok: boolean;
  mode: "dry-run" | "commit";
  error?: string;
  totals?: ImportPlan["totals"];
  errors: Issue[];
  warnings: Issue[];
  /** First few families, for the preview table. */
  preview?: { name: string; existing: boolean; athletes: string[]; guardians: string[] }[];
  committed?: { families: number; athletes: number; invitations: number; invitesSent: number; inviteFailures: number };
};

const ISSUE_CAP = 300;

function fail(mode: ImportResult["mode"], error: string): ImportResult {
  return { ok: false, mode, error, errors: [], warnings: [] };
}

async function readInput(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file first." } as const;
  if (file.size > MAX_BYTES) return { error: "File is larger than 1 MB. Split it into several files." } as const;
  const text = await file.text();
  const order: DateOrder = formData.get("dateOrder") === "MDY" ? "MDY" : "DMY";
  const sendInvites = formData.get("sendInvites") === "on";
  return { text, order, sendInvites } as const;
}

async function loadExisting(orgId: string): Promise<ExistingData> {
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

function summarise(plan: ImportPlan, mode: ImportResult["mode"]): ImportResult {
  return {
    ok: plan.errors.length === 0,
    mode,
    totals: plan.totals,
    errors: plan.errors.slice(0, ISSUE_CAP),
    warnings: plan.warnings.slice(0, ISSUE_CAP),
    preview: plan.families.slice(0, 25).map((f) => ({
      name: f.name,
      existing: Boolean(f.existingFamilyId),
      athletes: f.athletes.map((a) => `${a.first_name} ${a.last_name} (${a.dob})`),
      guardians: f.guardians.map((g) => `${g.email} · ${g.relation}`),
    })),
  };
}

async function gateAdmin() {
  const me = await getSessionUser();
  if (!me || !me.roles.includes("admin") || !me.orgId) return null;
  return me as typeof me & { orgId: string };
}

/** Dry run: parse + validate + compare with existing club data. Writes nothing. */
export async function previewImport(formData: FormData): Promise<ImportResult> {
  const me = await gateAdmin();
  if (!me) return fail("dry-run", "Only club admins can import data.");
  const input = await readInput(formData);
  if ("error" in input) return fail("dry-run", input.error!);
  const plan = buildImportPlan(input.text, input.order, await loadExisting(me.orgId));
  return summarise(plan, "dry-run");
}

function chunks<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Commit. Re-parses and re-validates the file server-side (the client's
 * preview is never trusted) and refuses to write anything if any row has an
 * error. Supabase JS has no multi-statement transactions, so on a failure
 * part-way the rows created by THIS run are deleted again (compensating
 * rollback; families cascade to their athletes and invitations).
 */
export async function commitImport(formData: FormData): Promise<ImportResult> {
  const me = await gateAdmin();
  if (!me) return fail("commit", "Only club admins can import data.");
  const input = await readInput(formData);
  if ("error" in input) return fail("commit", input.error!);
  const plan = buildImportPlan(input.text, input.order, await loadExisting(me.orgId));
  const result = summarise(plan, "commit");
  if (plan.errors.length > 0) {
    return { ...result, ok: false, error: "Nothing was imported: fix the errors below and upload the file again." };
  }

  const supabase = await createClient();
  const familyRows: Record<string, unknown>[] = [];
  const athleteRows: Record<string, unknown>[] = [];
  const inviteRows: Record<string, unknown>[] = [];
  for (const fam of plan.families) {
    const familyId = fam.existingFamilyId ?? crypto.randomUUID();
    if (!fam.existingFamilyId)
      familyRows.push({ id: familyId, org_id: me.orgId, name: fam.name, address: fam.address, phone: fam.phone });
    for (const a of fam.athletes)
      athleteRows.push({
        id: crypto.randomUUID(),
        org_id: me.orgId,
        family_id: familyId,
        first_name: a.first_name,
        last_name: a.last_name,
        dob: a.dob,
        gender: a.gender,
        school: a.school,
        jersey_size: a.jersey_size,
        nationality: a.nationality,
      });
    for (const g of fam.guardians)
      inviteRows.push({
        id: crypto.randomUUID(),
        org_id: me.orgId,
        email: g.email,
        role: "parent",
        family_id: familyId,
        relation: g.relation,
        invited_by: me.id,
      });
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
    // Compensating rollback, newest first.
    for (const ids of chunks(created.invitations)) await supabase.from("invitations").delete().in("id", ids);
    for (const ids of chunks(created.athletes)) await supabase.from("athletes").delete().in("id", ids);
    for (const ids of chunks(created.families)) await supabase.from("families").delete().in("id", ids);
    return {
      ...result,
      ok: false,
      error: `Import failed and was rolled back (ref ${ref}). ${err instanceof Error ? err.message : ""}`.trim(),
    };
  }

  // Optional: send the Supabase invite emails now. Off by default — clubs
  // usually announce the new system first, then send invites in one batch.
  let invitesSent = 0;
  let inviteFailures = 0;
  if (input.sendInvites && inviteRows.length > 0) {
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

  logger.info("csv import committed", {
    orgId: me.orgId,
    families: created.families.length,
    athletes: created.athletes.length,
    invitations: created.invitations.length,
    invitesSent,
    inviteFailures,
  });
  revalidatePath("/admin/families");
  revalidatePath("/admin/athletes");
  revalidatePath("/admin/invitations");
  return {
    ...result,
    ok: true,
    committed: {
      families: created.families.length,
      athletes: created.athletes.length,
      invitations: created.invitations.length,
      invitesSent,
      inviteFailures,
    },
  };
}
