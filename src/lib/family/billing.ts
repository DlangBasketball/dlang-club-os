import "server-only";
import { logError } from "@/lib/log";
import { familyAdminDb } from "./db";

/**
 * Billing recipients with a second guardian:
 *   - a split invoice part goes to its responsible payer only;
 *   - otherwise to every guardian whose "receives emails" switch is on
 *     (falling back to all given recipients if nobody has it on, so a family
 *     is never left without a billing contact).
 */
export function pickBillingRecipients<R extends { profileId: string | null }>(
  people: R[],
  rule: { payerId: string | null; receivesEmails: Set<string> },
): R[] {
  if (rule.payerId) {
    const payer = people.filter((p) => p.profileId === rule.payerId);
    return payer.length ? payer : people.filter((p) => p.profileId === null);
  }
  const withEmails = people.filter((p) => p.profileId === null || rule.receivesEmails.has(p.profileId));
  return withEmails.some((p) => p.profileId !== null) ? withEmails : people;
}

/** Applies pickBillingRecipients with the invoice's payer and the family's switches. Never throws. */
export async function billingRecipientFilter<R extends { profileId: string | null }>(
  orgId: string,
  invoiceId: string | null,
  familyId: string,
  people: R[],
): Promise<R[]> {
  try {
    const db = familyAdminDb();
    let payerId: string | null = null;
    if (invoiceId) {
      const { data: inv } = await db.from("invoices").select("payer_profile_id").eq("id", invoiceId).eq("org_id", orgId).maybeSingle();
      payerId = (inv as { payer_profile_id?: string | null } | null)?.payer_profile_id ?? null;
    }
    const { data: links } = await db.from("family_members").select("profile_id,receives_emails").eq("family_id", familyId);
    const receivesEmails = new Set((links ?? []).filter((l) => l.receives_emails).map((l) => l.profile_id));
    return pickBillingRecipients(people, { payerId, receivesEmails });
  } catch (e) {
    logError("family.billingRecipients", e);
    return people;
  }
}

/** May this guardian pay this family's invoices (can_pay switch)? Staff always may. */
export async function guardianMayPay(orgId: string, familyId: string, profileId: string): Promise<boolean> {
  const db = familyAdminDb();
  const { data: fam } = await db.from("families").select("id").eq("id", familyId).eq("org_id", orgId).maybeSingle();
  if (!fam) return false;
  const { data } = await db.from("family_members").select("can_pay").eq("family_id", familyId).eq("profile_id", profileId).maybeSingle();
  return data ? Boolean(data.can_pay) : true;
}
