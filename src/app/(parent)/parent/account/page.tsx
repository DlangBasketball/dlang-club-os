import { PageHeader, Card, CardHeader, CardTitle, CardBody, ErrorState } from "@/components/ui";
import { getAccount } from "@/lib/data/parent";
import { PrivacyTools } from "@/components/parent/privacy-tools";
import { ContactForm } from "@/components/parent/contact-form";

export default async function ParentAccountPage() {
  const { data, error } = await getAccount();
  if (error) return (<div className="animate-fade-up"><PageHeader title="Account" /><ErrorState title="Couldn't load account" message={error} /></div>);
  const { profile, family } = data!;
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title="Account & settings" description="Manage your contact details." />
      <Card>
        <CardHeader><CardTitle>Contact details</CardTitle></CardHeader>
        <CardBody>
          <ContactForm
            fullName={profile.fullName ?? ""} email={profile.email} profilePhone={profile.phone ?? ""}
            familyId={family?.id ?? null} familyPhone={family?.phone ?? ""} familyAddress={family?.address ?? ""} contactEmail={family?.contactEmail ?? ""}
          />
        </CardBody>
      </Card>
      <PrivacyTools />
    </div>
  );
}
