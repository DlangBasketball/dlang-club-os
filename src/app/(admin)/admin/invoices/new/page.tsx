import { PageHeader, ErrorState } from "@/components/ui";
import { listFamilies } from "@/lib/data/families";
import { InvoiceForm } from "@/components/invoice/invoice-form";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export default async function NewInvoicePage() {
  const [{ t, f }, me, { data, error }] = await Promise.all([getI18n(), getSessionUser(), listFamilies()]);
  if (error) return (<div className="animate-fade-up"><PageHeader title={t("billing.invoiceForm.title")} /><ErrorState title={t("billing.invoiceForm.loadFamiliesFailed")} message={error} /></div>);
  const families = (data ?? []).map((x) => ({ id: x.id, name: x.name }));
  // Invoice-number prefixes per revenue category, for the preview (final number is set on issue).
  const prefixes: Record<string, string> = {};
  if (me?.orgId) {
    const db = await createClient();
    const { data: series } = await db.from("invoice_number_series").select("category,prefix,is_active").eq("org_id", me.orgId);
    for (const r of series ?? []) if (r.is_active) prefixes[r.category] = r.prefix;
  }
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: f.timeZone, year: "numeric" }).format(new Date()));
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("billing.invoiceForm.title")} description={t("billing.invoiceForm.description_page")} />
      <InvoiceForm families={families} prefixes={prefixes} year={year} />
    </div>
  );
}
