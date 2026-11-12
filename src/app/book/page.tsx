import { notFound, redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant/server";

export const dynamic = "force-dynamic";

/** /book on a club's own host -> that club's booking page. */
export default async function BookIndexPage() {
  const tenant = await getTenant();
  if (!tenant.id || tenant.source === "unknown") notFound();
  redirect(`/book/${tenant.slug}`);
}
