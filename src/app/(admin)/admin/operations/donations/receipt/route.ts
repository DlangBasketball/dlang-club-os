import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { writeAudit } from "@/lib/people/server";
import { renderDonationReceiptPdf } from "@/lib/operations/pdf";

export const dynamic = "force-dynamic";

/** Annual donation receipt for one donor: ?donor=<id>&year=YYYY (admin + finance). */
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance")) || !(await tenantMatchesOrg(me.orgId))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const url = new URL(req.url);
  const donor = url.searchParams.get("donor") ?? "";
  const year = Number(url.searchParams.get("year"));
  if (!/^[0-9a-f-]{36}$/i.test(donor) || !Number.isInteger(year) || year < 2000 || year > 2100) return new NextResponse("Not found", { status: 404 });
  const res = await renderDonationReceiptPdf(donor, year, me.orgId);
  if (res.status === 200) await writeAudit({ id: me.id, orgId: me.orgId }, "donation.receipt", "ops_customers", donor, { year });
  return res;
}
