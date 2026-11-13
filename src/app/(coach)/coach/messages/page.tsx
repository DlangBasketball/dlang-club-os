import { MessagesInboxPage } from "@/components/messaging/pages";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("messaging.inbox.title") };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const sp = await searchParams;
  return <MessagesInboxPage app="coach" view={sp.view} />;
}
