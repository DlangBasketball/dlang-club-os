import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { getTranslations } from "@/lib/i18n/server";
import type { AssistantDenyReason } from "@/lib/ai/access";

const REASON_KEY = {
  unconfigured: "aiAssistant.unavailable.unconfigured",
  not_entitled: "aiAssistant.unavailable.notEntitled",
  disabled: "aiAssistant.unavailable.disabled",
  role: "aiAssistant.unavailable.role",
} as const satisfies Record<AssistantDenyReason, string>;

/** Shown instead of the chat when the club has not enabled the assistant (or the user may not use it). */
export async function AssistantUnavailable({ reason, settingsHref }: { reason: AssistantDenyReason; settingsHref?: string | null }) {
  const t = await getTranslations();
  return (
    <EmptyState
      icon={<Sparkles className="h-5 w-5" aria-hidden />}
      title={t("aiAssistant.unavailableTitle")}
      description={t(REASON_KEY[reason])}
      action={
        settingsHref ? (
          <Link href={settingsHref as never}>
            <Button variant="secondary">{t("aiAssistant.openSettings")}</Button>
          </Link>
        ) : undefined
      }
    />
  );
}
