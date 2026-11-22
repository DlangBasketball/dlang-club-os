import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { HIDDEN_ATHLETE_STATUS_FILTER, VISIBLE_FAMILY_STATUS } from "@/lib/people/person-delete";
import { loadOpenInvoices } from "@/lib/data/open-invoices";

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
    const { data, error } = await supabase.from("families").select("name,phone,created_at").eq("status", VISIBLE_FAMILY_STATUS).order("name");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    filename = "families.csv";
    csv = toCsv(["Family", "Phone", "Created"], (data ?? []).map((f) => [f.name, f.phone, f.created_at]));
  } else if (type === "athletes") {
    const { data, error } = await supabase.from("athletes").select("first_name,last_name,dob,status").not("status", "in", HIDDEN_ATHLETE_STATUS_FILTER).order("last_name");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    filename = "athletes.csv";
    csv = toCsv(["First name", "Last name", "DOB", "Status"], (data ?? []).map((a) => [a.first_name, a.last_name, a.dob, a.status]));
  } else {
    // default: outstanding invoices = open (sent, partially paid, overdue,
    // legacy pending) with what is still owed; drafts are not owed yet.
    const open = await loadOpenInvoices(supabase);
    if (open.error !== null) return NextResponse.json({ error: open.error }, { status: 500 });
    const byId = new Map(open.data.map((o) => [o.id, o]));
    const meta = new Map<string, { number: string; issued_at: string | null }>();
    const ids = open.data.map((o) => o.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase.from("invoices").select("id,number,issued_at").in("id", ids.slice(i, i + 200));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const r of data ?? []) meta.set(r.id, { number: r.number, issued_at: r.issued_at });
    }
    filename = "outstanding-invoices.csv";
    csv = toCsv(
      ["Invoice", "Currency", "Amount due", "Paid", "Balance", "Status", "Due", "Issued"],
      Array.from(byId.values())
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
        .map((o) => [meta.get(o.id)?.number ?? o.id, o.currency, o.amountDue, o.paid, o.balance, o.status, o.dueDate, meta.get(o.id)?.issued_at ?? null]),
    );
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
