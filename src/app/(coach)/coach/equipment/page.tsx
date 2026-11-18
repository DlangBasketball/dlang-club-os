import { redirect } from "next/navigation";
import { Boxes } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";
import { availableQuantity, isOverdue } from "@/lib/operations/equipment";
import { CONDITIONS } from "@/lib/operations/validation";
import { checkInEquipment, checkOutEquipment } from "@/lib/actions/operations-equipment";

/**
 * Coach view of club equipment: what is on the shelf, check material out for
 * yourself or a team you coach, and check it back in. Stock and ownership
 * are enforced by the database (equipment_check_out / equipment_check_in).
 */
export default async function CoachEquipmentPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) redirect("/login");
  const db = await opsDb();
  const today = zonedDayKey(new Date(), f.timeZone);
  const { data: coach } = await db.from("coaches").select("id").eq("org_id", me.orgId).eq("profile_id", me.id).maybeSingle();
  const [{ data: items }, { data: mine }, { data: teams }, { data: venues }] = await Promise.all([
    db.from("equipment_items").select("id,name,category,quantity,venue_id,condition").eq("org_id", me.orgId).eq("is_active", true).order("name").limit(1000),
    db.from("equipment_checkouts").select("*").eq("org_id", me.orgId).is("returned_at", null).order("due_on").limit(500),
    coach ? db.from("team_coaches").select("team_id").eq("org_id", me.orgId).eq("coach_id", coach.id) : Promise.resolve({ data: [] as { team_id: string }[] }),
    db.from("venues").select("id,name").eq("org_id", me.orgId),
  ]);
  const teamIds = (teams ?? []).map((x) => x.team_id);
  const { data: teamRows } = teamIds.length ? await db.from("teams").select("id,name").in("id", teamIds) : { data: [] as { id: string; name: string }[] };
  const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));
  const venueName = new Map((venues ?? []).map((v) => [v.id, v.name]));
  // RLS returns every open check-out only to admins; coaches see their own.
  const open = (mine ?? []).filter((c) => me.roles.includes("admin") ? c.coach_id === coach?.id || (c.team_id && teamIds.includes(c.team_id)) : true);
  const allOpen = (mine ?? []).map((c) => ({ id: c.id, itemId: c.item_id, quantity: c.quantity, dueOn: c.due_on, returnedAt: c.returned_at }));

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("operations.equipment.coachTitle")} description={t("operations.equipment.coachDescription")} />
      <Card>
        <CardHeader><CardTitle>{t("operations.equipment.mine")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          {open.length === 0 && <p className="text-sm text-text-muted">{t("operations.equipment.noneOut")}</p>}
          {open.map((c) => (
            <div key={c.id} className="space-y-2 border-b border-border pb-3 last:border-0">
              <p className="text-sm">
                <span className="font-medium">{itemName.get(c.item_id)}</span> × {c.quantity}
                {c.due_on && (isOverdue({ dueOn: c.due_on, returnedAt: c.returned_at }, today)
                  ? <Badge tone="danger" className="ml-2">{t("operations.equipment.overdueSince", { date: f.date(c.due_on) })}</Badge>
                  : <Badge className="ml-2">{t("operations.equipment.dueOn", { date: f.date(c.due_on) })}</Badge>)}
              </p>
              <OpsForm action={checkInEquipment} submitLabel={t("operations.equipment.checkIn")} columns={2} fields={[
                { name: "checkoutId", label: "", type: "hidden", defaultValue: c.id },
                { name: "condition", label: t("operations.equipment.returnCondition"), type: "select", defaultValue: "good",
                  options: CONDITIONS.map((x) => ({ value: x, label: t.dynamic(`operations.conditions.${x}`) })) },
                { name: "notes", label: t("common.notes") },
              ]} />
            </div>
          ))}
        </CardBody>
      </Card>

      {(items ?? []).length === 0 ? <EmptyState icon={<Boxes />} title={t("operations.equipment.empty")} /> : (
        <Card>
          <CardHeader><CardTitle>{t("operations.equipment.checkOut")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <ul className="space-y-1 text-sm">
              {(items ?? []).map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span>{i.name}{i.venue_id ? <span className="text-xs text-text-muted"> · {venueName.get(i.venue_id)}</span> : null}</span>
                  <span className="text-text-muted">{me.roles.includes("admin") ? t("operations.equipment.availableOf", { available: availableQuantity(i.quantity, allOpen, i.id), total: i.quantity }) : t("operations.equipment.totalStock", { total: i.quantity })}</span>
                </li>
              ))}
            </ul>
            <OpsForm action={checkOutEquipment} submitLabel={t("operations.equipment.checkOut")} reset fields={[
              { name: "itemId", label: t("operations.equipment.item"), type: "select", required: true, options: (items ?? []).map((i) => ({ value: i.id, label: i.name })) },
              { name: "quantity", label: t("operations.equipment.quantity"), type: "number", min: 1, defaultValue: 1, required: true },
              { name: "teamId", label: t("operations.equipment.forTeam"), type: "select",
                options: [{ value: "", label: t("operations.equipment.forMe") }, ...(teamRows ?? []).map((x) => ({ value: x.id, label: x.name }))] },
              { name: "dueOn", label: t("operations.equipment.due"), type: "date", min: today },
              { name: "coachId", label: "", type: "hidden" },
              { name: "notes", label: t("common.notes") },
            ]} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
