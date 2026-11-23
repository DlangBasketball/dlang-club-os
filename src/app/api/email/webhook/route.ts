import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deliveryOutcome, verifySvixSignature } from "@/lib/email/webhook";
import { recordAlertEmailFailure } from "@/lib/attendance/alerts";
import { logError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/email/webhook — Resend delivery events, signed (Svix) with
 * RESEND_WEBHOOK_SECRET. Machine endpoint: no session; the signature is the
 * credential. Rows are matched by the provider e-mail id (unique) and, when
 * the e-mail carried it, the org tag.
 *   email.bounced / email.complained / email.failed -> email_logs "bounced" /
 *     "failed" with the reason; a no-show alert e-mail -> alert "failed" at the
 *     attempt cap, so it shows in the staff follow-up list.
 *   email.delivered -> email_logs "delivered".
 * Other events are acknowledged and ignored.
 */
export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const body = await req.text();
  const valid = verifySvixSignature({
    secret, body,
    id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature"),
  });
  if (!valid) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const o = deliveryOutcome(payload);
  if (o.kind === "ignored") return NextResponse.json({ ok: true, ignored: true });
  const orgId = o.orgId && UUID_RE.test(o.orgId) ? o.orgId : null;

  try {
    if (o.kind === "failed") {
      // Alert e-mails: email_logs + the alert (attempt cap -> staff follow-up).
      const alerts = await recordAlertEmailFailure(o.providerId, o.error, orgId);
      if (alerts === 0) {
        let q = createAdminClient().from("email_logs")
          .update({ status: o.error.startsWith("bounced") ? "bounced" : "failed", error: o.error, updated_at: new Date().toISOString() })
          .eq("provider_id", o.providerId);
        if (orgId) q = q.eq("org_id", orgId);
        await q;
      }
      return NextResponse.json({ ok: true, alerts });
    }
    let q = createAdminClient().from("email_logs").update({ status: "delivered", updated_at: new Date().toISOString() })
      .eq("provider_id", o.providerId).in("status", ["queued", "sent"]);
    if (orgId) q = q.eq("org_id", orgId);
    await q;
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("email.webhook", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
