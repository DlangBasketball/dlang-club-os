import { MessageThreadPage } from "@/components/messaging/pages";
import { getI18n } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("messaging.thread.title") };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MessageThreadPage app="coach" id={id} />;
}
