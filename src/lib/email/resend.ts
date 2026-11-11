/**
 * Minimal Resend client over fetch — no SDK dependency.
 * If RESEND_API_KEY is unset (e.g. local dev) it logs and no-ops so the
 * registration flow never fails just because email isn't configured.
 */
type SendArgs = { to: string; subject: string; html: string; replyTo?: string };

export async function sendEmail({ to, subject, html, replyTo }: SendArgs): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "DLang Basketball <noreply@dlangbasketball.ch>";
  if (!apiKey) {
    console.warn(`[email] RESEND_API_KEY not set — skipping email to ${to} (“${subject}”)`);
    return { ok: false, error: "email-not-configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] Resend ${res.status}: ${body}`);
      return { ok: false, error: `resend-${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[email] send failed:", e);
    return { ok: false, error: "network" };
  }
}
