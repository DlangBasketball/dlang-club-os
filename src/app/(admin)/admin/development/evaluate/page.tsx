import { requireRole } from "@/lib/auth/get-user";
import { EvaluatePage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function EvaluateRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  return <EvaluatePage base="/admin/development" isAdmin={true} athleteId={typeof sp.athlete === "string" ? sp.athlete : undefined} teamId={typeof sp.team === "string" ? sp.team : undefined} />;
}
