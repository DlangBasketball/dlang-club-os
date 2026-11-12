import Link from "next/link";
import { CalendarClock, CalendarPlus, Coins, Dumbbell, Users } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, DataTable, EmptyState, ErrorState, PageHeader, statusTone, type Column } from "@/components/ui";
import { CancelPurchaseButton, GroupSlotActions, SellPackageForm } from "@/components/training/admin-widgets";
import { listPurchases, listTrainingCatalog, listUpcomingGroupSlots, type GroupSlot, type PurchaseView } from "@/lib/training/data";
import { trainingDb } from "@/lib/training/db";
import { getI18n } from "@/lib/i18n/server";

export default async function AdminTrainingPage() {
  const { t, f } = await getI18n();
  const db = await trainingDb();
  const [catalog, purchases, groups, athletes] = await Promise.all([
    listTrainingCatalog({ activeOnly: true }),
    listPurchases({ limit: 200 }),
    listUpcomingGroupSlots(),
    db.from("athletes").select("id,first_name,last_name").order("first_name").limit(2000),
  ]);
  if (catalog.error !== null || purchases.error !== null) {
    return (<div className="animate-fade-up"><PageHeader title={t("training.admin.title")} /><ErrorState title={t("training.common.loadFailed")} message={catalog.error ?? purchases.error ?? ""} /></div>);
  }
  const now = Date.now();
  const purchaseCols: Column<PurchaseView>[] = [
    { key: "createdAt", header: t("training.purchases.date"), render: (p) => f.date(p.createdAt) },
    { key: "athleteName", header: t("training.book.athlete"), render: (p) => <Link href={`/admin/athletes/${p.athleteId}/training`} className="font-medium text-ink hover:text-maroon">{p.athleteName}</Link> },
    { key: "serviceName", header: t("training.book.stepService"), render: (p) => `${p.serviceName}${p.packageName ? ` · ${p.packageName}` : ""}` },
    { key: "sessionsUsed", header: t("training.purchases.sessions"), render: (p) => <span className="tnum">{t("training.purchases.used", { used: p.sessionsUsed, total: p.sessions })}</span> },
    { key: "amount", header: t("training.purchases.amount"), align: "right", render: (p) => (
      <span className="tnum">{f.money(p.amount, p.currency)}{p.discountTotal > 0 && <span className="block text-[11px] text-success">−{f.money(p.discountTotal, p.currency)}</span>}</span>
    ) },
    { key: "status", header: t("training.common.status"), render: (p) => {
      const expired = p.status === "active" && p.expiresAt && Date.parse(p.expiresAt) <= now;
      return <Badge tone={expired ? "warning" : statusTone(p.status === "active" ? "paid" : p.status)}>{expired ? t("training.purchases.statuses.expired") : t.dynamic(`training.purchases.statuses.${p.status}`, undefined, p.status)}</Badge>;
    } },
    { key: "expiresAt", header: t("training.purchases.expires"), render: (p) => p.expiresAt ? f.date(p.expiresAt) : "—" },
    { key: "invoiceNumber", header: t("training.purchases.invoice"), render: (p) => p.invoiceId ? <Link href={`/admin/invoices/${p.invoiceId}`} className="text-maroon hover:underline">{p.invoiceNumber}</Link> : t.dynamic(`training.sell.modes.${p.paymentMode}`, undefined, p.paymentMode) },
    { key: "id", header: t("common.actions"), align: "right", render: (p) => p.status !== "cancelled" ? <CancelPurchaseButton purchaseId={p.id} /> : null },
  ];
  const groupCols: Column<GroupSlot>[] = [
    { key: "start", header: t("training.book.when"), render: (g) => `${f.date(g.start, { weekday: true })} · ${f.time(g.start)}` },
    { key: "serviceName", header: t("training.book.stepService") },
    { key: "coachName", header: t("training.book.coach") },
    { key: "booked", header: t("training.groups.participants"), render: (g) => <span className="tnum">{g.booked} / {g.maxParticipants}</span> },
    { key: "confirmed", header: t("training.common.status"), render: (g) => g.confirmed
      ? <Badge tone="success">{t("training.groups.confirmed")}</Badge>
      : <Badge tone="warning">{t("training.book.needsMore", { count: Math.max(0, g.minParticipants - g.booked) })}</Badge> },
    { key: "coachId", header: t("common.actions"), align: "right", render: (g) => <GroupSlotActions coachId={g.coachId} serviceId={g.serviceId} start={g.start} confirmed={g.confirmed} /> },
  ];
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("training.admin.title")} description={t("training.admin.description")}
        actions={<div className="flex flex-wrap gap-2">
          <Link href="/admin/services"><Button size="sm" variant="secondary"><Dumbbell className="h-4 w-4" /> {t("training.services.title")}</Button></Link>
          <Link href="/admin/availability"><Button size="sm" variant="secondary"><CalendarClock className="h-4 w-4" /> {t("training.nav.availability")}</Button></Link>
          <Link href="/admin/bookings/new"><Button size="sm"><CalendarPlus className="h-4 w-4" /> {t("training.adminBookings.new")}</Button></Link>
        </div>} />
      <Card>
        <CardHeader><CardTitle>{t("training.sell.title")}</CardTitle></CardHeader>
        <CardBody>
          <SellPackageForm athletes={(athletes.data ?? []).map((a) => ({ id: a.id, name: `${a.first_name} ${a.last_name}` }))} services={catalog.data.services} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("training.groups.title")}</CardTitle></CardHeader>
        <CardBody><DataTable columns={groupCols} rows={(groups.data ?? []) as (GroupSlot & Record<string, unknown>)[]} getRowKey={(g) => `${g.coachId}|${g.serviceId}|${g.start}`}
          empty={<EmptyState icon={<Users className="h-5 w-5" />} title={t("training.groups.empty")} />} /></CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("training.purchases.title")}</CardTitle></CardHeader>
        <CardBody><DataTable columns={purchaseCols} rows={purchases.data as (PurchaseView & Record<string, unknown>)[]} getRowKey={(p) => p.id}
          empty={<EmptyState icon={<Coins className="h-5 w-5" />} title={t("training.purchases.empty")} />} /></CardBody>
      </Card>
    </div>
  );
}
