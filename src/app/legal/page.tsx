import { redirect } from "next/navigation";
import { defaultLegalSlug } from "@/lib/compliance/tenant";

export const dynamic = "force-dynamic";

/** /legal -> the default tenant's legal index (single-club deployments). */
export default function LegalRoot() {
  redirect(`/legal/${defaultLegalSlug()}`);
}
