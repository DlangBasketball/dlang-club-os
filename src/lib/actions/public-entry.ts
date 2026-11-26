"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import { getTenant } from "@/lib/tenant/server";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";
import type { Json } from "@/types/database";
import { entryAdminDb, entryDb } from "@/lib/public-entry/db";
import { consentErrorCode, intentDestination, parseIntent, safeNext, safeSlug } from "@/lib/public-entry/shared";
import { hashConsentToken, isConsentToken } from "@/lib/public-entry/token";
import { notifyConsentOutcome } from "@/lib/public-entry/notify";

/*
 * Public entry + guardian consent — server actions
 * (migration 20250420105900_public_entry_guardian_consent.sql). The club is
 * resolved on the server from the request host (or the public slug of the
 * page the visitor came from), never from a client org id; every RPC checks
 * the caller again.
 */
export type EntryResult = { ok: true; message?: string } | { ok: false; code: string; error: string };

async function clubSlug(hint: string | null): Promise<string | null> {
  const tenant = await getTenant();
  return tenant.id ? tenant.slug : safeSlug(hint);
}

/**
 * Bootstrap the signed-in adult as a customer of the club (guest family, no
 * invitation, team or membership needed), switch the current club to it,
 * finish onboarding and continue to the chosen activity.
 */
export async function bootstrapAndContinue(intentRaw: string, nextRaw: string | null, clubHint: string | null): Promise<EntryResult> {
  const t = await getTranslations();
  const me = await getSessionUser();
  if (!me) return { ok: false, code: "NOT_AUTHENTICATED", error: t("entry.errors.NOT_AUTHENTICATED") };
  const slug = await clubSlug(clubHint);
  if (!slug) return { ok: false, code: "CLUB_NOT_FOUND", error: t("entry.errors.CLUB_NOT_FOUND") };
  const db = await entryDb();
  const { data, error } = await db.rpc("family_bootstrap", { p_org_slug: slug });
  if (error) {
    const code = consentErrorCode(error.message) ?? "GENERIC";
    if (code === "GENERIC") logError("publicEntry.bootstrap", error);
    return { ok: false, code, error: t.dynamic(`entry.errors.${code}`, undefined, t("entry.errors.generic")) };
  }
  const r = (data ?? {}) as { org_id?: string; is_current?: boolean; guest?: boolean };
  if (r.org_id && !r.is_current) {
    const { error: sw } = await db.rpc("switch_current_org", { p_org: r.org_id });
    if (sw) logError("publicEntry.switch", sw);
  }
  // A guest family: the name was given at sign-up, nothing else to onboard (invited families keep their onboarding).
  if (r.guest) await db.from("profiles").update({ onboarding_completed_at: new Date().toISOString() } as never)
    .eq("id", me.id).is("onboarding_completed_at", null);
  revalidatePersonEverywhere(r.org_id ?? null);
  revalidatePath("/", "layout");
  const intent = parseIntent(intentRaw);
  redirect(safeNext(nextRaw) ?? intentDestination(intent));
}

// ---------------------------------------------------------------------------
// Guardian consent (the e-mailed link)
// ---------------------------------------------------------------------------
const keysSchema = z.array(z.string().trim().min(1).max(80)).max(50);

/** Accept as the signed-in guardian (e-mail ownership / existing guardian checked in SQL). */
export async function acceptGuardianConsent(token: string, acceptedKeys: string[]): Promise<EntryResult> {
  const t = await getTranslations();
  if (!isConsentToken(token)) return { ok: false, code: "NOT_FOUND", error: t("consentRequest.errors.NOT_FOUND") };
  const keys = keysSchema.safeParse(acceptedKeys);
  if (!keys.success) return { ok: false, code: "CONSENT_REQUIRED", error: t("consentRequest.errors.CONSENT_REQUIRED") };
  const me = await getSessionUser();
  if (!me) return { ok: false, code: "NOT_AUTHENTICATED", error: t("consentRequest.errors.NOT_AUTHENTICATED") };
  const db = await entryDb();
  const { data, error } = await db.rpc("guardian_consent_accept", {
    p_token_hash: hashConsentToken(token), p_payload: { accepted_keys: keys.data } as Json,
  });
  if (error) {
    const code = consentErrorCode(error.message) ?? "GENERIC";
    if (code === "GENERIC") logError("publicEntry.consentAccept", error);
    return { ok: false, code, error: t.dynamic(`consentRequest.errors.${code}`, undefined, t("consentRequest.errors.generic")) };
  }
  const r = (data ?? {}) as { org_id?: string; request_id?: string; is_current_org?: boolean; replayed?: boolean };
  // The guardian came for this club: it becomes their current club.
  if (r.org_id && !r.is_current_org) {
    const { error: sw } = await db.rpc("switch_current_org", { p_org: r.org_id });
    if (sw) logError("publicEntry.consentSwitch", sw);
  }
  if (r.org_id && r.request_id && !r.replayed) await notifyConsentOutcome(r.org_id, r.request_id);
  revalidatePersonEverywhere(r.org_id ?? null);
  revalidatePath("/", "layout");
  return { ok: true, message: t("consentRequest.page.accepted") };
}

/** Decline (no account needed: the e-mailed link is the credential). Frees the held places. */
export async function declineGuardianConsent(token: string): Promise<EntryResult> {
  const t = await getTranslations();
  if (!isConsentToken(token)) return { ok: false, code: "NOT_FOUND", error: t("consentRequest.errors.NOT_FOUND") };
  // Signed in: as the user (the RPC refuses the booker). Signed out: the
  // service role after hashing the token (anon has no EXECUTE on the RPC).
  const db = (await getSessionUser()) ? await entryDb() : entryAdminDb();
  const { data, error } = await db.rpc("guardian_consent_decline", { p_token_hash: hashConsentToken(token) });
  if (error) {
    const code = consentErrorCode(error.message) ?? "GENERIC";
    if (code === "GENERIC") logError("publicEntry.consentDecline", error);
    return { ok: false, code, error: t.dynamic(`consentRequest.errors.${code}`, undefined, t("consentRequest.errors.generic")) };
  }
  const r = (data ?? {}) as { org_id?: string; request_id?: string; replayed?: boolean };
  if (r.org_id && r.request_id && !r.replayed) await notifyConsentOutcome(r.org_id, r.request_id);
  return { ok: true, message: t("consentRequest.page.declined") };
}

/** The booker withdraws a pending request (frees the held places). */
export async function revokeConsentRequest(requestId: string): Promise<EntryResult> {
  const t = await getTranslations();
  if (!z.string().uuid().safeParse(requestId).success) return { ok: false, code: "NOT_FOUND", error: t("consentRequest.errors.NOT_FOUND") };
  const db = await entryDb();
  const { error } = await db.rpc("guardian_consent_revoke", { p_request: requestId });
  if (error) {
    const code = consentErrorCode(error.message) ?? "GENERIC";
    if (code === "GENERIC") logError("publicEntry.revoke", error);
    return { ok: false, code, error: t.dynamic(`consentRequest.errors.${code}`, undefined, t("consentRequest.errors.generic")) };
  }
  revalidatePath("/parent/bookings/others");
  return { ok: true, message: t("consentRequest.others.withdrawn") };
}
