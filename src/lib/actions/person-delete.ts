"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, type ActionResult } from "@/lib/people/server";
import { logError } from "@/lib/log";
import {
  confirmationMatches,
  errorKeyFor,
  parseImpact,
  type DeleteImpact,
  type DeleteMode,
  type PersonKind,
} from "@/lib/people/person-delete";
import { finishErase } from "@/lib/people/erase-cleanup";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";

/**
 * Remove a person everywhere (admin only; finance, coaches and parents
 * cannot delete people). The database checks the role and the club again
 * and does the whole change in one transaction; these actions add the file
 * and login clean-up after an erase and refresh every portal.
 */

const uuid = z.string().uuid();
const kindSchema = z.enum(["athlete", "family"]);
const modeSchema = z.enum(["archive", "erase"]);

type RpcClient = Awaited<ReturnType<typeof createClient>>;

async function rpc(db: RpcClient, fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> {
  const call = db.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  return call(fn, args);
}

async function displayName(db: RpcClient, kind: PersonKind, id: string, orgId: string): Promise<string | null> {
  if (kind === "athlete") {
    const { data } = await db.from("athletes").select("first_name,last_name").eq("id", id).eq("org_id", orgId).maybeSingle();
    return data ? `${data.first_name} ${data.last_name}` : null;
  }
  const { data } = await db.from("families").select("name").eq("id", id).eq("org_id", orgId).maybeSingle();
  return data?.name ?? null;
}

export async function previewPersonDelete(kind: PersonKind, id: string): Promise<ActionResult<DeleteImpact>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("personDelete.errors.forbidden") };
  if (!kindSchema.safeParse(kind).success || !uuid.safeParse(id).success) return { ok: false, error: t("personDelete.errors.notFound") };
  const db = await createClient();
  const { data, error } = await rpc(db, kind === "athlete" ? "preview_delete_athlete" : "preview_delete_family",
    kind === "athlete" ? { p_athlete: id } : { p_family: id });
  if (error) {
    logError("personDelete.preview", error);
    return { ok: false, error: t.dynamic(errorKeyFor(error.message)) };
  }
  const impact = parseImpact(data);
  if (!impact) return { ok: false, error: t("personDelete.errors.failed") };
  return { ok: true, data: impact };
}

const deleteSchema = z.object({
  kind: kindSchema,
  id: uuid,
  mode: modeSchema.default("archive"),
  confirmName: z.string().max(300).optional(),
});

async function runDelete(db: RpcClient, kind: PersonKind, id: string, mode: DeleteMode) {
  return rpc(db, kind === "athlete" ? "delete_athlete" : "delete_family",
    kind === "athlete" ? { p_athlete: id, p_mode: mode } : { p_family: id, p_mode: mode });
}

/** Archive (restorable for 30 days) or erase permanently (typed name required). */
export async function deletePerson(input: z.input<typeof deleteSchema>): Promise<ActionResult<DeleteImpact>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("personDelete.errors.forbidden") };
  const p = deleteSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("personDelete.errors.notFound") };
  const { kind, id, mode } = p.data;
  const db = await createClient();
  if (mode === "erase") {
    const name = await displayName(db, kind, id, me.orgId);
    if (!name) return { ok: false, error: t("personDelete.errors.notFound") };
    if (!confirmationMatches(p.data.confirmName ?? "", name)) return { ok: false, error: t("personDelete.errors.confirmMismatch") };
  }
  const { data, error } = await runDelete(db, kind, id, mode);
  if (error) {
    logError("personDelete.delete", error, { kind, mode });
    return { ok: false, error: t.dynamic(errorKeyFor(error.message)) };
  }
  if (mode === "erase") await finishErase(data as { files?: unknown; auth_user_ids?: unknown });
  revalidatePersonEverywhere(me.orgId);
  const impact = parseImpact(data);
  return {
    ok: true,
    message: mode === "erase" ? t("personDelete.done.erased") : t("personDelete.done.archived"),
    data: impact ?? undefined,
  };
}

