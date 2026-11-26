import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Repeat } from "lucide-react";
import { Card, CardBody, buttonVariants } from "@/components/ui";
import { BrandMark } from "@/components/layout/brand-mark";
import { homeFor, requireAuth } from "@/lib/auth/get-user";
import { MODE_HOME, isAppMode, modeLabelKey, modeOfPath } from "@/lib/auth/modes";
import { isSafeNextPath } from "@/lib/auth/safe-next";
import { getI18n } from "@/lib/i18n/server";
import { SwitchModeButton } from "./switch-mode-button";

export const metadata: Metadata = { robots: { index: false } };

/**
 * A link opened a page of another mode (e.g. an admin page while in Coach
 * mode). The person chooses: switch to that mode and continue, or stay.
 * Only modes the person holds are offered; anything else goes home.
 */
export default async function SwitchModePage({ searchParams }: { searchParams: Promise<{ to?: string; next?: string }> }) {
  const me = await requireAuth();
  const sp = await searchParams;
  const to = sp.to;
  if (!isAppMode(to) || !me.modes.includes(to)) redirect(homeFor(me));
  const next = sp.next && isSafeNextPath(sp.next) && modeOfPath(sp.next) === to ? sp.next : MODE_HOME[to];
  if (me.mode === to) redirect(next);
  const { t } = await getI18n();
  const label = (m: Parameters<typeof modeLabelKey>[0]) => t(`roleMode.modes.${modeLabelKey(m, me.allRoles)}`);
  const current = me.mode ? label(me.mode) : "";
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4">
      <BrandMark />
      <Card><CardBody className="space-y-4 py-6">
        <div className="flex items-center gap-2 text-brand-primary"><Repeat className="h-5 w-5" aria-hidden /><h1 className="font-display text-xl text-text">{t("roleMode.page.title", { mode: label(to) })}</h1></div>
        <p className="text-sm text-text-secondary">{t("roleMode.page.body", { target: label(to), current })}</p>
        <div className="flex flex-wrap gap-2">
          <SwitchModeButton mode={to} next={next} label={t("roleMode.page.switch", { mode: label(to) })} />
          <Link href={homeFor(me)} className={buttonVariants({ variant: "secondary" })}>{t("roleMode.page.stay", { mode: current })}</Link>
        </div>
      </CardBody></Card>
    </div>
  );
}
