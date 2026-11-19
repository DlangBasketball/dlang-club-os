import { requireRole } from "@/lib/auth/get-user";
import { NutritionEditPage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function NutritionEditRoute({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  return <NutritionEditPage base="/admin/development" isAdmin={true} id={id} />;
}
