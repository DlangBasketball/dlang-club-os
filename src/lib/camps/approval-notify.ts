import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { emailTranslator } from "@/lib/email/templates";
import { getOrgAlertRecipients } from "@/lib/data/org-alert-recipients";
import { logError } from "@/lib/log";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";

/**
 * Camp age approval notices, through the existing dispatch (in-app row +
 * logged e-mail). Every text is translated in the recipient's language
 * (profile choice, else the club default). Only first names / the camp week
 * are sent; never medical data. Never throws.
 */
type Lang = { t: Translator; f: Formatter };

async function langFor(orgId: string, locale: string | null): Promise<Lang> {
  const org = await getOrgEmailContext(orgId, locale);
  return { t: emailTranslator(org.brand), f: org.f };
}

async function profileLocales(orgId: string, ids: string[]): Promise<Map<string, { locale: string | null; email: string | null }>> {
  const out = new Map<string, { locale: string | null; email: string | null }>();
  if (!ids.length) return out;
  const { data } = await createAdminClient().from("profiles").select("id,email,locale,locale_set_at").eq("org_id", orgId).in("id", ids);
  for (const p of (data ?? []) as { id: string; email: string | null; locale: string | null; locale_set_at: string | null }[]) {
    out.set(p.id, { locale: p.locale_set_at ? p.locale : null, email: p.email });
  }
  return out;
}

export type ApprovalNoticeContext = { orgId: string; programName: string; childName: string; startsOn: string; endsOn: string };

/** A new request: in-app notice to every admin of the club + e-mail to the club's alert recipients. */
export async function notifyAdminsOfRequest(ctx: ApprovalNoticeContext & { age: number | null }): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: roles } = await admin.from("staff_roles").select("profile_id").eq("org_id", ctx.orgId).eq("role", "admin");
    const ids = Array.from(new Set(((roles ?? []) as { profile_id: string }[]).map((r) => r.profile_id)));
    const locales = await profileLocales(ctx.orgId, ids);
    const render = async (locale: string | null) => {
      const { t, f } = await langFor(ctx.orgId, locale);
      return {
        title: t("camps.approval.notify.adminTitle"),
        message: t("camps.approval.notify.adminBody", {
          child: ctx.childName, age: ctx.age ?? "–", camp: ctx.programName, dates: f.dateRange(ctx.startsOn, ctx.endsOn),
        }),
      };
    };
    for (const id of ids) {
      if (!locales.has(id)) continue; // same org only
      const v = await render(locales.get(id)?.locale ?? null);
      await dispatchNotification({ orgId: ctx.orgId, type: "announcement", recipientProfileId: id, email: false, vars: { title: v.title, message: v.message } });
    }
    const v = await render(null);
    for (const to of await getOrgAlertRecipients(ctx.orgId)) {
      await dispatchNotification({ orgId: ctx.orgId, type: "announcement", recipientProfileId: null, toEmail: to, vars: { title: v.title, message: v.message } });
    }
  } catch (e) {
    logError("camp.approval.notifyAdmins", e);
  }
}

/** The decision: every guardian of the family with a login (in-app + e-mail), else the family contact e-mail. */
export async function notifyFamilyOfDecision(ctx: ApprovalNoticeContext & {
  familyId: string; decision: "approved" | "confirmed" | "declined"; note: string | null; invoiceNumber: string | null; amount: number | null; currency: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: links } = await admin.from("family_members").select("profile_id").eq("family_id", ctx.familyId);
    const ids = Array.from(new Set(((links ?? []) as { profile_id: string | null }[]).map((l) => l.profile_id).filter((x): x is string => !!x)));
    const locales = await profileLocales(ctx.orgId, ids);
    const render = async (locale: string | null) => {
      const { t, f } = await langFor(ctx.orgId, locale);
      const values = { child: ctx.childName, camp: ctx.programName, dates: f.dateRange(ctx.startsOn, ctx.endsOn) };
      const lines = [
        ctx.decision === "declined" ? t("camps.approval.notify.declinedBody", values)
          : ctx.decision === "confirmed" ? t("camps.approval.notify.confirmedBody", values)
          : t("camps.approval.notify.approvedBody", {
              ...values, invoice: ctx.invoiceNumber ?? "", amount: ctx.amount !== null && ctx.currency ? f.money(ctx.amount, ctx.currency) : "",
            }),
      ];
      if (ctx.note) lines.push(t("camps.approval.notify.message", { note: ctx.note }));
      return {
        title: ctx.decision === "declined" ? t("camps.approval.notify.declinedTitle") : t("camps.approval.notify.approvedTitle"),
        message: lines.join("\n\n"),
      };
    };
    const reachable = ids.filter((id) => locales.has(id));
    for (const id of reachable) {
      const p = locales.get(id)!;
      const v = await render(p.locale);
      await dispatchNotification({ orgId: ctx.orgId, type: "announcement", recipientProfileId: id, toEmail: p.email, vars: { title: v.title, message: v.message } });
    }
    if (!reachable.length) {
      const { data: fam } = await admin.from("families").select("contact_email").eq("id", ctx.familyId).eq("org_id", ctx.orgId).maybeSingle();
      const to = (fam as { contact_email: string | null } | null)?.contact_email ?? null;
      if (to) {
        const v = await render(null);
        await dispatchNotification({ orgId: ctx.orgId, type: "announcement", recipientProfileId: null, toEmail: to, vars: { title: v.title, message: v.message } });
      }
    }
  } catch (e) {
    logError("camp.approval.notifyFamily", e);
  }
}
