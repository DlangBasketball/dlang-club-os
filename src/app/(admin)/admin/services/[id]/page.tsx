import { notFound } from "next/navigation";
import { PageHeader, Card, CardBody, ErrorState } from "@/components/ui";
import { getService } from "@/lib/data/training-admin";
import { ServiceForm } from "@/components/admin/service-form";
export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await getService(id);
  if (error) return <ErrorState title="Couldn't load" message={error} />;
  if (!data) notFound();
  return (<div className="animate-fade-up max-w-2xl"><PageHeader title={`Edit · ${data.name}`} /><Card><CardBody><ServiceForm existing={data} /></CardBody></Card></div>);
}
