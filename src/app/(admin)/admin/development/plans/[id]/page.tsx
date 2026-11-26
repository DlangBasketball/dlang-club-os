import { requireRole } from "@/lib/auth/get-user";
import { PlanPage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function PlanRoute({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  return <PlanPage base="/admin/development" isAdmin={true} id={id} />;
}
