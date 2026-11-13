import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { listInvoices } from "@/lib/data/invoices";

export const dynamic = "force-dynamic";

function csvCell(v: string | number | null): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const me = await getSessionUser();
  if (!me || !(me.roles.includes("admin") || me.roles.includes("finance"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const { data, error } = await listInvoices("all");
  if (error) return new NextResponse(error, { status: 500 });

  const header = ["Invoice", "Family", "Status", "Total CHF", "Paid CHF", "Balance CHF", "Due date", "Issued"];
  const lines = [header.join(",")];
  for (const i of data!) {
    lines.push([
      csvCell(i.number), csvCell(i.familyName), csvCell(i.status),
      i.total.toFixed(2), i.paid.toFixed(2), i.balance.toFixed(2),
      csvCell(i.dueDate), csvCell(i.issuedAt.slice(0, 10)),
    ].join(","));
  }
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invoices-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
