import { requireRole } from "@/lib/auth/get-user";
import { DevHubPage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function DevelopmentHubRoute() {
  await requireRole(["admin"]);
  return <DevHubPage base="/admin/development" isAdmin={true} />;
}
