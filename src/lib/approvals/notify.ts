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
 * Club approval notices through the existing dispatch (in-app row + logged
 * e-mail), each in the recipient's language (profile choice, else the club
 * default). Only the child's first name and the programme / membership name
 * are sent; never medical or contact data. Never throws.
 */
type Lang = { t: Translator; f: Formatter };

async function langFor(orgId: string, locale: string | null): Promise<Lang> {
  const org = await getOrgEmailContext(orgId, locale);
  return { t: emailTranslator(org.brand), f: org.f };
}

type Profile = { locale: string | null; email: string | null; staff: Set<string> };

async function profiles(orgId: string, ids: string[]): Promise<Map<string, Profile>> {
  const out = new Map<string, Profile>();
  if (!ids.length) return out;
  const admin = createAdminClient();
  const [{ data }, { data: roles }] = await Promise.all([
    admin.from("profiles").select("id,email,locale,locale_set_at").eq("org_id", orgId).in("id", ids),
    admin.from("staff_roles").select("profile_id,role").eq("org_id", orgId).in("profile_id", ids),
  ]);
  const roleMap = new Map<string, Set<string>>();
  for (const r of (roles ?? []) as { profile_id: string; role: string }[]) {
    if (!roleMap.has(r.profile_id)) roleMap.set(r.profile_id, new Set());
    roleMap.get(r.profile_id)!.add(r.role);
  }
  for (const p of (data ?? []) as { id: string; email: string | null; locale: string | null; locale_set_at: string | null }[]) {
    out.set(p.id, { locale: p.locale_set_at ? p.locale : null, email: p.email, staff: roleMap.get(p.id) ?? new Set() });
  }
  return out;
}

export type ReviewerNotice = {
  orgId: string;
  /** Recipients computed by the database (assigned coaches, else admins). */
  profileIds: string[];
  event: "submitted" | "replied";
  childName: string;
  subjectName: string;
  kind: "membership" | "program_registration";
};

/**
 * New / answered request: in-app notice to each reviewer. Coaches also get
 * the e-mail; admins get it through the club's alert addresses (as camp
 * approvals do).
 */
export async function notifyReviewers(n: ReviewerNotice): Promise<void> {
  try {
    const ids = Array.from(new Set(n.profileIds));
    const people = await profiles(n.orgId, ids);
    const render = async (locale: string | null) => {
      const { t } = await langFor(n.orgId, locale);
      const values = { child: n.childName, subject: n.subjectName };
      return {
        title: n.event === "replied" ? t("approvals.notify.repliedTitle") : t("approvals.notify.submittedTitle"),
        message: n.event === "replied"
          ? t("approvals.notify.repliedBody", values)
          : t(n.kind === "membership" ? "approvals.notify.submittedMembershipBody" : "approvals.notify.submittedProgramBody", values),
      };
    };
    let adminRecipient = false;
    for (const id of ids) {
      const p = people.get(id);
      if (!p) continue; // same org only
      const isAdmin = p.staff.has("admin");
      adminRecipient ||= isAdmin;
      const v = await render(p.locale);
      await dispatchNotification({
        orgId: n.orgId, type: "announcement", recipientProfileId: id,
        toEmail: isAdmin ? null : p.email, email: !isAdmin, vars: { title: v.title, message: v.message },
      });
    }
    if (adminRecipient) {
      const v = await render(null);
      for (const to of await getOrgAlertRecipients(n.orgId)) {
        await dispatchNotification({ orgId: n.orgId, type: "announcement", recipientProfileId: null, toEmail: to, vars: { title: v.title, message: v.message } });
      }
    }
  } catch (e) {
    logError("approvals.notifyReviewers", e);
  }
}

export type FamilyNotice = {
  orgId: string;
  familyId: string;
  event: "info_requested" | "approved" | "confirmed" | "declined";
  childName: string;
  subjectName: string;
  message: string | null;
  invoiceNumber: string | null;
  amount: number | null;
  currency: string | null;
};

/** The decision / information request: every guardian with a login (in-app + e-mail), else the family contact e-mail. */
export async function notifyFamily(n: FamilyNotice): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: links } = await admin.from("family_members").select("profile_id").eq("family_id", n.familyId);
    const ids = Array.from(new Set(((links ?? []) as { profile_id: string | null }[]).map((l) => l.profile_id).filter((x): x is string => !!x)));
    const people = await profiles(n.orgId, ids);
    const render = async (locale: string | null) => {
      const { t, f } = await langFor(n.orgId, locale);
      const values = { child: n.childName, subject: n.subjectName };
      const lines = [
        n.event === "declined" ? t("approvals.notify.declinedBody", values)
          : n.event === "info_requested" ? t("approvals.notify.infoRequestedBody", values)
          : n.event === "confirmed" ? t("approvals.notify.confirmedBody", values)
          : t("approvals.notify.approvedBody", {
              ...values, invoice: n.invoiceNumber ?? "", amount: n.amount !== null && n.currency ? f.money(n.amount, n.currency) : "",
            }),
      ];
      if (n.message) lines.push(t("approvals.notify.message", { note: n.message }));
      const title = n.event === "declined" ? t("approvals.notify.declinedTitle")
        : n.event === "info_requested" ? t("approvals.notify.infoRequestedTitle")
        : t("approvals.notify.approvedTitle");
      return { title, message: lines.join("\n\n") };
    };
    const reachable = ids.filter((id) => people.has(id));
    for (const id of reachable) {
      const p = people.get(id)!;
      const v = await render(p.locale);
      await dispatchNotification({ orgId: n.orgId, type: "announcement", recipientProfileId: id, toEmail: p.email, vars: { title: v.title, message: v.message } });
    }
    if (!reachable.length) {
      const { data: fam } = await admin.from("families").select("contact_email").eq("id", n.familyId).eq("org_id", n.orgId).maybeSingle();
      const to = (fam as { contact_email: string | null } | null)?.contact_email ?? null;
      if (to) {
        const v = await render(null);
        await dispatchNotification({ orgId: n.orgId, type: "announcement", recipientProfileId: null, toEmail: to, vars: { title: v.title, message: v.message } });
      }
    }
  } catch (e) {
    logError("approvals.notifyFamily", e);
  }
}
