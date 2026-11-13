import { requireRole } from "@/lib/auth/get-user";
import { ContractView } from "@/components/forms/contract-view";

export const dynamic = "force-dynamic";

/** Guardians review and accept their family's contracts (RLS: is_guardian_of_family). */
export default async function ParentContractPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["parent"]);
  const { id } = await params;
  return <ContractView id={id} mode="parent" />;
}
