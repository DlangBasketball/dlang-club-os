import { Badge } from "@/components/ui";
import { nextStepKey, nextStepTone, type NextStep } from "@/lib/status/next-step";
import type { Translator } from "@/lib/i18n/translator";

/** Family-facing next step label (see src/lib/status/next-step.ts). */
export function NextStepBadge({ step, t }: { step: NextStep; t: Translator }) {
  return <Badge tone={nextStepTone(step)}>{t(nextStepKey(step))}</Badge>;
}
