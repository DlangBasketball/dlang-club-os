import { requireRole } from "@/lib/auth/get-user";
import { PlansPage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function PlansRoute() {
  await requireRole(["admin"]);
  return <PlansPage base="/admin/development" isAdmin={true} />;
}
