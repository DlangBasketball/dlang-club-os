import Link from "next/link";
import { ClipboardList, Pencil, Plus } from "lucide-react";
import { PageHeader, Button, DataTable, Badge, statusTone, EmptyState, ErrorState, Avatar, type Column } from "@/components/ui";
import { photoUrlsForCoaches } from "@/lib/people/server";
import { listAllBookings, type AdminBooking } from "@/lib/data/training-admin";
import { getI18n } from "@/lib/i18n/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { DeletePersonButton } from "@/components/people/delete-person";
import { getInvoiceMoneyMap } from "@/lib/data/player-billing";
import { CategoryPill, MoneyStatusPill } from "@/components/player-billing/category-pill";

export default async function AdminBookingsPage() {
  const [{ t, f }, me] = await Promise.all([getI18n(), getSessionUser()]);
  const isAdmin = !!me?.roles.includes("admin");
  const { data, error } = await listAllBookings();
  if (error) return (<div className="animate-fade-up"><PageHeader title={t("training.adminBookings.title")} /><ErrorState title={t("editOps.common.loadFailed")} message={error} /></div>);
  const [coachPhotos, invoices] = await Promise.all([photoUrlsForCoaches(data!.map((b) => b.coachId)), getInvoiceMoneyMap(data!.map((b) => b.invoiceId))]);
  const columns: Column<AdminBooking>[] = [
    { key: "athleteName", header: t("playerBilling.bookings.player"), render: (b) => (
      <span>
        <Link href={`/admin/bookings/${b.id}`} className="font-medium text-ink hover:text-maroon">{b.athleteName}</Link>
        <Link href={`/admin/athletes/${b.athleteId}?tab=bookings`} className="block text-xs text-ink-3 hover:text-maroon">{t("playerBilling.roster.openProfile")}</Link>
      </span>
    ) },
    { key: "serviceName", header: t("playerBilling.bookings.service") },
    { key: "coachName", header: t("playerBilling.bookings.coach"), render: (b) => <span className="flex items-center gap-2"><Avatar name={b.coachName} src={coachPhotos[b.coachId] ?? null} size="sm" />{b.coachName}</span> },
    { key: "start", header: t("playerBilling.bookings.date"), render: (b) => `${f.date(b.start)} ${f.time(b.start)}` },
    { key: "price", header: t("playerBilling.bookings.price"), render: (b) => b.creditsUsed > 0 ? t("playerBilling.bookings.credits", { count: b.creditsUsed }) : b.price !== null ? f.money(b.price, b.invoiceId ? invoices.get(b.invoiceId)?.currency : undefined) : "—" },
    { key: "invoiceId", header: t("playerBilling.common.invoice"), render: (b) => {
      const inv = b.invoiceId ? invoices.get(b.invoiceId) : undefined;
      return inv ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <Link href={`/admin/invoices/${inv.id}`} className="tnum text-maroon hover:underline">{inv.number}</Link>
          <CategoryPill category={inv.category} label={inv.categoryLabel} />
          <MoneyStatusPill status={inv.paymentStatus} />
        </span>
      ) : <span className="text-ink-3">—</span>;
    } },
    { key: "status", header: t("common.status"), render: (b) => <Badge tone={statusTone(b.status)}>{t.dynamic(`editOps.bookings.statuses.${b.status}`, undefined, b.status)}</Badge> },
    { key: "id", header: t("common.actions"), render: (b) => (
      <span className="inline-flex items-center gap-2">
        {b.status !== "cancelled" && <Link href={`/admin/bookings/${b.id}`} className="inline-flex items-center gap-1 text-xs text-maroon hover:underline"><Pencil className="h-3 w-3" />{t("common.edit")}</Link>}
        {isAdmin && <DeletePersonButton kind="athlete" id={b.athleteId} name={b.athleteName} variant="icon" />}
      </span>
    ) },
  ];
  return (
    <div className="animate-fade-up">
      <PageHeader title={t("training.adminBookings.title")} description={t("training.adminBookings.description")}
        actions={<Link href="/admin/bookings/new"><Button size="sm"><Plus className="h-4 w-4" /> {t("training.adminBookings.new")}</Button></Link>} />
      <DataTable columns={columns} rows={data!} getRowKey={(b) => b.id}
        empty={<EmptyState icon={<ClipboardList className="h-5 w-5" />} title={t("playerBilling.bookings.emptyAll")} />} />
    </div>
  );
}
