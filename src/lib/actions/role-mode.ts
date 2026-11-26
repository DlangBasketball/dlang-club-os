"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { MODE_HOME, isAppMode, modeOfPath } from "@/lib/auth/modes";
import { isSafeNextPath } from "@/lib/auth/safe-next";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";

/**
 * Switch the signed-in person's active mode (Admin / Coach / Parent). The
 * database checks that the mode is one they really hold, stores it (kept
 * across sessions) and audits the switch; from then on has_role() follows it.
 * Returns where to go: `next` when it belongs to the new mode, else its dashboard.
 */
export async function switchMode(mode: string, next?: string | null): Promise<{ ok: true; href: string } | { ok: false; error: string }> {
  const t = await getTranslations();
  const me = await getSessionUser();
  if (!me) return { ok: false, error: t("roleMode.errors.signedOut") };
  if (!isAppMode(mode) || !me.modes.includes(mode)) return { ok: false, error: t("roleMode.errors.notAvailable") };
  const db = (await createClient()) as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }> };
  const { error } = await db.rpc("set_active_mode", { p_mode: mode });
  if (error) {
    if (/MODE_NOT_AVAILABLE/.test(error.message)) return { ok: false, error: t("roleMode.errors.notAvailable") };
    logError("roleMode.switch", error);
    return { ok: false, error: t("roleMode.errors.generic") };
  }
  revalidatePath("/", "layout");
  const href = next && isSafeNextPath(next) && modeOfPath(next) === mode ? next : MODE_HOME[mode];
  return { ok: true, href };
}
