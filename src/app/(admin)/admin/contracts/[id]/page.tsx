import { requireRole } from "@/lib/auth/get-user";
import { ContractView } from "@/components/forms/contract-view";

export const dynamic = "force-dynamic";

export default async function AdminContractPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  return <ContractView id={id} mode="admin" />;
}
