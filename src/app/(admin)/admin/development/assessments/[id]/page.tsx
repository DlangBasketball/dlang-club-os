import { requireRole } from "@/lib/auth/get-user";
import { TemplatePage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function TemplateRoute({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  return <TemplatePage base="/admin/development" isAdmin={true} id={id} />;
}
