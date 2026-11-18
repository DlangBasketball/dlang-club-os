import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, FileDown, HandCoins, Landmark, Lock, Mail, Undo2 } from "lucide-react";
import { Card, CardBody, PageHeader, StatCard } from "@/components/ui";
import { AccountingNav, sectionHref, type AccountingSection } from "@/components/accounting/accounting-nav";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { accountingDb } from "@/lib/accounting/db";
import { listLocks, unmatchedCount } from "@/lib/accounting/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.title") };
}

const CARDS: { key: Exclude<AccountingSection, "overview">; icon: typeof Landmark }[] = [
  { key: "bank", icon: Landmark },
  { key: "exports", icon: FileDown },
  { key: "periods", icon: Lock },
  { key: "refunds", icon: Undo2 },
  { key: "dunning", icon: Mail },
  { key: "support", icon: HandCoins },
  { key: "chart", icon: BookOpen },
];

/** Accounting hub: bank files, exports, period locks, refunds, dunning, family support, chart of accounts. */
export default async function AccountingPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const db = await accountingDb();
  const [unmatched, locks, { count: openRequests }, { count: collection }] = await Promise.all([
    unmatchedCount(me.orgId),
    listLocks(me.orgId),
    db.from("refund_requests").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).in("status", ["requested", "stripe_failed", "processing"]),
    db.from("dunning_cases").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("status", "collection"),
  ]);
  const lastClosed = (locks.data ?? []).filter((l) => !l.reopened_at).map((l) => l.period_end).sort().pop() ?? null;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("accounting.title")} description={t("accounting.description")} />
      <AccountingNav t={t} active="overview" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("accounting.overview.unmatched")} value={f.number(unmatched)} tone={unmatched > 0 ? "warning" : "brand"} />
        <StatCard label={t("accounting.overview.openRequests")} value={f.number(openRequests ?? 0)} tone={(openRequests ?? 0) > 0 ? "warning" : "brand"} />
        <StatCard label={t("accounting.overview.collection")} value={f.number(collection ?? 0)} tone={(collection ?? 0) > 0 ? "danger" : "brand"} />
        <StatCard label={t("accounting.overview.lockedThrough")} value={lastClosed ? f.date(lastClosed) : t("accounting.common.none")} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CARDS.map(({ key, icon: Icon }) => (
          <Link key={key} href={sectionHref(key)} className="group">
            <Card className="h-full transition-colors group-hover:border-brand-primary">
              <CardBody className="flex gap-3 py-5">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-primary" aria-hidden />
                <div>
                  <div className="font-medium text-ink">{t.dynamic(`accounting.overview.cards.${key}.title`)}</div>
                  <p className="mt-1 text-sm text-ink-3">{t.dynamic(`accounting.overview.cards.${key}.body`)}</p>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
