import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { OpsButton, OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { addDayKey, isoWeekdayName, zonedDayKey } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";
import { loadAllocations, loadLookups, spaceOptions } from "@/lib/operations/data";
import { allocationClashes } from "@/lib/operations/facilities";
import { CLOSURE_REASONS, RENTAL_STATUSES } from "@/lib/operations/validation";
import {
  createClosure,
  deleteAllocation,
  generateEventsFromAllocation,
  invoiceRental,
  saveAllocation,
  saveRental,
} from "@/lib/actions/operations-facilities";

/** Court time per venue, external rentals and venue closures. */
export default async function FacilitiesPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const db = await opsDb();
  const today = zonedDayKey(new Date(), f.timeZone);
  const [lookups, allocations, { data: rentals }, { data: closures }, { data: customers }] = await Promise.all([
    loadLookups(db, me.orgId),
    loadAllocations(db, me.orgId),
    db.from("facility_rentals").select("*").eq("org_id", me.orgId).gte("ends_at", new Date(Date.now() - 30 * 864e5).toISOString()).order("starts_at").limit(300),
    db.from("venue_closures").select("*").eq("org_id", me.orgId).gte("ends_on", addDayKey(today, -60)).order("starts_on").limit(100),
    db.from("ops_customers").select("id,name").eq("org_id", me.orgId).order("name").limit(500),
  ]);
  const venueName = new Map(lookups.venues.map((v) => [v.id, v.name]));
  const spaceName = new Map(lookups.spaces.map((s) => [s.id, s.name]));
  const clashes = allocationClashes(allocations);
  const none = { value: "", label: t("common.none") };
  const venueOpts = lookups.venues.map((v) => ({ value: v.id, label: v.name }));
  const spaceOpts = [{ value: "", label: t("operations.facilities.wholeVenue") }, ...spaceOptions(lookups)];
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: String(d), label: isoWeekdayName(f.locale, d) }));
  const byVenue = new Map<string, typeof allocations>();
  for (const a of allocations) byVenue.set(a.venueId, [...(byVenue.get(a.venueId) ?? []), a]);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/operations" className="hover:text-text">{t("operations.hub.title")}</Link>}
        title={t("operations.facilities.title")} description={t("operations.facilities.description")} />

      <Card>
        <CardHeader><CardTitle>{t("operations.facilities.allocations")}</CardTitle></CardHeader>
        <CardBody className="space-y-5">
          {allocations.length === 0 && <p className="text-sm text-text-muted">{t("operations.facilities.noAllocations")}</p>}
          {[...byVenue].map(([venueId, list]) => (
            <div key={venueId}>
              <p className="mb-2 font-medium">{venueName.get(venueId) ?? "—"}</p>
              <ul className="space-y-1.5 text-sm">
                {list.sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime)).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5 last:border-0">
                    <span>
                      <span className="inline-block w-28 text-text-muted">{isoWeekdayName(f.locale, a.weekday)}</span>
                      {a.startTime.slice(0, 5)}–{a.endTime.slice(0, 5)} · <span className="font-medium">{a.label}</span>
                      {a.spaceId ? ` · ${spaceName.get(a.spaceId) ?? ""}` : ` · ${t("operations.facilities.wholeVenue")}`}
                      <span className="ml-2 text-xs text-text-muted">{f.date(a.validFrom)}{a.validUntil ? ` – ${f.date(a.validUntil)}` : ""}</span>
                      {clashes.has(a.id) && <Badge tone="danger" className="ml-2">{t("operations.facilities.clash")}</Badge>}
                    </span>
                    <OpsButton action={deleteAllocation.bind(null, a.id)} label={t("operations.facilities.end")} variant="ghost" confirm={t("operations.common.confirmDelete")} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("operations.facilities.addAllocation")}</CardTitle></CardHeader>
          <CardBody>
            <OpsForm action={saveAllocation.bind(null, null)} submitLabel={t("common.add")} fields={[
              { name: "venueId", label: t("operations.facilities.venue"), type: "select", required: true, options: venueOpts },
              { name: "spaceId", label: t("operations.facilities.court"), type: "select", options: spaceOpts },
              { name: "teamId", label: t("operations.equipment.team"), type: "select", options: [none, ...lookups.teams.map((x) => ({ value: x.id, label: x.name }))] },
              { name: "label", label: t("operations.facilities.label"), hint: t("operations.facilities.labelHint") },
              { name: "weekday", label: t("operations.facilities.weekday"), type: "select", options: weekdays },
              { name: "startTime", label: t("operations.facilities.start"), type: "time", required: true },
              { name: "endTime", label: t("operations.facilities.endTime"), type: "time", required: true },
              { name: "validFrom", label: t("operations.facilities.validFrom"), type: "date", defaultValue: today, required: true },
              { name: "validUntil", label: t("operations.facilities.validUntil"), type: "date" },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("operations.facilities.generate")}</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-text-muted">{t("operations.facilities.generateHelp")}</p>
            <OpsForm action={generateEventsFromAllocation} submitLabel={t("operations.facilities.generateSubmit")} fields={[
              { name: "allocationId", label: t("operations.facilities.allocation"), type: "select", required: true, wide: true,
                options: allocations.filter((a) => a.teamId).map((a) => ({ value: a.id, label: `${a.label} · ${isoWeekdayName(f.locale, a.weekday)} ${a.startTime.slice(0, 5)} · ${venueName.get(a.venueId) ?? ""}` })) },
              { name: "from", label: t("operations.common.from"), type: "date", defaultValue: today, required: true },
              { name: "to", label: t("operations.common.to"), type: "date", defaultValue: addDayKey(today, 28), required: true },
            ]} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("operations.rentals.title")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <ul className="space-y-2 text-sm">
            {(rentals ?? []).length === 0 && <li className="text-text-muted">{t("operations.rentals.empty")}</li>}
            {(rentals ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                <span>
                  <span className="font-medium">{r.renter_name}</span> · {venueName.get(r.venue_id) ?? ""}{r.venue_space_id ? ` · ${spaceName.get(r.venue_space_id) ?? ""}` : ""}
                  {" · "}{f.dateRange(r.starts_at, r.ends_at, "short")} · {f.money(r.price, r.currency)}
                  <Badge className="ml-2" tone={r.status === "cancelled" ? "danger" : r.status === "tentative" ? "warning" : "success"}>{t.dynamic(`operations.rentals.statuses.${r.status}`)}</Badge>
                  {r.invoice_id && <Link href={`/admin/operations/invoices/${r.invoice_id}/pdf`} className="ml-2 text-brand-primary hover:underline">{t("operations.kit.invoice")}</Link>}
                </span>
                {!r.invoice_id && r.status !== "cancelled" && r.price > 0 && <OpsButton action={invoiceRental.bind(null, r.id)} label={t("operations.rentals.invoice")} />}
              </li>
            ))}
          </ul>
          <OpsForm action={saveRental.bind(null, null)} submitLabel={t("operations.rentals.add")} columns={3} fields={[
            { name: "venueId", label: t("operations.facilities.venue"), type: "select", required: true, options: venueOpts },
            { name: "spaceId", label: t("operations.facilities.court"), type: "select", options: spaceOpts },
            { name: "customerId", label: t("operations.rentals.customer"), type: "select", options: [{ value: "", label: t("operations.rentals.newCustomer") }, ...(customers ?? []).map((c) => ({ value: c.id, label: c.name }))] },
            { name: "renterName", label: t("operations.rentals.renter"), required: true },
            { name: "contactEmail", label: t("common.email"), type: "email" },
            { name: "contactPhone", label: t("common.phone") },
            { name: "date", label: t("common.date"), type: "date", required: true, defaultValue: today },
            { name: "startTime", label: t("operations.facilities.start"), type: "time", required: true },
            { name: "endTime", label: t("operations.facilities.endTime"), type: "time", required: true },
            { name: "price", label: t("operations.rentals.price", { currency: f.currency }), type: "number", step: "0.01", min: 0, defaultValue: 0 },
            { name: "status", label: t("common.status"), type: "select", defaultValue: "confirmed",
              options: RENTAL_STATUSES.map((s) => ({ value: s, label: t.dynamic(`operations.rentals.statuses.${s}`) })) },
            { name: "notes", label: t("common.notes") },
          ]} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("operations.closures.title")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-text-muted">{t("operations.closures.help")}</p>
          <ul className="space-y-2 text-sm">
            {(closures ?? []).length === 0 && <li className="text-text-muted">{t("operations.closures.empty")}</li>}
            {(closures ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 border-b border-border pb-2 last:border-0">
                <Link href={`/admin/operations/facilities/closures/${c.id}`} className="font-medium hover:text-brand-primary">
                  {venueName.get(c.venue_id) ?? "—"}{c.venue_space_id ? ` · ${spaceName.get(c.venue_space_id) ?? ""}` : ""}
                </Link>
                <span>{f.dateRange(c.starts_on, c.ends_on)}</span>
                <Badge tone={c.reason === "emergency" ? "danger" : "info"}>{t.dynamic(`operations.closures.reasons.${c.reason}`)}</Badge>
                {c.applied_at ? <Badge tone="success">{t("operations.closures.applied")}</Badge> : <Badge tone="warning">{t("operations.closures.pending")}</Badge>}
              </li>
            ))}
          </ul>
          <OpsForm action={createClosure} submitLabel={t("operations.closures.create")} redirectTo="/admin/operations/facilities/closures/{id}" columns={3} fields={[
            { name: "venueId", label: t("operations.facilities.venue"), type: "select", required: true, options: venueOpts },
            { name: "spaceId", label: t("operations.facilities.court"), type: "select", options: spaceOpts },
            { name: "reason", label: t("operations.closures.reason"), type: "select", options: CLOSURE_REASONS.map((r) => ({ value: r, label: t.dynamic(`operations.closures.reasons.${r}`) })) },
            { name: "startsOn", label: t("operations.common.from"), type: "date", required: true, defaultValue: today },
            { name: "endsOn", label: t("operations.common.to"), type: "date", required: true, defaultValue: today },
            { name: "note", label: t("common.notes") },
          ]} />
        </CardBody>
      </Card>
    </div>
  );
}
