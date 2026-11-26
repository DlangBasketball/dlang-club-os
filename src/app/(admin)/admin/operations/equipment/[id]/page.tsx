import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";
import { loadLookups } from "@/lib/operations/data";
import { equipmentFields } from "@/lib/operations/fields";
import { addMaintenance, saveEquipmentItem } from "@/lib/actions/operations-equipment";

/** One equipment item: edit, expense link, maintenance log and check-out history. */
export default async function EquipmentItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await opsDb();
  const { data: item } = await db.from("equipment_items").select("*").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!item) notFound();
  const [lookups, { data: maintenance }, { data: history }, { data: expenses }] = await Promise.all([
    loadLookups(db, me.orgId),
    db.from("equipment_maintenance").select("*").eq("org_id", me.orgId).eq("item_id", id).order("performed_on", { ascending: false }).limit(200),
    db.from("equipment_checkouts").select("*").eq("org_id", me.orgId).eq("item_id", id).order("checked_out_at", { ascending: false }).limit(100),
    db.from("expenses").select("id,expense_date,amount,currency,description").eq("org_id", me.orgId).is("deleted_at", null)
      .order("expense_date", { ascending: false }).limit(100),
  ]);
  const coachName = new Map(lookups.coaches.map((c) => [c.id, c.display_name]));
  const teamName = new Map(lookups.teams.map((x) => [x.id, x.name]));
  const expenseOptions = [{ value: "", label: t("common.none") },
    ...(expenses ?? []).map((e) => ({ value: e.id, label: `${f.date(e.expense_date)} · ${f.money(e.amount, e.currency)}${e.description ? ` · ${e.description.slice(0, 40)}` : ""}` }))];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/operations/equipment" className="hover:text-text">{t("operations.equipment.title")}</Link>} title={item.name} />
      <Card>
        <CardHeader><CardTitle>{t("operations.common.details")}</CardTitle></CardHeader>
        <CardBody>
          <OpsForm action={saveEquipmentItem.bind(null, item.id)} submitLabel={t("common.save")}
            fields={[...equipmentFields(t, lookups.venues, item), { name: "expenseId", label: t("operations.equipment.expense"), type: "select", defaultValue: item.expense_id, options: expenseOptions }]} />
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("operations.equipment.maintenance")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <ul className="space-y-2 text-sm">
              {(maintenance ?? []).length === 0 && <li className="text-text-muted">{t("operations.equipment.noMaintenance")}</li>}
              {(maintenance ?? []).map((m) => (
                <li key={m.id} className="border-b border-border pb-2 last:border-0">
                  <span className="text-text-muted">{f.date(m.performed_on)}</span> · {m.note}{m.cost !== null ? ` · ${f.money(m.cost, item.currency ?? f.currency)}` : ""}
                </li>
              ))}
            </ul>
            <OpsForm action={addMaintenance} submitLabel={t("common.add")} reset fields={[
              { name: "itemId", label: "", type: "hidden", defaultValue: item.id },
              { name: "performedOn", label: t("common.date"), type: "date", defaultValue: zonedDayKey(new Date(), f.timeZone), required: true },
              { name: "cost", label: t("operations.equipment.cost"), type: "number", step: "0.01", min: 0 },
              { name: "note", label: t("common.notes"), type: "textarea", rows: 2, required: true },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("operations.equipment.history")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {(history ?? []).length === 0 && <li className="text-text-muted">{t("operations.equipment.noneOut")}</li>}
              {(history ?? []).map((c) => (
                <li key={c.id} className="border-b border-border pb-2 last:border-0">
                  {f.date(c.checked_out_at)} · × {c.quantity} · {c.coach_id ? coachName.get(c.coach_id) : c.team_id ? teamName.get(c.team_id) : ""}
                  {" · "}{c.returned_at
                    ? t("operations.equipment.returnedOn", { date: f.date(c.returned_at) }) + (c.return_condition ? ` (${t.dynamic(`operations.conditions.${c.return_condition}`)})` : "")
                    : t("operations.equipment.stillOut")}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
