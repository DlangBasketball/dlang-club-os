import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { emailTranslator } from "@/lib/email/templates";
import { logError } from "@/lib/log";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";
import { participantsAdminDb } from "./db";

/**
 * Participant profile notices through the existing dispatch (in-app row +
 * logged e-mail), each in the recipient's language. Only first names are
 * sent, never DOB, medical data or another family's details: the requester
 * of a link only ever hears back about the name they typed. Never throws.
 */
type Lang = { t: Translator; f: Formatter };

async function langFor(orgId: string, locale: string | null): Promise<Lang> {
  const org = await getOrgEmailContext(orgId, locale);
  return { t: emailTranslator(org.brand), f: org.f };
}

/** Profiles of the org (current club) with their chosen language and e-mail. */
async function recipients(orgId: string, ids: string[]): Promise<{ id: string; locale: string | null; email: string | null }[]> {
  if (!ids.length) return [];
  const { data } = await createAdminClient().from("profiles").select("id,email,locale,locale_set_at").eq("org_id", orgId).in("id", ids);
  return ((data ?? []) as { id: string; email: string | null; locale: string | null; locale_set_at: string | null }[])
    .map((p) => ({ id: p.id, locale: p.locale_set_at ? p.locale : null, email: p.email }));
}

async function send(orgId: string, ids: string[], render: (l: Lang) => { title: string; message: string }): Promise<void> {
  for (const r of await recipients(orgId, ids)) {
    const v = render(await langFor(orgId, r.locale));
    await dispatchNotification({ orgId, type: "announcement", recipientProfileId: r.id, toEmail: r.email, vars: { title: v.title, message: v.message } });
  }
}

async function familyGuardians(orgId: string, familyId: string, exclude: string | null): Promise<string[]> {
  const { data } = await createAdminClient().from("family_members").select("profile_id,families!inner(org_id)")
    .eq("family_id", familyId).eq("families.org_id", orgId);
  return Array.from(new Set(((data ?? []) as { profile_id: string | null }[]).map((r) => r.profile_id).filter((x): x is string => !!x && x !== exclude)));
}

/** A new link request: the child's existing guardians are asked to verify it in the parent app. */
export async function notifyGuardiansOfLinkRequest(orgId: string, linkRequestId: string): Promise<void> {
  try {
    const db = participantsAdminDb();
    const { data: r } = await db.from("athlete_link_requests").select("athlete_id,requester_profile_id").eq("id", linkRequestId).eq("org_id", orgId).maybeSingle();
    if (!r) return;
    const admin = createAdminClient();
    const [{ data: a }, { data: req }] = await Promise.all([
      admin.from("athletes").select("first_name,family_id").eq("id", r.athlete_id).eq("org_id", orgId).maybeSingle(),
      admin.from("profiles").select("full_name").eq("id", r.requester_profile_id).maybeSingle(),
    ]);
    const ath = a as { first_name: string; family_id: string } | null;
    if (!ath) return;
    const ids = await familyGuardians(orgId, ath.family_id, r.requester_profile_id);
    const who = (req as { full_name: string | null } | null)?.full_name ?? "";
    await send(orgId, ids, ({ t }) => ({
      title: t("participants.notify.linkRequestTitle"),
      message: t("participants.notify.linkRequestBody", { child: ath.first_name, name: who }),
    }));
  } catch (e) {
    logError("participants.notify.linkRequest", e);
  }
}

/** The decision on a link request, to the requester (only the name they typed). */
export async function notifyRequesterOfLinkDecision(orgId: string, linkRequestId: string): Promise<void> {
  try {
    const db = participantsAdminDb();
    const { data: r } = await db.from("athlete_link_requests").select("requester_profile_id,status,submitted").eq("id", linkRequestId).eq("org_id", orgId).maybeSingle();
    if (!r || (r.status !== "approved" && r.status !== "declined")) return;
    const typed = (r.submitted ?? {}) as { first_name?: string };
    await send(orgId, [r.requester_profile_id], ({ t }) => ({
      title: r.status === "approved" ? t("participants.notify.linkApprovedTitle") : t("participants.notify.linkDeclinedTitle"),
      message: r.status === "approved"
        ? t("participants.notify.linkApprovedBody", { child: typed.first_name ?? "" })
        : t("participants.notify.linkDeclinedBody", { child: typed.first_name ?? "" }),
    }));
  } catch (e) {
    logError("participants.notify.linkDecision", e);
  }
}

/** A correction needs review: in-app notice to the club's admins. */
export async function notifyAdminsOfChangeRequest(orgId: string, athleteId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: roles }, { data: a }] = await Promise.all([
      admin.from("staff_roles").select("profile_id").eq("org_id", orgId).eq("role", "admin"),
      admin.from("athletes").select("first_name,last_name").eq("id", athleteId).eq("org_id", orgId).maybeSingle(),
    ]);
    const ath = a as { first_name: string; last_name: string } | null;
    if (!ath) return;
    const ids = Array.from(new Set(((roles ?? []) as { profile_id: string }[]).map((x) => x.profile_id)));
    for (const r of await recipients(orgId, ids)) {
      const { t } = await langFor(orgId, r.locale);
      await dispatchNotification({ orgId, type: "announcement", recipientProfileId: r.id, email: false, vars: {
        title: t("participants.notify.changeRequestTitle"),
        message: t("participants.notify.changeRequestBody", { name: `${ath.first_name} ${ath.last_name}` }),
      } });
    }
  } catch (e) {
    logError("participants.notify.changeRequest", e);
  }
}

/** Staff decision on a correction: the family's guardians (declines carry the club's message). */
export async function notifyFamilyOfChangeDecision(orgId: string, changeRequestId: string): Promise<void> {
  try {
    const db = participantsAdminDb();
    const { data: r } = await db.from("athlete_change_requests").select("athlete_id,status,decision_note").eq("id", changeRequestId).eq("org_id", orgId).maybeSingle();
    if (!r || (r.status !== "approved" && r.status !== "declined")) return;
    const { data: a } = await createAdminClient().from("athletes").select("first_name,family_id").eq("id", r.athlete_id).eq("org_id", orgId).maybeSingle();
    const ath = a as { first_name: string; family_id: string } | null;
    if (!ath) return;
    const ids = await familyGuardians(orgId, ath.family_id, null);
    await send(orgId, ids, ({ t }) => {
      const lines = [r.status === "approved"
        ? t("participants.notify.changeApprovedBody", { child: ath.first_name })
        : t("participants.notify.changeDeclinedBody", { child: ath.first_name })];
      if (r.decision_note) lines.push(t("participants.notify.message", { note: r.decision_note }));
      return {
        title: r.status === "approved" ? t("participants.notify.changeApprovedTitle") : t("participants.notify.changeDeclinedTitle"),
        message: lines.join("\n\n"),
      };
    });
  } catch (e) {
    logError("participants.notify.changeDecision", e);
  }
}
