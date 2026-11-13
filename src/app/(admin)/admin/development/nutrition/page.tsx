import { requireRole } from "@/lib/auth/get-user";
import { NutritionPage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function NutritionRoute() {
  await requireRole(["admin"]);
  return <NutritionPage base="/admin/development" isAdmin={true} />;
}
