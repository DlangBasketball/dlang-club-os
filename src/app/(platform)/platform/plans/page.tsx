import { PageHeader } from "@/components/ui";
import { getAllPlans } from "@/lib/platform/data";
import { PlanEditor } from "./plan-editor";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const plans = await getAllPlans();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Plans"
        description="Sellable plans, per-currency prices (CHF / EUR / USD), limits and features. Changes apply to new checkouts immediately; existing Stripe subscriptions keep their price until changed in Stripe."
      />
      <div className="space-y-4">
        {plans.map((p) => (
          <PlanEditor key={p.code} plan={p} />
        ))}
        <PlanEditor plan={null} />
      </div>
    </div>
  );
}
