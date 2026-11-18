import Link from "next/link";
import { redirect } from "next/navigation";
import { Boxes } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { OpsButton, OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";
import { loadLookups } from "@/lib/operations/data";
import { availableQuantity, isOverdue } from "@/lib/operations/equipment";
import { equipmentFields } from "@/lib/operations/fields";
import { checkInEquipment, checkOutEquipment, saveEquipmentItem } from "@/lib/actions/operations-equipment";

/** Club equipment per location: stock, condition, check-outs and overdue returns. */
export default async function EquipmentPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const db = await opsDb();
  const [lookups, { data: items }, { data: open }] = await Promise.all([
    loadLookups(db, me.orgId),
    db.from("equipment_items").select("*").eq("org_id", me.orgId).order("name").limit(1000),
    db.from("equipment_checkouts").select("*").eq("org_id", me.orgId).is("returned_at", null).order("due_on").limit(1000),
  ]);
  const today = zonedDayKey(new Date(), f.timeZone);
  const venueName = new Map(lookups.venues.map((v) => [v.id, v.name]));
  const coachName = new Map(lookups.coaches.map((c) => [c.id, c.display_name]));
  const teamName = new Map(lookups.teams.map((x) => [x.id, x.name]));
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));
  const checkouts = (open ?? []).map((c) => ({ id: c.id, itemId: c.item_id, quantity: c.quantity, dueOn: c.due_on, returnedAt: c.returned_at }));
  const none = { value: "", label: t("common.none") };
  const activeItems = (items ?? []).filter((i) => i.is_active);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/operations" className="hover:text-text">{t("operations.hub.title")}</Link>}
        title={t("operations.equipment.title")} description={t("operations.equipment.description")} />

      <Card>
        <CardHeader><CardTitle>{t("operations.equipment.inventory")}</CardTitle></CardHeader>
        <CardBody className="overflow-x-auto p-0">
          {activeItems.length === 0 ? <div className="p-4"><EmptyState icon={<Boxes />} title={t("operations.equipment.empty")} /></div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-text-muted">
                <tr><th className="p-3">{t("operations.equipment.name")}</th><th className="p-3">{t("operations.equipment.location")}</th>
                  <th className="p-3">{t("operations.equipment.available")}</th><th className="p-3">{t("operations.equipment.condition")}</th>
                  <th className="p-3">{t("operations.equipment.value")}</th></tr>
              </thead>
              <tbody>
                {activeItems.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="p-3"><Link href={`/admin/operations/equipment/${i.id}`} className="font-medium hover:text-brand-primary">{i.name}</Link>
                      <div className="text-xs text-text-muted">{t.dynamic(`operations.equipment.categories.${i.category}`)}</div></td>
                    <td className="p-3">{i.venue_id ? venueName.get(i.venue_id) ?? "—" : "—"}</td>
                    <td className="p-3">{t("operations.equipment.availableOf", { available: availableQuantity(i.quantity, checkouts, i.id), total: i.quantity })}</td>
                    <td className="p-3"><Badge tone={i.condition === "broken" || i.condition === "poor" ? "danger" : i.condition === "fair" ? "warning" : "success"}>{t.dynamic(`operations.conditions.${i.condition}`)}</Badge></td>
                    <td className="p-3">{i.purchase_value !== null ? f.money(i.purchase_value, i.currency ?? f.currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("operations.equipment.checkedOut")}</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          {(open ?? []).length === 0 ? <p className="text-sm text-text-muted">{t("operations.equipment.noneOut")}</p> : (open ?? []).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-0">
              <div>
                <span className="font-medium">{itemName.get(c.item_id)}</span> × {c.quantity} · {c.coach_id ? coachName.get(c.coach_id) : c.team_id ? teamName.get(c.team_id) : ""}
                {c.due_on && <span className="ml-2">{isOverdue({ dueOn: c.due_on, returnedAt: c.returned_at }, today)
                  ? <Badge tone="danger">{t("operations.equipment.overdueSince", { date: f.date(c.due_on) })}</Badge>
                  : <Badge>{t("operations.equipment.dueOn", { date: f.date(c.due_on) })}</Badge>}</span>}
              </div>
              <OpsButton action={checkInEquipment.bind(null, { checkoutId: c.id, condition: "", notes: "" })} label={t("operations.equipment.checkIn")} />
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("operations.equipment.checkOut")}</CardTitle></CardHeader>
          <CardBody>
            <OpsForm action={checkOutEquipment} submitLabel={t("operations.equipment.checkOut")} reset fields={[
              { name: "itemId", label: t("operations.equipment.item"), type: "select", required: true, options: activeItems.map((i) => ({ value: i.id, label: i.name })) },
              { name: "quantity", label: t("operations.equipment.quantity"), type: "number", min: 1, defaultValue: 1, required: true },
              { name: "coachId", label: t("operations.equipment.coach"), type: "select", options: [none, ...lookups.coaches.map((c) => ({ value: c.id, label: c.display_name }))] },
              { name: "teamId", label: t("operations.equipment.team"), type: "select", options: [none, ...lookups.teams.map((x) => ({ value: x.id, label: x.name }))] },
              { name: "dueOn", label: t("operations.equipment.due"), type: "date", min: today },
              { name: "notes", label: t("common.notes") },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("operations.equipment.add")}</CardTitle></CardHeader>
          <CardBody>
            <OpsForm action={saveEquipmentItem.bind(null, null)} submitLabel={t("common.add")} reset fields={equipmentFields(t, lookups.venues, null)} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
