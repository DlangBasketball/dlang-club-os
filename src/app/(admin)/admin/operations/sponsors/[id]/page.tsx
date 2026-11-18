import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { OpsButton, OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";
import { sponsorFields } from "@/lib/operations/fields";
import { DELIVERABLE_KINDS } from "@/lib/operations/validation";
import { invoiceSponsor, saveDeliverable, saveSponsor, toggleDeliverable } from "@/lib/actions/operations-sponsors";

/** One sponsor: contract, deliverables checklist and invoices. */
export default async function SponsorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await opsDb();
  const { data: s } = await db.from("sponsors").select("*").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!s) notFound();
  const [{ data: customers }, { data: deliverables }, { data: invoices }] = await Promise.all([
    db.from("ops_customers").select("id,name,contact_name,email,phone").eq("org_id", me.orgId).order("name").limit(1000),
    db.from("sponsor_deliverables").select("*").eq("org_id", me.orgId).eq("sponsor_id", id).order("due_on", { nullsFirst: false }),
    db.from("ops_invoices").select("id,number,total,currency,status,issued_on").eq("org_id", me.orgId).eq("source", "sponsor").eq("source_id", id).order("issued_on", { ascending: false }),
  ]);
  const company = (customers ?? []).find((c) => c.id === s.customer_id);
  const today = zonedDayKey(new Date(), f.timeZone);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/operations/sponsors" className="hover:text-text">{t("operations.sponsors.title")}</Link>}
        title={company?.name ?? "—"} description={[company?.contact_name, company?.email, company?.phone].filter(Boolean).join(" · ")}
        actions={<OpsButton action={invoiceSponsor.bind(null, s.id)} label={t("operations.sponsors.invoice")} variant="primary" />} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("operations.sponsors.deliverables")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <ul className="space-y-2 text-sm">
              {(deliverables ?? []).length === 0 && <li className="text-text-muted">{t("operations.sponsors.noDeliverables")}</li>}
              {(deliverables ?? []).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span className={d.done_at ? "text-text-muted line-through" : undefined}>
                    <span className="text-xs text-text-muted">{t.dynamic(`operations.sponsors.deliverableKinds.${d.kind}`)}</span> · {d.title}
                    {d.due_on && <Badge className="ml-2" tone={!d.done_at && d.due_on < today ? "danger" : "neutral"}>{f.date(d.due_on)}</Badge>}
                  </span>
                  <OpsButton action={toggleDeliverable.bind(null, d.id)} label={d.done_at ? t("operations.sponsors.reopen") : t("operations.sponsors.markDone")} />
                </li>
              ))}
            </ul>
            <OpsForm action={saveDeliverable} submitLabel={t("common.add")} reset fields={[
              { name: "sponsorId", label: "", type: "hidden", defaultValue: s.id },
              { name: "kind", label: t("operations.sponsors.deliverableKind"), type: "select", options: DELIVERABLE_KINDS.map((k) => ({ value: k, label: t.dynamic(`operations.sponsors.deliverableKinds.${k}`) })) },
              { name: "title", label: t("operations.common.title"), required: true },
              { name: "dueOn", label: t("operations.equipment.due"), type: "date" },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("operations.invoices.title")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {(invoices ?? []).length === 0 && <li className="text-text-muted">{t("operations.invoices.empty")}</li>}
              {(invoices ?? []).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2">
                  <a href={`/admin/operations/invoices/${i.id}/pdf`} className="font-mono hover:text-brand-primary">{i.number}</a>
                  <span>{f.date(i.issued_on)} · {f.money(i.total, i.currency)} <Badge tone={i.status === "paid" ? "success" : "warning"}>{t.dynamic(`operations.invoices.statuses.${i.status}`)}</Badge></span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>{t("operations.common.details")}</CardTitle></CardHeader>
        <CardBody>
          <OpsForm action={saveSponsor.bind(null, s.id)} submitLabel={t("common.save")} columns={3}
            fields={sponsorFields(t, f.currency, (customers ?? []).map((c) => ({ value: c.id, label: c.name })), s)} />
        </CardBody>
      </Card>
    </div>
  );
}
