const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pure selection of a club's alert recipients: the org's notification_email
 * setting when valid, otherwise the active admins that belong to that org.
 */
export function pickAlertRecipients(
  orgId: string,
  settings: unknown,
  admins: { email: string | null; org_id: string | null; is_active: boolean | null }[],
): string[] {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const configured = typeof s.notification_email === "string" ? s.notification_email.trim() : "";
  if (EMAIL_RE.test(configured)) return [configured];
  const out = new Set<string>();
  for (const a of admins) {
    if (a.org_id !== orgId || a.is_active === false || !a.email) continue;
    if (a.email.endsWith("@deleted.invalid") || !EMAIL_RE.test(a.email)) continue;
    out.add(a.email);
  }
  return [...out];
}
