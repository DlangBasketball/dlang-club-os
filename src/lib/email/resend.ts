import { PLATFORM_NAME } from "@/lib/brand";
/**
 * Minimal Resend client over fetch — no SDK dependency.
 * If RESEND_API_KEY is unset (e.g. local dev) it logs and no-ops so the
 * registration flow never fails just because email isn't configured.
 */
type SendArgs = {
  to: string; subject: string; html: string; replyTo?: string; fromName?: string | null;
  /** Resend tags (letters, digits, "_" and "-"); webhooks echo them (e.g. the org id). */
  tags?: { name: string; value: string }[];
};
export type SendResult = { ok: boolean; error?: string; /** Resend e-mail id (webhooks refer to it). */ id?: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Safe test mode: when EMAIL_TEST_REDIRECT is set (e.g. delivered@resend.dev
 * or bounced@resend.dev, Resend's test inboxes), every e-mail goes to that
 * address instead of the real recipient, so a verification run never reaches
 * a real person. See docs/family-attendance.md.
 */
export function testRedirect(): string | null {
  const v = process.env.EMAIL_TEST_REDIRECT?.trim();
  return v && EMAIL_RE.test(v) ? v : null;
}

/** Resend tag names / values: letters, digits, underscore and dash only. */
const tagValue = (v: string) => v.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);

/** RESEND_FROM may be "Name <addr>" or a bare address; the tenant name replaces the display name. */
export function fromHeader(fromName?: string | null): string {
  const raw = process.env.RESEND_FROM ?? process.env.RESEND_FROM_EMAIL ?? "noreply@example.com";
  const addr = raw.match(/<([^>]+)>/)?.[1] ?? raw.trim();
  const name = (fromName ?? raw.match(/^([^<]+)</)?.[1] ?? PLATFORM_NAME).replace(/["<>\r\n]/g, "").trim();
  return name ? `${name} <${addr}>` : addr;
}

export async function sendEmail({ to: requestedTo, subject, html, replyTo, fromName, tags }: SendArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = fromHeader(fromName);
  const to = testRedirect() ?? requestedTo;
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY not set — skipping email to ${to} (“${subject}”)`);
    return { ok: false, error: "email-not-configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}),
        ...(tags?.length ? { tags: tags.map((t) => ({ name: tagValue(t.name), value: tagValue(t.value) })) } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend ${res.status}: ${body}`);
      return { ok: false, error: resendError(res.status, body) };
    }
    const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
    return { ok: true, ...(typeof json?.id === "string" ? { id: json.id } : {}) };
  } catch (e) {
    console.error("[email] send failed:", e);
    return { ok: false, error: "network" };
  }
}

/** "resend-<status>: <provider message>", short (staff see it in the follow-up list). */
export function resendError(status: number, body: string): string {
  let detail = "";
  try {
    const j = JSON.parse(body) as { message?: unknown; name?: unknown };
    detail = typeof j.message === "string" ? j.message : typeof j.name === "string" ? j.name : "";
  } catch {
    detail = "";
  }
  return (detail ? `resend-${status}: ${detail}` : `resend-${status}`).slice(0, 200);
}
