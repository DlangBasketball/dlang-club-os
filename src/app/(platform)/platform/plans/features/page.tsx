import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { FEATURE_CATALOG, FEATURE_CATEGORIES } from "@/lib/upgrades/catalog";
import { getFeatureMatrix } from "@/lib/upgrades/platform-data";
import { MatrixCell, PriceCell } from "./matrix-editor";

export const dynamic = "force-dynamic";

const CURRENCIES = ["CHF", "EUR", "USD"] as const;

/**
 * Plan <-> feature matrix and add-on prices (platform admins). Every change
 * goes through a platform_* RPC that re-checks the operator and writes the
 * platform audit log. Core modules are in every plan and are not listed;
 * add-on-only modules (AI assistant, SMS) cannot be put into a plan.
 */
export default async function FeatureMatrixPage() {
  const { plans, prices } = await getFeatureMatrix();
  const price = (key: string, cur: string) => {
    const p = prices.find((x) => x.feature_key === key && x.currency === cur);
    return p ? Number(p.amount) : null;
  };
  return (
    <div className="space-y-6">
      <Link href={"/platform/plans" as never} className="inline-flex items-center gap-1.5 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Plans
      </Link>
      <PageHeader
        title="Features & add-on prices"
        description="Which plan includes which module, and the monthly add-on price per currency (excl. VAT). Proposed packaging: docs/company/15_FEATURE_PACKAGING_PROPOSAL.md [Proposal][Confirm]. Price changes apply to new purchases; existing Stripe items keep their price."
      />
      <Card>
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-3">
                <th className="px-3 py-2">Module</th>
                {plans.map((p) => (
                  <th key={p.code} className="px-2 py-2 text-center">{p.name}</th>
                ))}
                {CURRENCIES.map((c) => (
                  <th key={c} className="px-2 py-2 text-right">Add-on {c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_CATEGORIES.filter((c) => c !== "core").map((cat) => (
                <FeatureRows key={cat} category={cat} plans={plans} price={price} />
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </div>
  );
}

function FeatureRows({
  category,
  plans,
  price,
}: {
  category: string;
  plans: { code: string; features: Record<string, boolean> }[];
  price: (key: string, cur: string) => number | null;
}) {
  const feats = FEATURE_CATALOG.filter((f) => f.category === category && !f.core);
  if (!feats.length) return null;
  return (
    <>
      <tr className="bg-surface-elevated">
        <td colSpan={1 + plans.length + CURRENCIES.length} className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-ink-3">
          {category}
        </td>
      </tr>
      {feats.map((f) => (
        <tr key={f.key} className="border-b border-line-soft last:border-b-0">
          <td className="px-3 py-1.5">
            <div className="text-ink">{f.label}</div>
            <div className="text-[11px] text-ink-3">
              {f.key}
              {f.requires?.length ? ` · needs ${f.requires.join(", ")}` : ""}
              {f.tier === null ? " · add-on only" : ""}
            </div>
          </td>
          {plans.map((p) => (
            <td key={p.code} className="px-2 py-1.5 text-center">
              <MatrixCell plan={p.code} feature={f.key} included={p.features?.[f.key] === true} disabled={f.tier === null} />
            </td>
          ))}
          {CURRENCIES.map((c) => (
            <td key={c} className="px-2 py-1.5 text-right">
              <PriceCell feature={f.key} currency={c} amount={price(f.key, c)} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
