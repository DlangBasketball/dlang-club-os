import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Download, MapPin, Users } from "lucide-react";
import { Badge, Button, Card, CardBody, DataTable, EmptyState, ErrorState, PageHeader, statusTone, type Column } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getEditionRegistrations, type EditionRegistration } from "@/lib/camps/data";
import { getI18n } from "@/lib/i18n/server";

export default async function CampEditionPage({ params }: { params: Promise<{ id: string; editionId: string }> }) {
  const { id, editionId } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect(`/admin/programs/${id}`);
  const { data, error } = await getEditionRegistrations(me.orgId, editionId);
  if (error) return <div className="animate-fade-up"><PageHeader title={t("camps.editions.registrationsTitle")} /><ErrorState message={error} /></div>;
  const e = data?.edition;
  if (!e || e.programId !== id) notFound();
  const rows = data!.rows;
  const active = rows.filter((r) => r.status !== "cancelled");
  const total = active.reduce((s, r) => s + (r.amount ?? 0), 0);
  const currency = rows.find((r) => r.currency)?.currency ?? f.currency;

  const columns: Column<EditionRegistration>[] = [
    { key: "athlete", header: t("camps.export.athlete"), render: (r) => (
      <div>
        <Link href={`/admin/registrations/${r.id}`} className="font-medium text-ink hover:text-maroon">{r.athleteName}</Link>
        <div className="text-xs text-ink-3">{r.familyName}{r.membership === "guest" ? ` · ${t("camps.membership.guest")}` : ""}</div>
      </div>
    ) },
    { key: "ageGroup", header: t("camps.register.ageGroup"), render: (r) => r.ageGroup ?? "—" },
    { key: "option", header: t("camps.export.option"), render: (r) => r.optionLabel ?? "—" },
    { key: "days", header: t("camps.export.days"), render: (r) => <span className="text-xs">{r.days.map((d) => f.date(d, { weekday: true, style: "short" })).join(", ")}</span> },
    { key: "amount", header: t("common.amount"), align: "right", render: (r) => (
      <div className="tnum">
        {r.amount !== null ? f.money(r.amount, r.currency ?? currency) : "—"}
        {(r.discountAmount ?? 0) > 0 && <div className="text-xs text-success">{`– ${f.money(r.discountAmount, r.currency ?? currency)}`}</div>}
      </div>
    ) },
    { key: "status", header: t("common.status"), render: (r) => <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status)}</Badge> },
    { key: "invoice", header: t("camps.export.invoice"), render: (r) => r.invoiceId ? <Link href={`/admin/invoices/${r.invoiceId}`} className="tnum text-xs text-maroon hover:underline">{r.invoiceNumber}</Link> : "—" },
  ];

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={`${data!.programName} · ${e.name || f.dateRange(e.startsOn, e.endsOn)}`} description={f.dateRange(e.startsOn, e.endsOn)}
        actions={<a href={`/admin/programs/${id}/editions/${editionId}/export`}><Button variant="secondary"><Download className="h-4 w-4" /> {t("camps.export.csv")}</Button></a>} />
      <Card><CardBody className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
        <span className="flex items-center gap-1.5"><Users className="h-4 w-4" />{e.capacity !== null ? t("camps.editions.capacityLine", { taken: e.taken, capacity: e.capacity, left: e.spotsLeft ?? 0 }) : t("camps.editions.registeredLine", { taken: e.taken })}</span>
        {(e.venue || e.city) && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{e.venue ? e.venue.name : e.locationName ?? e.city}</span>}
        <span>{t("camps.editions.revenue", { amount: f.money(total, currency) })}</span>
        <Link href={`/admin/programs/${id}`} className="text-maroon hover:underline">{t("camps.editions.backToCamp")}</Link>
      </CardBody></Card>
      <DataTable columns={columns} rows={rows} getRowKey={(r) => r.id}
        empty={<EmptyState icon={<Users className="h-5 w-5" />} title={t("camps.editions.noRegistrations")} />} />
    </div>
  );
}
