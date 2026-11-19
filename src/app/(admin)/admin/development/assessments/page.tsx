import { requireRole } from "@/lib/auth/get-user";
import { AssessmentsPage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function AssessmentsRoute() {
  await requireRole(["admin"]);
  return <AssessmentsPage base="/admin/development" isAdmin={true} />;
}
