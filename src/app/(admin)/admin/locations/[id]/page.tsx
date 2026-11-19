import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardBody, PageHeader } from "@/components/ui";
import { LocationForm, type LocationValue } from "@/components/sports/location-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getLocation } from "@/lib/sports/data";
import { clubMediaUrl } from "@/lib/shop/db";

const EMPTY: LocationValue = {
  name: "", address: "", city: "", postalCode: "", country: "", capacity: "", notes: "", mapUrl: "", latitude: "", longitude: "",
  geofenceRadiusM: "300", hours: {}, isActive: true,
};

/** Create (id = "new") or edit one venue. */
export default async function LocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, { t }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const crumb = <Link href="/admin/locations" className="hover:underline">{t("sports.locations.title")}</Link>;
  if (id === "new") {
    return (
      <div className="animate-fade-up max-w-3xl space-y-5">
        <PageHeader title={t("sports.locations.add")} eyebrow={crumb} />
        <Card><CardBody><LocationForm id={null} initial={EMPTY} photoUrl={null} spaces={[]} /></CardBody></Card>
      </div>
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const found = await getLocation(me.orgId, id);
  if (!found) notFound();
  const v = found.venue;
  const hours = (v.opening_hours && typeof v.opening_hours === "object" && !Array.isArray(v.opening_hours) ? v.opening_hours : {}) as Record<string, [string, string][]>;
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <PageHeader title={v.name} eyebrow={crumb} />
      <Card><CardBody>
        <LocationForm id={v.id} photoUrl={v.photo_path ? clubMediaUrl(v.photo_path) : null} spaces={found.spaces} initial={{
          name: v.name, address: v.address ?? "", city: v.city ?? "", postalCode: v.postal_code ?? "", country: v.country ?? "",
          capacity: v.capacity === null ? "" : String(v.capacity), notes: v.notes ?? "", mapUrl: v.map_url ?? "",
          latitude: v.latitude === null ? "" : String(v.latitude), longitude: v.longitude === null ? "" : String(v.longitude),
          geofenceRadiusM: String(v.geofence_radius_m ?? 300), hours, isActive: v.is_active,
        }} />
      </CardBody></Card>
    </div>
  );
}
