import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { todayIn } from "@/lib/payments/plans";
import { getPayerContext, isUuid, resolvePayerFamily } from "@/lib/data/player-billing";
import { RecordPaymentForm } from "@/components/player-billing/record-payment-form";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("playerBilling.record.title") };
}

/**
 * Record a payment (dashboard shortcut target): one received amount,
 * allocated to the payer's open invoices per revenue category. Accepts
 * ?family=, ?athlete= (the player's family pays) or ?invoice= (that
 * invoice's family, invoice preselected). Admin and finance.
 */
export default async function RecordPaymentPage({ searchParams }: { searchParams: Promise<{ family?: string; athlete?: string; invoice?: string }> }) {
  const [me, { t, f }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const familyId = isUuid(sp.family) ? sp.family : await resolvePayerFamily({ athleteId: sp.athlete, invoiceId: sp.invoice });
  const payer = familyId ? await getPayerContext(familyId) : { data: null, error: null };
  if (payer.error !== null) return <ErrorState title={t("playerBilling.errors.loadFailedTitle")} message={t("playerBilling.errors.loadFailed")} />;

  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader
        eyebrow={<Link href="/admin/payments" className="hover:underline">{t("editMoney.paymentList.title")}</Link>}
        title={t("playerBilling.record.title")}
        description={t("playerBilling.record.description")}
      />
      <Card><CardBody>
        <RecordPaymentForm
          key={payer.data?.familyId ?? "none"}
          payer={payer.data}
          preselectInvoiceId={isUuid(sp.invoice) ? sp.invoice : null}
          defaultCurrency={f.currency}
          today={todayIn(f.timeZone)}
        />
      </CardBody></Card>
    </div>
  );
}
