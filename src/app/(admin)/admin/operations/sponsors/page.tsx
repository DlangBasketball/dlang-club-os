import Link from "next/link";
import { redirect } from "next/navigation";
import { HandCoins } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";
import { sponsorRenewalDue } from "@/lib/operations/equipment";
import { sponsorFields } from "@/lib/operations/fields";
import { saveSponsor } from "@/lib/actions/operations-sponsors";

/** Sponsors: packages, contract periods, deliverables and renewals. */
export default async function SponsorsPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const db = await opsDb();
  const today = zonedDayKey(new Date(), f.timeZone);
  const [{ data: sponsors }, { data: customers }, { data: deliverables }] = await Promise.all([
    db.from("sponsors").select("*").eq("org_id", me.orgId).order("contract_end", { nullsFirst: false }).limit(500),
    db.from("ops_customers").select("id,name").eq("org_id", me.orgId).order("name").limit(1000),
    db.from("sponsor_deliverables").select("sponsor_id,done_at,due_on").eq("org_id", me.orgId).limit(5000),
  ]);
  const customerName = new Map((customers ?? []).map((c) => [c.id, c.name]));
  const open = new Map<string, { total: number; done: number; late: number }>();
  for (const d of deliverables ?? []) {
    const o = open.get(d.sponsor_id) ?? { total: 0, done: 0, late: 0 };
    o.total += 1;
    if (d.done_at) o.done += 1;
    else if (d.due_on && d.due_on < today) o.late += 1;
    open.set(d.sponsor_id, o);
  }
  const active = (sponsors ?? []).filter((s) => s.status === "active");
  const totals = new Map<string, number>();
  for (const s of active) totals.set(s.currency, (totals.get(s.currency) ?? 0) + Number(s.amount));

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/operations" className="hover:text-text">{t("operations.hub.title")}</Link>}
        title={t("operations.sponsors.title")} description={t("operations.sponsors.description")} />
      {totals.size > 0 && (
        <p className="text-sm text-text-muted">{t("operations.sponsors.activeTotal", { amount: [...totals].map(([c, v]) => f.money(v, c)).join(" · ") })}</p>
      )}
      {(sponsors ?? []).length === 0 ? <EmptyState icon={<HandCoins />} title={t("operations.sponsors.empty")} /> : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(sponsors ?? []).map((s) => {
            const d = open.get(s.id);
            const renew = sponsorRenewalDue({ status: s.status, contractEnd: s.contract_end, reminderDays: s.renewal_reminder_days }, today);
            return (
              <li key={s.id}>
                <Link href={`/admin/operations/sponsors/${s.id}`} className="block h-full">
                  <Card className="h-full hover:border-brand-primary">
                    <CardBody className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">{customerName.get(s.customer_id) ?? "—"}</span>
                        <Badge tone="accent">{t.dynamic(`operations.sponsors.tiers.${s.tier}`)}</Badge>
                      </div>
                      <p className="text-sm text-text-muted">{s.package_name ?? ""} · {f.money(s.amount, s.currency)}</p>
                      <p className="text-xs text-text-muted">{s.contract_start && s.contract_end ? f.dateRange(s.contract_start, s.contract_end) : t("operations.sponsors.noPeriod")}</p>
                      <div className="flex flex-wrap gap-1.5 text-xs">
                        <Badge tone={s.status === "active" ? "success" : s.status === "prospect" ? "info" : "neutral"}>{t.dynamic(`operations.sponsors.statuses.${s.status}`)}</Badge>
                        {d && <Badge tone={d.late ? "danger" : "neutral"}>{t("operations.sponsors.deliverablesDone", { done: d.done, total: d.total })}</Badge>}
                        {renew && <Badge tone="warning">{t("operations.sponsors.renewalDue")}</Badge>}
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Card>
        <CardHeader><CardTitle>{t("operations.sponsors.add")}</CardTitle></CardHeader>
        <CardBody>
          <OpsForm action={saveSponsor.bind(null, null)} submitLabel={t("common.add")} redirectTo="/admin/operations/sponsors/{id}" columns={3}
            fields={sponsorFields(t, f.currency, (customers ?? []).map((c) => ({ value: c.id, label: c.name })), null)} />
        </CardBody>
      </Card>
    </div>
  );
}
