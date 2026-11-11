import { PageHeader, Card, CardBody } from "@/components/ui";
import { ServiceForm } from "@/components/admin/service-form";
export default function NewServicePage() {
  return (<div className="animate-fade-up max-w-2xl"><PageHeader title="New training service" /><Card><CardBody><ServiceForm /></CardBody></Card></div>);
}
