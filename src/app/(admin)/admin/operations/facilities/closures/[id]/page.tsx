import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { OpsButton } from "@/components/operations/ops-form";
import { ClosureApply, type ClosureItemView } from "@/components/operations/closure-apply";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { opsDb } from "@/lib/operations/db";
import { loadClosureImpact } from "@/lib/operations/data";
import { IMPACT_KINDS } from "@/lib/operations/facilities";
import { applyClosure, deleteClosure } from "@/lib/actions/operations-facilities";

/** A venue closure: what it touches, and the one-step cancel / move / notify. */
export default async function ClosurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = await opsDb();
  const { data: c } = await db.from("venue_closures").select("*").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!c) notFound();
  const [{ data: venues }, impact] = await Promise.all([
    db.from("venues").select("id,name").eq("org_id", me.orgId).eq("is_active", true).order("name"),
    loadClosureImpact(db, me.orgId, { venueId: c.venue_id, spaceId: c.venue_space_id, startsOn: c.starts_on, endsOn: c.ends_on }, f.timeZone),
  ]);
  const venueName = (venues ?? []).find((v) => v.id === c.venue_id)?.name ?? "";
  const actionable: ClosureItemView[] = impact.items
    .filter((i): i is typeof i & { kind: ClosureItemView["kind"] } => i.kind !== "allocation")
    .map((i) => ({ kind: i.kind, id: i.id, label: i.label, when: i.allDay ? f.dateRange(i.start, i.end) : f.dateRange(i.start, i.end, "short") }));
  const slots = impact.items.filter((i) => i.kind === "allocation");
  const summary = c.summary as { op?: string; changed?: number; skipped?: number; notified?: number } | null;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/operations/facilities" className="hover:text-text">{t("operations.facilities.title")}</Link>}
        title={t("operations.closures.pageTitle", { venue: venueName })}
        description={`${f.dateRange(c.starts_on, c.ends_on)} · ${t.dynamic(`operations.closures.reasons.${c.reason}`)}${c.note ? ` · ${c.note}` : ""}`}
        actions={!c.applied_at ? <OpsButton action={deleteClosure.bind(null, c.id)} label={t("common.delete")} variant="ghost" confirm={t("operations.common.confirmDelete")} redirectTo="/admin/operations/facilities" /> : undefined} />

      <div className="flex flex-wrap gap-2 text-xs">
        {IMPACT_KINDS.map((k) => <Badge key={k} tone={impact.counts[k] ? "warning" : "neutral"}>{t.dynamic(`operations.conflicts.kinds.${k}`)}: {impact.counts[k]}</Badge>)}
      </div>
      {summary && (
        <p className="text-sm text-text-muted">
          {t("operations.closures.lastRun", { date: f.dateTime(c.applied_at ?? c.updated_at), changed: summary.changed ?? 0, skipped: summary.skipped ?? 0, notified: summary.notified ?? 0 })}
        </p>
      )}

      <Card>
        <CardHeader><CardTitle>{t("operations.closures.affected")}</CardTitle></CardHeader>
        <CardBody>
          {actionable.length === 0 && slots.length === 0 && <p className="mb-4 text-sm text-text-muted">{t("operations.closures.nothing")}</p>}
          <ClosureApply closureId={c.id} items={actionable} action={applyClosure}
            venues={(venues ?? []).filter((v) => v.id !== c.venue_id).map((v) => ({ value: v.id, label: v.name }))} />
        </CardBody>
      </Card>

      {slots.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("operations.closures.weeklySlots")}</CardTitle></CardHeader>
          <CardBody>
            <p className="mb-2 text-sm text-text-muted">{t("operations.closures.weeklyHelp")}</p>
            <ul className="space-y-1 text-sm">
              {slots.map((s) => <li key={s.id}>{s.label} · {f.dateRange(s.start, s.end, "short")}</li>)}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
