import { PageHeader, ErrorState } from "@/components/ui";
import { listFamilies } from "@/lib/data/families";
import { InvoiceForm } from "@/components/invoice/invoice-form";

export default async function NewInvoicePage() {
  const { data, error } = await listFamilies();
  if (error) return (<div className="animate-fade-up"><PageHeader title="New invoice" /><ErrorState title="Couldn't load families" message={error} /></div>);
  const families = (data ?? []).map((f) => ({ id: f.id, name: f.name }));
  return (
    <div className="animate-fade-up">
      <PageHeader title="New invoice" description="Create a manual invoice with line items." />
      <InvoiceForm families={families} />
    </div>
  );
}
