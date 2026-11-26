import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { writeAudit } from "@/lib/people/server";
import { financeDb } from "@/lib/finance/db";
import { isUuid } from "@/lib/finance/params";
import { RECEIPT_BUCKET, isReceiptPathFor } from "@/lib/finance/validation";

/**
 * GET /admin/finance/expenses/:id/receipt — admin / finance of the expense's
 * org only. Redirects to a 60-second signed URL of the private object and
 * records the access in audit_logs.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance")) || !(await tenantMatchesOrg(me.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = await financeDb();
  const { data } = await db.from("expenses").select("id,receipt_path,receipt_name").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!data?.receipt_path || !isReceiptPathFor(data.receipt_path, me.orgId, id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: signed, error } = await db.storage.from(RECEIPT_BUCKET).createSignedUrl(data.receipt_path, 60, { download: data.receipt_name ?? true });
  if (error || !signed?.signedUrl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await writeAudit({ id: me.id, orgId: me.orgId }, "expense.receipt.view", "expenses", id);
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
