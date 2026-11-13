import { requireRole } from "@/lib/auth/get-user";
import { RankingsPage } from "@/components/development/pages";

/** Admins only: finance has no access to children's development data. */
export default async function RankingsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  return <RankingsPage base="/admin/development" isAdmin={true} group={typeof sp.group === "string" ? sp.group : undefined} />;
}
