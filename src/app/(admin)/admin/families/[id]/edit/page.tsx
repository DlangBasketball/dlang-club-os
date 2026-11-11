import { notFound } from "next/navigation";
import { PageHeader, ErrorState } from "@/components/ui";
import { FamilyForm } from "@/components/family/family-form";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { getFamily } from "@/lib/data/families";
import { deleteFamily } from "@/lib/actions/family";

export default async function EditFamilyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, error } = await getFamily(id);
  if (error) return <ErrorState title="Couldn't load family" message={error} />;
  if (!data) notFound();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`Edit ${data.name}`}
        actions={<ConfirmDeleteButton action={deleteFamily.bind(null, id)} label="Delete family" confirmText={`Delete ${data.name}? This also removes its athletes and cannot be undone.`} />}
      />
      <FamilyForm familyId={id} initial={{ name: data.name, address: data.address ?? "", phone: data.phone ?? "" }} />
    </div>
  );
}
