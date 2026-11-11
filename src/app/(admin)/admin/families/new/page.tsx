import { PageHeader } from "@/components/ui";
import { FamilyForm } from "@/components/family/family-form";

export default function NewFamilyPage() {
  return (
    <div className="animate-fade-up">
      <PageHeader title="New family" description="Create a household, then add athletes and invite a guardian." />
      <FamilyForm />
    </div>
  );
}
