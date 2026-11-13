import Link from "next/link";
import { Card } from "@/components/ui";
import { formatMoney, SPORTS } from "@/lib/platform/catalog";
import type { TenantOverviewRow } from "@/lib/platform/types";
import { SubscriptionBadge, UsageMeter, fmtDate } from "./ui";

const sportLabel = (v: string | null) => SPORTS.find((s) => s.value === v)?.label ?? v ?? "—";

export function TenantTable({ rows }: { rows: TenantOverviewRow[] }) {
  if (rows.length === 0) {
    return (
      <Card className="px-6 py-12 text-center text-sm text-ink-2">No tenants match these filters.</Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wide text-ink-3">
              <th className="px-4 py-3 font-medium">Tenant</th>
              <th className="px-4 py-3 font-medium">Plan</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Athletes</th>
              <th className="px-4 py-3 font-medium">Staff</th>
              <th className="px-4 py-3 text-right font-medium">MRR</th>
              <th className="px-4 py-3 font-medium">Renews / trial ends</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.org_id} className="border-b border-line-soft last:border-b-0 hover:bg-surface-elevated/50">
                <td className="px-4 py-3">
                  <Link href={`/platform/tenants/${r.org_id}` as never} className="font-medium text-ink hover:text-[#E4C77F]">
                    {r.name}
                  </Link>
                  <div className="text-xs text-ink-3">
                    /{r.slug ?? "—"} · {sportLabel(r.sport)} · {r.country ?? "—"}
                  </div>
                </td>
                <td className="px-4 py-3 text-ink-2">
                  {r.plan_name ?? "—"}
                  {r.billing_interval && <span className="text-xs text-ink-3"> · {r.billing_interval}ly</span>}
                </td>
                <td className="px-4 py-3">
                  <SubscriptionBadge status={r.status} suspended={Boolean(r.suspended_at)} />
                </td>
                <td className="px-4 py-3">
                  <UsageMeter used={r.athletes} limit={r.max_athletes} />
                </td>
                <td className="px-4 py-3">
                  <UsageMeter used={r.staff} limit={r.max_staff} />
                </td>
                <td className="tnum px-4 py-3 text-right">
                  {r.mrr > 0 ? formatMoney(r.mrr, r.currency ?? "CHF") : <span className="text-ink-4">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-ink-2">
                  {r.status === "trialing" ? fmtDate(r.trial_ends_at) : fmtDate(r.current_period_end)}
                </td>
                <td className="px-4 py-3 text-xs text-ink-3">{fmtDate(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
