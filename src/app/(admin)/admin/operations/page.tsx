import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes, Building2, HandCoins, Landmark, Receipt, Shirt } from "lucide-react";
import { Card, CardBody, PageHeader, StatCard, StatGrid } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";

/** Club operations hub: equipment & kit, facilities, board, sponsors & donations. */
export default async function OperationsHubPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const isAdmin = me.roles.includes("admin");
  const db = await opsDb();
  const today = zonedDayKey(new Date(), f.timeZone);
  const count = (r: { count: number | null }) => r.count ?? 0;
  const [items, overdue, kitPending, closures, sponsors, campaigns] = await Promise.all([
    db.from("equipment_items").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("is_active", true).then(count),
    db.from("equipment_checkouts").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).is("returned_at", null).lt("due_on", today).then(count),
    db.from("kit_assignments").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("status", "sizes_requested").then(count),
    db.from("venue_closures").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).gte("ends_on", today).then(count),
    db.from("sponsors").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("status", "active").then(count),
    db.from("fundraising_campaigns").select("id", { count: "exact", head: true }).eq("org_id", me.orgId).eq("status", "active").then(count),
  ]);
  const areas = [
    { href: "/admin/operations/equipment", icon: Boxes, title: t("operations.equipment.title"), text: t("operations.equipment.description"), admin: true },
    { href: "/admin/operations/kit", icon: Shirt, title: t("operations.kit.title"), text: t("operations.kit.description"), admin: true },
    { href: "/admin/operations/facilities", icon: Building2, title: t("operations.facilities.title"), text: t("operations.facilities.description"), admin: true },
    { href: "/board", icon: Landmark, title: t("operations.board.title"), text: t("operations.board.description"), admin: true },
    { href: "/admin/operations/sponsors", icon: HandCoins, title: t("operations.sponsors.title"), text: t("operations.sponsors.description"), admin: false },
    { href: "/admin/operations/donations", icon: HandCoins, title: t("operations.donations.title"), text: t("operations.donations.description"), admin: false },
    { href: "/admin/operations/invoices", icon: Receipt, title: t("operations.invoices.title"), text: t("operations.invoices.description"), admin: false },
  ].filter((a) => isAdmin || !a.admin);
  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("operations.hub.title")} description={t("operations.hub.description")} />
      <StatGrid className="lg:grid-cols-3">
        {isAdmin && <StatCard label={t("operations.hub.items")} value={f.number(items)} href="/admin/operations/equipment" />}
        {isAdmin && <StatCard label={t("operations.hub.overdue")} value={f.number(overdue)} tone={overdue ? "danger" : "success"} href="/admin/operations/equipment" />}
        {isAdmin && <StatCard label={t("operations.hub.kitPending")} value={f.number(kitPending)} tone={kitPending ? "warning" : "success"} href="/admin/operations/kit" />}
        {isAdmin && <StatCard label={t("operations.hub.closures")} value={f.number(closures)} href="/admin/operations/facilities" />}
        <StatCard label={t("operations.hub.sponsors")} value={f.number(sponsors)} href="/admin/operations/sponsors" accent />
        <StatCard label={t("operations.hub.campaigns")} value={f.number(campaigns)} href="/admin/operations/donations" />
      </StatGrid>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {areas.map(({ href, icon: Icon, title, text }) => (
          <li key={href}>
            <Link href={href} className="block h-full">
              <Card className="h-full transition-colors hover:border-brand-primary">
                <CardBody className="flex gap-3">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-primary" aria-hidden />
                  <div>
                    <p className="font-medium text-text">{title}</p>
                    <p className="mt-1 text-sm text-text-muted">{text}</p>
                  </div>
                </CardBody>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
