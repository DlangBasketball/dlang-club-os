import { requireRole } from "@/lib/auth/get-user";
import { WellnessPage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function WellnessRoute() {
  await requireRole(["admin"]);
  return <WellnessPage base="/admin/development" isAdmin={true} />;
}
