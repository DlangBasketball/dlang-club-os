import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import type { CampAdminData } from "@/lib/camps/data";
import { getI18n } from "@/lib/i18n/server";

const TONE = { draft: "warning", published: "success", archived: "neutral", cancelled: "danger" } as const;

/** Read-only camp overview (finance / coaches): editions, prices, age groups. */
export async function CampSummaryView({ programId, data, currency }: { programId: string; data: CampAdminData; currency: string }) {
  const { t, f } = await getI18n();
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>{t("camps.editions.title")}</CardTitle></CardHeader>
        <CardBody className="space-y-2">
          {data.editions.length === 0 && <p className="text-sm text-ink-3">{t("camps.editions.empty")}</p>}
          {data.editions.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft py-2 text-sm last:border-0">
              <div>
                <Link href={`/admin/programs/${programId}/editions/${e.id}`} className="font-medium text-ink hover:text-maroon">{e.name || f.dateRange(e.startsOn, e.endsOn)}</Link>
                <div className="text-xs text-ink-3">{f.dateRange(e.startsOn, e.endsOn)}{e.venue ? ` · ${e.venue.name}` : e.city ? ` · ${e.city}` : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="tnum text-xs text-ink-2">{e.capacity !== null ? t("camps.editions.capacityLine", { taken: e.taken, capacity: e.capacity, left: e.spotsLeft ?? 0 }) : t("camps.editions.registeredLine", { taken: e.taken })}</span>
                <Badge tone={TONE[e.status]}>{t(`camps.editionStatus.${e.status}`)}</Badge>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("camps.options.title")}</CardTitle></CardHeader>
        <CardBody className="space-y-1 text-sm">
          {data.options.filter((o) => o.isActive).map((o) => (
            <div key={o.id} className="flex justify-between"><span className="text-ink-2">{o.label}</span><span className="tnum text-ink">{f.money(o.price, o.currency ?? currency)}</span></div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("camps.ageGroups.title")}</CardTitle></CardHeader>
        <CardBody className="space-y-1 text-sm">
          {data.ageGroups.map((g) => {
            const s = data.timeSlots.find((x) => x.id === g.timeSlotId);
            return <div key={g.id} className="flex justify-between"><span className="text-ink-2">{g.label}</span><span className="text-ink-3">{s ? `${s.label} · ${s.startsAt}–${s.endsAt}` : ""}</span></div>;
          })}
        </CardBody>
      </Card>
    </div>
  );
}
