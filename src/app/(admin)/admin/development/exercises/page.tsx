import { requireRole } from "@/lib/auth/get-user";
import { ExercisesPage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function ExercisesRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  return <ExercisesPage base="/admin/development" isAdmin={true} edit={typeof sp.edit === "string" ? sp.edit : undefined} />;
}
