import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { campsAdminDb } from "./db";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { getOrgAlertRecipients } from "@/lib/data/org-alert-recipients";
import { sendEmail } from "@/lib/email/resend";
import { adminRegistrationAlert, registrationConfirmation } from "@/lib/email/templates";
import { logError } from "@/lib/log";

/**
 * Shared by the single-week camp registration and the multi-week camp basket
 * (src/lib/actions/camp-registration.ts, src/lib/actions/camp-basket.ts).
 */

export type GuestAccountChoice = { mode: "none" | "password" | "link"; password?: string };

async function siteBase(orgId: string): Promise<string> {
  const org = await getOrgEmailContext(orgId);
  return org.link("/");
}

/**
 * Guest account for a non-member family: the parent chose a password or a
 * sign-in link. The registration RPC already created the pending parent
 * invitation for THIS club and family, so the new login is linked to them
 * by handle_new_user() — never to a club named by the client.
 */
export async function createGuestAccount(orgId: string, email: string, name: string, account: GuestAccountChoice, locale: string): Promise<void> {
  if (account.mode === "none") return;
  const base = (await siteBase(orgId)).replace(/\/$/, "");
  const redirectTo = `${base}/auth/callback?next=/parent/home`;
  try {
    if (account.mode === "password" && account.password) {
      const anon = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      // Sends the email-confirmation message; an existing account is left untouched.
      const { error } = await anon.auth.signUp({ email, password: account.password, options: { emailRedirectTo: redirectTo, data: { full_name: name, locale } } });
      if (error) logError("camp.guestSignup", error);
    } else {
      const admin = campsAdminDb();
      const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { invited_role: "parent", full_name: name, locale } });
      if (error && !/already/i.test(error.message)) logError("camp.guestInvite", error);
    }
  } catch (e) {
    logError("camp.guestAccount", e);
  }
}

/** Confirmation to the parent (when an address is known) + alert to the club's recipients. Never throws. */
export async function notifyCampRegistration(orgId: string, programName: string, parentName: string, parentEmail: string | null, children: string[], invoiceNumber: string, total: number, parentLocale?: string | null): Promise<void> {
  try {
    // Staff alert in the club default language; the parent's confirmation in theirs.
    const org = await getOrgEmailContext(orgId);
    if (parentEmail) {
      const parentOrg = parentLocale ? await getOrgEmailContext(orgId, parentLocale) : org;
      const conf = registrationConfirmation({
        ...parentOrg.brand, parentName, programName, children, invoiceNumber, totalChf: total,
        dueDateLabel: parentOrg.f.date(new Date(Date.now() + 14 * 864e5)), manageUrl: parentOrg.link("/login"),
      });
      await sendEmail({ to: parentEmail, subject: conf.subject, html: conf.html, fromName: parentOrg.senderName ?? parentOrg.clubName });
    }
    for (const to of await getOrgAlertRecipients(orgId)) {
      const alert = adminRegistrationAlert({ ...org.brand, programName, parentName, children, totalChf: total, invoiceNumber });
      await sendEmail({ to, subject: alert.subject, html: alert.html, fromName: org.senderName ?? org.clubName });
    }
  } catch (e) {
    logError("camp.notify", e);
  }
}
