import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { ClubHub } from "@/components/pwa/club-hub";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const t = await getTranslations(tenant.id);
  return { title: t("pwa.hub.metaTitle") };
}

/** Public club hub for the request host's club (signed in or not). */
export default async function ClubHubPage() {
  const tenant = await getTenant();
  if (!tenant.id) notFound();
  const user = await getSessionUser();
  return <ClubHub tenant={tenant} signedIn={Boolean(user)} />;
}
