import { MessageNewPage } from "@/components/messaging/pages";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("messaging.compose.title") };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const sp = await searchParams;
  return <MessageNewPage app="parent" to={sp.to} />;
}
