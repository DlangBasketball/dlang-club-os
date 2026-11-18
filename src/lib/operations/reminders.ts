import "server-only";
import { logError } from "@/lib/log";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsAdminDb } from "./db";
import { addDayKey } from "@/lib/staff/hours";
import { reminderDue, sponsorRenewalDue } from "./equipment";
import { adminProfileIds, coachProfileIds, notifyProfiles } from "./notify";

/**
 * Daily operations reminders, per club (service role, always by org_id):
 *   * equipment overdue -> the coach holding it (or the team's coaches) and
 *     the admins, at most every 3 days per check-out
 *   * sponsor contracts inside their renewal window -> admins, once
 *   * sponsor deliverables due within 7 days and not done -> admins
 */
export async function runOperationsReminders(now = new Date()): Promise<{ equipment: number; renewals: number; deliverables: number }> {
  const db = opsAdminDb();
  const out = { equipment: 0, renewals: 0, deliverables: 0 };
  const { data: orgs } = await db.from("organizations").select("id,timezone").limit(5000);
  for (const org of (orgs ?? []) as { id: string; timezone: string | null }[]) {
    try {
      const today = zonedDayKey(now, org.timezone || "Europe/Zurich");
      const admins = await adminProfileIds(org.id);

      // ---- Equipment overdue ------------------------------------------------
      const { data: overdue } = await db.from("equipment_checkouts").select("id,item_id,quantity,coach_id,team_id,due_on,last_reminded_at")
        .eq("org_id", org.id).is("returned_at", null).lt("due_on", today).limit(500);
      const due = (overdue ?? []).filter((c) => reminderDue(c.last_reminded_at, now));
      if (due.length) {
        const itemIds = Array.from(new Set(due.map((c) => c.item_id)));
        const { data: items } = await db.from("equipment_items").select("id,name").eq("org_id", org.id).in("id", itemIds);
        const itemName = new Map((items ?? []).map((i) => [i.id, i.name]));
        for (const c of due) {
          let coachIds = c.coach_id ? [c.coach_id] : [];
          if (!coachIds.length && c.team_id) {
            const { data: tc } = await db.from("team_coaches").select("coach_id").eq("org_id", org.id).eq("team_id", c.team_id);
            coachIds = (tc ?? []).map((x) => x.coach_id);
          }
          const holders = await coachProfileIds(org.id, coachIds);
          const name = itemName.get(c.item_id) ?? "";
          await notifyProfiles(org.id, holders, (t, f) => ({
            title: t("operations.notify.overdueTitle", { item: name }),
            body: t("operations.notify.overdueBody", { quantity: c.quantity, date: f.date(c.due_on as string) }),
            link: "/coach/equipment",
          }));
          await notifyProfiles(org.id, admins.filter((a) => !holders.includes(a)), (t, f) => ({
            title: t("operations.notify.overdueTitle", { item: name }),
            body: t("operations.notify.overdueBody", { quantity: c.quantity, date: f.date(c.due_on as string) }),
            link: "/admin/operations/equipment",
          }));
          await db.from("equipment_checkouts").update({ last_reminded_at: now.toISOString() }).eq("id", c.id).eq("org_id", org.id);
          out.equipment += 1;
        }
      }

      // ---- Sponsor renewals -------------------------------------------------
      const { data: sponsors } = await db.from("sponsors").select("id,customer_id,status,contract_end,renewal_reminder_days,renewal_reminded_at")
        .eq("org_id", org.id).eq("status", "active").is("renewal_reminded_at", null).not("contract_end", "is", null).limit(500);
      const renew = (sponsors ?? []).filter((s) => sponsorRenewalDue({ status: s.status, contractEnd: s.contract_end, reminderDays: s.renewal_reminder_days }, today));
      if (renew.length) {
        const { data: customers } = await db.from("ops_customers").select("id,name").eq("org_id", org.id).in("id", renew.map((s) => s.customer_id));
        const cname = new Map((customers ?? []).map((c) => [c.id, c.name]));
        for (const s of renew) {
          await notifyProfiles(org.id, admins, (t, f) => ({
            title: t("operations.notify.renewalTitle", { sponsor: cname.get(s.customer_id) ?? "" }),
            body: t("operations.notify.renewalBody", { date: f.date(s.contract_end as string) }),
            link: `/admin/operations/sponsors/${s.id}`,
          }), "payment");
          await db.from("sponsors").update({ renewal_reminded_at: now.toISOString() }).eq("id", s.id).eq("org_id", org.id);
          out.renewals += 1;
        }
      }

      // ---- Deliverables due within a week ----------------------------------------
      const { data: deliverables } = await db.from("sponsor_deliverables").select("id,sponsor_id,title,due_on")
        .eq("org_id", org.id).is("done_at", null).eq("due_on", addDayKey(today, 7)).limit(500);
      for (const d of deliverables ?? []) {
        await notifyProfiles(org.id, admins, (t, f) => ({
          title: t("operations.notify.deliverableTitle", { title: d.title }),
          body: t("operations.notify.deliverableBody", { date: f.date(d.due_on as string) }),
          link: `/admin/operations/sponsors/${d.sponsor_id}`,
        }));
        out.deliverables += 1;
      }
    } catch (e) {
      logError("operations.reminders", e, { org: org.id });
    }
  }
  return out;
}
