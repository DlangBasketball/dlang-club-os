import { PageHeader } from "@/components/ui";
import { listConsentForms } from "@/lib/data/consents-admin";
import { ConsentManager } from "@/components/admin/consent-manager";

export default async function AdminConsentsPage() {
  const forms = await listConsentForms();
  return (
    <div className="animate-fade-up">
      <PageHeader title="Consent forms" description="Versioned agreements, acceptance tracking and audit trail." />
      <ConsentManager forms={forms} />
    </div>
  );
}
