import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { renderOpsInvoicePdf } from "@/lib/operations/pdf";

export const dynamic = "force-dynamic";

/** External invoice PDF (admin + finance of the club only; RLS-scoped read). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance")) || !(await tenantMatchesOrg(me.orgId))) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Not found", { status: 404 });
  return renderOpsInvoicePdf(id, me.orgId);
}
