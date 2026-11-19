import { PageHeader } from "@/components/ui";
import { getTenantOverview } from "@/lib/platform/data";
import { TenantTable } from "../../_components/tenant-table";

export const dynamic = "force-dynamic";

const STATUS_FILTERS = ["all", "trialing", "active", "past_due", "canceled", "suspended"] as const;
const SORTS = { created: "Newest", mrr: "MRR", athletes: "Athletes", name: "Name" } as const;

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; plan?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const all = await getTenantOverview();
  const q = (sp.q ?? "").trim().toLowerCase();
  const status = STATUS_FILTERS.includes(sp.status as (typeof STATUS_FILTERS)[number]) ? sp.status! : "all";
  const plan = sp.plan ?? "all";
  const sort = (sp.sort && sp.sort in SORTS ? sp.sort : "created") as keyof typeof SORTS;
  const plans = Array.from(new Set(all.map((r) => r.plan_code).filter(Boolean))) as string[];

  let rows = all.filter((r) => {
    if (q && !`${r.name} ${r.slug ?? ""} ${r.country ?? ""} ${r.sport ?? ""}`.toLowerCase().includes(q)) return false;
    if (status === "suspended" && !r.suspended_at) return false;
    if (status !== "all" && status !== "suspended" && (r.status !== status || r.suspended_at)) return false;
    if (plan !== "all" && r.plan_code !== plan) return false;
    return true;
  });
  rows = [...rows].sort((a, b) => {
    if (sort === "mrr") return b.mrr - a.mrr;
    if (sort === "athletes") return b.athletes - a.athletes;
    if (sort === "name") return a.name.localeCompare(b.name);
    return a.created_at < b.created_at ? 1 : -1;
  });

  const select = "h-10 rounded border border-line bg-surface-input px-3 text-sm text-ink";

  return (
    <div className="space-y-6">
      <PageHeader title="Tenants" description={`${all.length} organizations on the platform.`} />

      <form method="get" className="flex flex-wrap items-end gap-3">
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search name, slug, country, sport…"
          className="h-10 min-w-[220px] flex-1 rounded border border-line bg-surface-input px-3 text-sm text-ink placeholder:text-ink-3"
        />
        <select name="status" defaultValue={status} className={select} aria-label="Status">
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select name="plan" defaultValue={plan} className={select} aria-label="Plan">
          <option value="all">All plans</option>
          {plans.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} className={select} aria-label="Sort">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              Sort: {v}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-10 rounded border border-[#C19A45]/50 px-4 text-sm text-[#E4C77F] hover:bg-[#C19A45]/10"
        >
          Apply
        </button>
      </form>

      <TenantTable rows={rows} />
    </div>
  );
}
