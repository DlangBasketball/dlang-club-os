import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { CancelForm } from "@/components/accounting/cancel-form";
import { FinTable } from "@/components/finance/fin-table";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getQuote, listCancellable } from "@/lib/accounting/data";
import { isUuid } from "@/lib/finance/params";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.refunds.newTitle") };
}

type SP = { registration?: string; booking?: string; invoice?: string };

/** Finance: cancel a registration / booking / invoice and compute the refund from the policy. */
export default async function NewRefundPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [me, { t, f, ctx }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const subject = isUuid(sp.registration) ? { registrationId: sp.registration } : isUuid(sp.booking) ? { bookingId: sp.booking }
    : isUuid(sp.invoice) ? { invoiceId: sp.invoice } : null;
  const back = <Link href="/admin/accounting/refunds" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden /> {t("accounting.refunds.title")}</Link>;

  if (!subject) {
    const list = await listCancellable(me.orgId, null);
    return (
      <div className="animate-fade-up space-y-6">
        <PageHeader title={t("accounting.refunds.newTitle")} description={t("accounting.refunds.newDescription")} actions={back} />
        <AccountingNav t={t} active="refunds" />
        <FinTable
          title={t("accounting.refunds.pick")} caption={t("accounting.refunds.pick")} rows={list} rowKey={(r) => `${r.kind}-${r.id}`} empty={t("accounting.cancel.cancellableEmpty")}
          cols={[
            { key: "what", header: t("accounting.cancel.what"), cell: (r) => r.label },
            { key: "who", header: t("accounting.cancel.who"), cell: (r) => r.athlete },
            { key: "start", header: t("accounting.cancel.startsOn"), cell: (r) => r.startsOn ? f.date(r.startsOn) : "—" },
            { key: "go", header: t("accounting.common.actions"), align: "right", cell: (r) => (
              <Link href={`/admin/accounting/refunds/new?${r.kind}=${r.id}`} className="text-sm text-maroon hover:underline">{t("accounting.cancel.cancel")}</Link>
            ) },
          ]}
        />
      </div>
    );
  }

  const q = await getQuote(subject, false);
  return (
    <div className="animate-fade-up max-w-3xl space-y-6">
      <PageHeader title={t("accounting.refunds.newTitle")} description={q.data?.label ?? undefined} actions={back} />
      {q.error !== null ? <ErrorState message={t("accounting.errors.notFound")} /> : (
        <Card><CardBody className="py-5">
          <CancelForm subject={subject} quote={q.data} today={new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timeZone }).format(new Date())} backHref="/admin/accounting/refunds" />
        </CardBody></Card>
      )}
    </div>
  );
}
