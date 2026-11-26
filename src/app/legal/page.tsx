import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant/server";

export const dynamic = "force-dynamic";

/** /legal -> the legal index of the tenant resolved from the request host. */
export default async function LegalRoot() {
  const tenant = await getTenant();
  redirect(`/legal/${tenant.slug}`);
}
