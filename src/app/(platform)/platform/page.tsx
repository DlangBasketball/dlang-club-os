import Link from "next/link";
import { AlertTriangle, Building2, CalendarClock, Coins, PauseCircle } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, PageHeader, StatCard } from "@/components/ui";
import { getTenantOverview } from "@/lib/platform/data";
import { summarizeMrr } from "@/lib/platform/mrr";
import { captureAllUsage } from "@/lib/platform/actions";
import { formatMoney } from "@/lib/platform/catalog";
import { TenantTable } from "../_components/tenant-table";
import { ActionButton } from "../_components/action-button";
import { fmtDate } from "../_components/ui";

export const dynamic = "force-dynamic";

export default async function PlatformOverviewPage() {
  const rows = await getTenantOverview();
  const s = summarizeMrr(rows);
  const now = Date.now();
  const endingSoon = rows
    .filter(
      (r) =>
        r.status === "trialing" &&
        !r.suspended_at &&
        r.trial_ends_at &&
        new Date(r.trial_ends_at).getTime() > now &&
        new Date(r.trial_ends_at).getTime() <= now + 7 * 86_400_000,
    )
    .sort((a, b) => (a.trial_ends_at! < b.trial_ends_at! ? -1 : 1));
  const attention = rows.filter((r) => r.status === "past_due" || r.status === "unpaid");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Platform overview"
        description="Recurring revenue, tenants and plan mix across every organization on the platform."
        actions={<ActionButton action={captureAllUsage}>Capture usage now</ActionButton>}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {s.byCurrency.length === 0 ? (
          <StatCard label="MRR" value="—" hint="No paying tenants yet" icon={<Coins className="h-4 w-4" />} accent />
        ) : (
          s.byCurrency.map((c) => (
            <StatCard
              key={c.currency}
              label={`MRR · ${c.currency}`}
              value={formatMoney(c.mrr, c.currency)}
              hint={`ARR ${formatMoney(c.arr, c.currency, { compact: true })} · ${c.paying} paying`}
              icon={<Coins className="h-4 w-4" />}
              accent
            />
          ))
        )}
        <StatCard
          label="Tenants"
          value={String(s.tenants)}
          hint={`${s.paying} paying · ${s.trialing} trialing`}
          icon={<Building2 className="h-4 w-4" />}
          href="/platform/tenants"
        />
        <StatCard
          label="Trials ending ≤ 7 days"
          value={String(s.trialsEndingSoon)}
          hint="Conversion opportunities"
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <StatCard
          label="Needs attention"
          value={String(s.pastDue + s.suspended)}
          hint={`${s.pastDue} past due · ${s.suspended} suspended · ${s.canceled} canceled`}
          icon={s.suspended ? <PauseCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        />
      </section>

      <p className="text-xs text-ink-3">
        MRR counts active and past-due subscriptions (yearly plans ÷ 12, negotiated and founding-lock amounts included).
        Currencies are reported separately — no FX conversion.
      </p>

      <section className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Plan mix</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            {s.byPlan.map((p) => (
              <div key={p.plan}>
                <div className="flex justify-between text-sm">
                  <span className="text-ink-2">{p.plan}</span>
                  <span className="tnum text-ink">{p.count}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                  <div
                    className="h-full bg-[#C19A45]"
                    style={{ width: `${Math.max(4, Math.round((p.count / Math.max(s.tenants, 1)) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
            {s.byPlan.length === 0 && <p className="text-sm text-ink-3">No tenants yet.</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trials ending soon</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {endingSoon.length === 0 && <p className="text-sm text-ink-3">Nothing in the next 7 days.</p>}
            {endingSoon.slice(0, 8).map((r) => (
              <Link
                key={r.org_id}
                href={`/platform/tenants/${r.org_id}` as never}
                className="flex justify-between rounded px-2 py-1.5 text-sm hover:bg-surface-elevated"
              >
                <span className="truncate text-ink">{r.name}</span>
                <span className="text-xs text-ink-3">{fmtDate(r.trial_ends_at)}</span>
              </Link>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Past due</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {attention.length === 0 && <p className="text-sm text-ink-3">All payments are current.</p>}
            {attention.slice(0, 8).map((r) => (
              <Link
                key={r.org_id}
                href={`/platform/tenants/${r.org_id}` as never}
                className="flex justify-between rounded px-2 py-1.5 text-sm hover:bg-surface-elevated"
              >
                <span className="truncate text-ink">{r.name}</span>
                <span className="text-xs text-warning">{r.status?.replace("_", " ")}</span>
              </Link>
            ))}
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold">Newest tenants</h2>
          <Link href={"/platform/tenants" as never} className="text-sm text-[#C19A45] hover:underline">
            All tenants →
          </Link>
        </div>
        <TenantTable rows={rows.slice(0, 10)} />
      </section>
    </div>
  );
}