const bulkSchema = z.object({
  kind: kindSchema,
  ids: z.array(uuid).min(1).max(200),
  mode: modeSchema.default("archive"),
  confirmWord: z.string().max(100).optional(),
});

/** Bulk archive / erase from a list. Erase needs the typed confirmation word. */
export async function deletePeopleBulk(input: z.input<typeof bulkSchema>): Promise<ActionResult<{ done: number; failed: number }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("personDelete.errors.forbidden") };
  const p = bulkSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("personDelete.errors.notFound") };
  const { kind, mode } = p.data;
  if (mode === "erase" && !confirmationMatches(p.data.confirmWord ?? "", t("personDelete.bulk.confirmWord"))) {
    return { ok: false, error: t("personDelete.errors.confirmMismatch") };
  }
  const db = await createClient();
  let done = 0;
  let failed = 0;
  for (const id of Array.from(new Set(p.data.ids))) {
    const { data, error } = await runDelete(db, kind, id, mode);
    if (error) {
      // Already archived people are skipped on a bulk archive.
      if (!(mode === "archive" && error.message.includes("ALREADY_DELETED"))) {
        logError("personDelete.bulk", error, { kind, mode });
        failed += 1;
      }
      continue;
    }
    if (mode === "erase") await finishErase(data as { files?: unknown; auth_user_ids?: unknown });
    done += 1;
  }
  revalidatePersonEverywhere(me.orgId);
  if (!done && failed) return { ok: false, error: t("personDelete.errors.failed") };
  return { ok: true, message: t("personDelete.bulk.done", { count: done, failed }), data: { done, failed } };
}

const guardianSchema = z.object({ familyId: uuid, profileId: uuid });

/** Unlink one guardian from a family (their login is detached when it has no other family). */
export async function removeGuardianFromFamily(input: z.input<typeof guardianSchema>): Promise<ActionResult<{ loginDetached: boolean }>> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("personDelete.errors.forbidden") };
  const p = guardianSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("personDelete.errors.notFound") };
  const db = await createClient();
  const { data, error } = await rpc(db, "remove_guardian", { p_family: p.data.familyId, p_profile: p.data.profileId });
  if (error) {
    logError("personDelete.guardian", error);
    return { ok: false, error: t.dynamic(errorKeyFor(error.message)) };
  }
  revalidatePersonEverywhere(me.orgId);
  const loginDetached = Boolean((data as { login_detached?: boolean } | null)?.login_detached);
  return { ok: true, message: loginDetached ? t("personDelete.done.guardianDetached") : t("personDelete.done.guardianRemoved"), data: { loginDetached } };
}

/** Undo delete (within 30 days): puts back status, rosters and guardian links. */
export async function restorePersonDeletion(deletionId: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("personDelete.errors.forbidden") };
  if (!uuid.safeParse(deletionId).success) return { ok: false, error: t("personDelete.errors.notFound") };
  const db = await createClient();
  const { error } = await rpc(db, "restore_person", { p_deletion: deletionId });
  if (error) {
    logError("personDelete.restore", error);
    return { ok: false, error: t.dynamic(errorKeyFor(error.message)) };
  }
  revalidatePersonEverywhere(me.orgId);
  return { ok: true, message: t("personDelete.done.restored") };
}

/** "Delete now" from Recently deleted (the person is already archived). */
export async function erasePersonDeletionNow(deletionId: string, confirmWord: string): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("personDelete.errors.forbidden") };
  if (!uuid.safeParse(deletionId).success) return { ok: false, error: t("personDelete.errors.notFound") };
  if (!confirmationMatches(confirmWord, t("personDelete.bulk.confirmWord"))) return { ok: false, error: t("personDelete.errors.confirmMismatch") };
  const db = await createClient();
  const { data, error } = await rpc(db, "erase_person_deletion", { p_deletion: deletionId });
  if (error) {
    logError("personDelete.eraseNow", error);
    return { ok: false, error: t.dynamic(errorKeyFor(error.message)) };
  }
  await finishErase(data as { files?: unknown; auth_user_ids?: unknown });
  revalidatePersonEverywhere(me.orgId);
  return { ok: true, message: t("personDelete.done.erased") };
}
