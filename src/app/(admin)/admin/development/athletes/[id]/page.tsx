import { requireRole } from "@/lib/auth/get-user";
import { AthletePage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function AthleteDevelopmentRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  const sp = await searchParams;
  return <AthletePage base="/admin/development" isAdmin={true} id={id} view={typeof sp.view === "string" ? sp.view : undefined} />;
}
