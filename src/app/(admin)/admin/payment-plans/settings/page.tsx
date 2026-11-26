import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { loadPlanSettings } from "@/lib/plans/settings";
import { getOrgPaymentProfile } from "@/lib/payments/settings";
import { PlanSettingsForm } from "@/components/plans/settings-form";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("plans.settings.title") };
}

/** Club rules: instalments per product, schedule, fee, reminders, autopay. */
export default async function PlanSettingsPage() {
  const [me, { t, ctx }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const [settings, profile] = await Promise.all([loadPlanSettings(me.orgId), getOrgPaymentProfile(me.orgId)]);
  return (
    <div className="animate-fade-up max-w-4xl space-y-6">
      <PageHeader title={t("plans.settings.title")} description={t("plans.settings.description")}
        actions={<Link href="/admin/payment-plans" className="text-sm text-maroon hover:underline">{t("plans.admin.backToPlans")}</Link>} />
      <Card><CardBody>
        <PlanSettingsForm initial={settings} currency={profile.currency ?? ctx.currency} stripeReady={profile.stripeReady} />
      </CardBody></Card>
    </div>
  );
}
