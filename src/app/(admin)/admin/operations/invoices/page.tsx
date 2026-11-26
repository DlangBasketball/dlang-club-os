import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { OpsButton, OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { opsDb } from "@/lib/operations/db";
import { CUSTOMER_KINDS } from "@/lib/operations/validation";
import { saveCustomer } from "@/lib/actions/operations-facilities";
import { setOpsInvoiceStatus } from "@/lib/actions/operations-sponsors";

/** External customers (renters, sponsors, donors) and their invoices. */
export default async function OpsInvoicesPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const db = await opsDb();
  const [{ data: invoices }, { data: customers }] = await Promise.all([
    db.from("ops_invoices").select("*").eq("org_id", me.orgId).order("issued_on", { ascending: false }).limit(500),
    db.from("ops_customers").select("*").eq("org_id", me.orgId).order("name").limit(1000),
  ]);
  const customerName = new Map((customers ?? []).map((c) => [c.id, c.name]));
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/operations" className="hover:text-text">{t("operations.hub.title")}</Link>}
        title={t("operations.invoices.title")} description={t("operations.invoices.description")} />
      <Card>
        <CardHeader><CardTitle>{t("operations.invoices.list")}</CardTitle></CardHeader>
        <CardBody className="overflow-x-auto p-0">
          {(invoices ?? []).length === 0 ? <p className="p-4 text-sm text-text-muted">{t("operations.invoices.empty")}</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-text-muted">
                <tr><th className="p-3">{t("operations.invoices.number")}</th><th className="p-3">{t("operations.invoices.customer")}</th>
                  <th className="p-3">{t("common.date")}</th><th className="p-3">{t("common.amount")}</th>
                  <th className="p-3">{t("common.status")}</th><th className="p-3" /></tr>
              </thead>
              <tbody>
                {(invoices ?? []).map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="p-3 font-mono"><a href={`/admin/operations/invoices/${i.id}/pdf`} className="hover:text-brand-primary">{i.number}</a>
                      <div className="font-sans text-xs text-text-muted">{t.dynamic(`operations.invoices.sources.${i.source}`)}</div></td>
                    <td className="p-3">{customerName.get(i.customer_id) ?? "—"}</td>
                    <td className="p-3">{f.date(i.issued_on)}{i.due_on ? <div className="text-xs text-text-muted">{t("operations.invoices.due", { date: f.date(i.due_on) })}</div> : null}</td>
                    <td className="p-3">{f.money(i.total, i.currency)}</td>
                    <td className="p-3"><Badge tone={i.status === "paid" ? "success" : i.status === "cancelled" ? "danger" : "warning"}>{t.dynamic(`operations.invoices.statuses.${i.status}`)}</Badge></td>
                    <td className="flex flex-wrap gap-1 p-3">
                      {i.status === "issued" && <OpsButton action={setOpsInvoiceStatus.bind(null, i.id, "paid")} label={t("operations.invoices.markPaid")} />}
                      {i.status === "issued" && <OpsButton action={setOpsInvoiceStatus.bind(null, i.id, "cancelled")} label={t("operations.invoices.cancel")} variant="ghost" confirm={t("operations.invoices.confirmCancel")} />}
                      {i.status === "paid" && <OpsButton action={setOpsInvoiceStatus.bind(null, i.id, "issued")} label={t("operations.invoices.reopen")} variant="ghost" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("operations.customers.title")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {(customers ?? []).length === 0 && <li className="text-text-muted">{t("operations.customers.empty")}</li>}
              {(customers ?? []).map((c) => (
                <li key={c.id} className="border-b border-border pb-1.5 last:border-0">
                  <span className="font-medium">{c.name}</span> <span className="text-xs text-text-muted">{t.dynamic(`operations.customers.kinds.${c.kind}`)}</span>
                  <div className="text-xs text-text-muted">{[c.contact_name, c.email, c.phone, [c.postal_code, c.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("operations.customers.add")}</CardTitle></CardHeader>
          <CardBody>
            <OpsForm action={saveCustomer.bind(null, null)} submitLabel={t("common.add")} reset fields={[
              { name: "kind", label: t("operations.customers.kind"), type: "select", options: CUSTOMER_KINDS.map((k) => ({ value: k, label: t.dynamic(`operations.customers.kinds.${k}`) })) },
              { name: "name", label: t("common.name"), required: true },
              { name: "contactName", label: t("operations.customers.contact") },
              { name: "email", label: t("common.email"), type: "email" },
              { name: "phone", label: t("common.phone") },
              { name: "street", label: t("operations.customers.street") },
              { name: "postalCode", label: t("operations.customers.postalCode") },
              { name: "city", label: t("operations.customers.city") },
              { name: "country", label: t("operations.customers.country") },
            ]} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
