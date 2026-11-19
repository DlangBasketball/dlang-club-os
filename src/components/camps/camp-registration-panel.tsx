import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { ManualDiscountForm } from "@/components/camps/manual-discount-form";
import { campsDb } from "@/lib/camps/db";
import { getI18n } from "@/lib/i18n/server";

type Snapshot = { edition_name?: string | null; starts_on?: string; ends_on?: string; option_label?: string; age_group?: string; includes_lunch?: boolean };

/**
 * Camp details of a registration (edition, option, days, price snapshot,
 * discounts) and, for admin / finance, the manual-discount form.
 * Renders nothing for non-camp registrations.
 */
export async function CampRegistrationPanel({ registrationId, orgId, canDiscount }: { registrationId: string; orgId: string; canDiscount: boolean }) {
  const { t, f } = await getI18n();
  const db = await campsDb();
  const { data: r } = await db.from("registrations")
    .select("id,camp_edition_id,camp_days,camp_includes_lunch,price_list_amount,price_discount_amount,price_amount,price_currency,price_snapshot,status")
    .eq("id", registrationId).eq("org_id", orgId).maybeSingle();
  if (!r?.camp_edition_id) return null;
  const [{ data: applied }, { data: discounts }] = await Promise.all([
    db.from("applied_discounts").select("id,discount_id,name,rule,amount,currency,reason,created_at,voided_at").eq("org_id", orgId).eq("registration_id", registrationId).order("created_at"),
    canDiscount ? db.from("discounts").select("id,name,kind,value,currency,rule").eq("org_id", orgId).eq("is_active", true).order("name") : Promise.resolve({ data: [] as { id: string; name: string; kind: string; value: number | string; currency: string | null; rule: string }[] }),
  ]);
  const snap = (r.price_snapshot ?? {}) as Snapshot;
  const cur = r.price_currency ?? f.currency;
  const money = (n: number | string | null) => f.money(Number(n ?? 0), cur);
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 border-b border-line-soft py-2 text-sm last:border-0"><span className="text-ink-3">{label}</span><span className="text-right text-ink">{value}</span></div>
  );
  const usable = (discounts ?? []).filter((d) => !(applied ?? []).some((a) => a.discount_id === d.id && !a.voided_at))
    .map((d) => ({ id: d.id, label: `${d.name} · ${d.kind === "percent" ? f.percent(Number(d.value) / 100, 2) : f.money(Number(d.value), d.currency ?? cur)}` }));

  return (
    <Card>
      <CardHeader><CardTitle>{t("camps.registration.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-4">
        <div>
          {row(t("camps.registration.edition"), `${snap.edition_name ? `${snap.edition_name} · ` : ""}${snap.starts_on ? f.dateRange(snap.starts_on, snap.ends_on ?? snap.starts_on) : ""}`)}
          {row(t("camps.export.option"), snap.option_label ?? "—")}
          {row(t("camps.register.ageGroup"), snap.age_group ?? "—")}
          {row(t("camps.export.days"), (r.camp_days ?? []).map((d: string) => f.date(d, { weekday: true, style: "short" })).join(", "))}
          {row(t("camps.register.lunch"), r.camp_includes_lunch ? t("common.yes") : t("common.no"))}
          {row(t("camps.export.listAmount"), <span className="tnum">{money(r.price_list_amount)}</span>)}
          {(applied ?? []).map((a) => <div key={a.id}>{row(`${a.name}${a.voided_at ? ` (${t("camps.registration.voided")})` : ""}`, <span className="tnum text-success">{`– ${money(a.amount)}`}</span>)}</div>)}
          {row(t("common.total"), <span className="tnum font-semibold">{money(r.price_amount)}</span>)}
        </div>
        {canDiscount && r.status !== "cancelled" && (
          <div className="space-y-2 border-t border-line pt-3">
            <div className="text-sm font-medium text-ink">{t("camps.manual.title")}</div>
            <ManualDiscountForm registrationId={registrationId} discounts={usable} />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
