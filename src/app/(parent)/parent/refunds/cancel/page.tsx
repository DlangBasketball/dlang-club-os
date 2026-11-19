import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { CancelForm } from "@/components/accounting/cancel-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getQuote } from "@/lib/accounting/data";
import { isUuid } from "@/lib/finance/params";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.cancel.title") };
}

/** Parent: the club's policy and the computed refund, then confirm the cancellation. */
export default async function ParentCancelPage({ searchParams }: { searchParams: Promise<{ registration?: string; booking?: string }> }) {
  const [me, { t, ctx }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId) redirect("/login");
  const subject = isUuid(sp.registration) ? { registrationId: sp.registration } : isUuid(sp.booking) ? { bookingId: sp.booking } : null;
  if (!subject) redirect("/parent/refunds");
  const q = await getQuote(subject, false);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timeZone }).format(new Date());

  return (
    <div className="animate-fade-up max-w-2xl space-y-6">
      <PageHeader
        title={t("accounting.cancel.confirmTitle")}
        description={q.data?.label ?? undefined}
        actions={<Link href="/parent/refunds" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden /> {t("accounting.cancel.back")}</Link>}
      />
      {q.error !== null ? <ErrorState message={t("accounting.errors.notFound")} /> : (
        <Card><CardBody className="py-5">
          <CancelForm subject={subject} quote={q.data} today={today} backHref="/parent/refunds" />
        </CardBody></Card>
      )}
    </div>
  );
}
