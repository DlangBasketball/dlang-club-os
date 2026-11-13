import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";

/** Minimal RFC-4180-ish CSV escaping. */
function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

/**
 * GET /admin/export?type=invoices|families|athletes
 * Streams a CSV. RLS scopes the data to the admin's org automatically.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !(user.roles.includes("admin") || user.roles.includes("finance"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const type = new URL(request.url).searchParams.get("type") ?? "invoices";
  const supabase = await createClient();
  let filename = "export.csv";
  let csv = "";

  if (type === "families") {
    const { data, error } = await supabase.from("families").select("name,phone,created_at").order("name");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    filename = "families.csv";
    csv = toCsv(["Family", "Phone", "Created"], (data ?? []).map((f) => [f.name, f.phone, f.created_at]));
  } else if (type === "athletes") {
    const { data, error } = await supabase.from("athletes").select("first_name,last_name,dob,status").order("last_name");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    filename = "athletes.csv";
    csv = toCsv(["First name", "Last name", "DOB", "Status"], (data ?? []).map((a) => [a.first_name, a.last_name, a.dob, a.status]));
  } else {
    // default: outstanding invoices
    const { data, error } = await supabase
      .from("invoices")
      .select("number,total_chf,status,due_date,issued_at")
      .in("status", ["pending", "draft", "overdue"])
      .order("due_date", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    filename = "outstanding-invoices.csv";
    csv = toCsv(
      ["Invoice", "Amount CHF", "Status", "Due", "Issued"],
      (data ?? []).map((i) => [i.number, i.total_chf, i.status, i.due_date, i.issued_at]),
    );
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
