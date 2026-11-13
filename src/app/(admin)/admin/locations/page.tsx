import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, Plus } from "lucide-react";
import { Badge, Card, CardBody, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listLocations } from "@/lib/sports/data";
import { mapLinkFor } from "@/lib/sports/locations";
import { clubMediaUrl } from "@/lib/shop/db";

/** All club venues in one place (replaces the scattered venue editors). */
export default async function LocationsPage() {
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const venues = await listLocations(me.orgId);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("sports.locations.title")} description={t("sports.locations.description")}
        actions={<Link href="/admin/locations/new" className={buttonVariants({ size: "sm" })}><Plus className="h-4 w-4" aria-hidden /> {t("sports.locations.add")}</Link>} />
      {venues.length === 0 ? <EmptyState icon={<MapPin />} title={t("sports.locations.empty")} /> : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {venues.map((v) => {
            const map = mapLinkFor({ mapUrl: v.map_url, latitude: v.latitude, longitude: v.longitude, address: v.address, city: v.city, postalCode: v.postal_code });
            return (
              <li key={v.id}>
                <Card className="h-full overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {v.photo_path && <img src={clubMediaUrl(v.photo_path)} alt="" className="h-28 w-full object-cover" />}
                  <CardBody className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/admin/locations/${v.id}`} className="font-medium hover:text-brand-primary">{v.name}</Link>
                      {!v.is_active && <Badge>{t("sports.inactive")}</Badge>}
                    </div>
                    <p className="text-sm text-text-muted">{[v.address, [v.postal_code, v.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || t("sports.locations.noAddress")}</p>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {v.opening_hours ? <Badge tone="info">{t("sports.locations.hasHours")}</Badge> : null}
                      {v.latitude !== null ? <Badge tone="success">{t("sports.locations.hasGeofence")}</Badge> : null}
                      {v.capacity ? <Badge>{t("sports.locations.capacityShort", { count: v.capacity })}</Badge> : null}
                    </div>
                    <div className="flex gap-3 text-sm">
                      <Link href={`/admin/locations/${v.id}`} className="text-brand-primary hover:underline">{t("common.edit")}</Link>
                      {map && <a href={map} target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline">{t("sports.locations.openMap")}</a>}
                    </div>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
