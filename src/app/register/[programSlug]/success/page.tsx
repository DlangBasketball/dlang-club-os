import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card, CardBody, Button } from "@/components/ui";
import { getPublicProgram } from "@/lib/data/public-registration";
import { getTranslations } from "@/lib/i18n/server";

export default async function RegistrationSuccessPage({
  params, searchParams,
}: {
  params: Promise<{ programSlug: string }>;
  searchParams: Promise<{ ref?: string; account?: string; plan?: string; applied?: string; requested?: string }>;
}) {
  const { programSlug } = await params;
  const { ref, account, plan, applied, requested } = await searchParams;
  const requestedCount = /^\d{1,2}$/.test(requested ?? "") ? Number(requested) : 0;
  const existing = account === "existing";
  const planCount = /^\d{1,2}$/.test(plan ?? "") ? Number(plan) : 0;
  const data = await getPublicProgram(programSlug);
  const t = await getTranslations(data?.program.orgId);
  const programName = data?.program.name ?? t("registration.success.theProgram");

  return (
    <div className="animate-fade-up py-6">
      <Card className="mx-auto max-w-lg">
        <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <div>
            <h1 className="font-display text-2xl font-semibold">{applied === "1" ? t("selection.public.successTitle") : t("registration.success.title")}</h1>
            <p className="mt-2 text-sm text-ink-2">
              {applied === "1"
                ? t("selection.public.successBody", { program: programName })
                : ref
                ? t("registration.success.thanksWithInvoice", { program: programName, invoice: ref })
                : t("registration.success.thanks", { program: programName })}
            </p>
          </div>
          {planCount > 1 && <p className="text-sm text-ink-2">{t("plans.choose.successNote", { count: planCount })}</p>}
          {requestedCount > 0 && <p className="text-sm text-ink-2">{t("registration.success.requestedNote", { count: requestedCount })}</p>}
          {(account === "password" || account === "link") && (
            <p className="text-sm text-ink-2">{t(account === "password" ? "camps.account.confirmEmailSent" : "camps.account.linkSent")}</p>
          )}
          <div className="w-full rounded-md border border-line bg-surface-elevated/50 p-4 text-left text-sm text-ink-2">
            <p className="font-medium text-ink">{t("registration.success.nextTitle")}</p>
            {applied === "1" ? (
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>{t("selection.public.next1")}</li>
                <li>{t("selection.public.next2")}</li>
                <li>{t("selection.public.next3")}</li>
              </ol>
            ) : (
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>{t("registration.success.next1")}</li>
                {!existing && <li>{t("registration.success.next2")}</li>}
                <li>{t("registration.success.next3")}</li>
              </ol>
            )}
          </div>
          {existing
            ? <Link href="/parent/bookings"><Button>{t("registration.success.myBookings")}</Button></Link>
            : <Link href="/login"><Button>{t("registration.success.setupAccount")}</Button></Link>}
        </CardBody>
      </Card>
    </div>
  );
}
