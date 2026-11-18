import Link from "next/link";
import { redirect } from "next/navigation";
import { Shirt } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Label, PageHeader, Select } from "@/components/ui";
import { OpsButton, OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { opsDb } from "@/lib/operations/db";
import { loadLookups } from "@/lib/operations/data";
import { findJerseyConflicts, kitStatusCounts, KIT_STATUSES, suggestFreeNumbers } from "@/lib/operations/kit";
import { deleteKitAssignment, invoiceKitDeposit, requestKitSizes, saveKitAssignment, setKitStatus } from "@/lib/actions/operations-equipment";

const NEXT: Record<string, string[]> = {
  sizes_requested: ["ordered"],
  sizes_submitted: ["ordered"],
  ordered: ["handed_out"],
  handed_out: ["returned"],
  returned: ["handed_out"],
};

/** Team kit per season: jersey numbers, sizes from families, hand-out / return, deposits. */
export default async function KitPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const sp = await searchParams;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !me.roles.includes("admin")) redirect("/admin/dashboard");
  const db = await opsDb();
  const lookups = await loadLookups(db, me.orgId);
  const team = lookups.teams.find((x) => x.id === sp.team) ?? lookups.teams[0] ?? null;
  const [{ data: kit }, { data: roster }] = team
    ? await Promise.all([
        db.from("kit_assignments").select("*").eq("org_id", me.orgId).eq("team_id", team.id).order("jersey_number", { nullsFirst: false }).limit(500),
        db.from("team_memberships").select("athlete_id,jersey_number,status").eq("org_id", me.orgId).eq("team_id", team.id).neq("status", "inactive").limit(500),
      ])
    : [{ data: [] }, { data: [] }];
  const athleteIds = Array.from(new Set([...(kit ?? []).map((k) => k.athlete_id), ...(roster ?? []).map((r) => r.athlete_id)]));
  const { data: athletes } = athleteIds.length
    ? await db.from("athletes").select("id,first_name,last_name").eq("org_id", me.orgId).in("id", athleteIds)
    : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const name = new Map((athletes ?? []).map((a) => [a.id, `${a.first_name} ${a.last_name}`]));
  const rows = (kit ?? []).map((k) => ({ id: k.id, teamId: k.team_id, athleteId: k.athlete_id, jerseyNumber: k.jersey_number, status: k.status }));
  const dupes = new Set([...findJerseyConflicts(rows).values()].flat());
  const counts = kitStatusCounts(rows);
  const free = team ? suggestFreeNumbers(rows, team.id, 8) : [];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/operations" className="hover:text-text">{t("operations.hub.title")}</Link>}
        title={t("operations.kit.title")} description={t("operations.kit.description")} />
      {lookups.teams.length === 0 ? <EmptyState icon={<Shirt />} title={t("operations.kit.noTeams")} /> : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="team">{t("operations.equipment.team")}</Label>
              <Select id="team" name="team" defaultValue={team?.id}>
                {lookups.teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </div>
            <Button type="submit" variant="secondary">{t("operations.common.show")}</Button>
          </form>

          <div className="flex flex-wrap gap-2 text-xs">
            {KIT_STATUSES.map((s) => <Badge key={s}>{t.dynamic(`operations.kit.statuses.${s}`)}: {counts[s]}</Badge>)}
          </div>

          <Card>
            <CardHeader><CardTitle>{team?.name}</CardTitle></CardHeader>
            <CardBody className="overflow-x-auto p-0">
              {(kit ?? []).length === 0 ? <p className="p-4 text-sm text-text-muted">{t("operations.kit.empty")}</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-text-muted">
                    <tr><th className="p-3">{t("operations.kit.number")}</th><th className="p-3">{t("operations.kit.player")}</th>
                      <th className="p-3">{t("operations.kit.sizes")}</th><th className="p-3">{t("common.status")}</th>
                      <th className="p-3">{t("operations.kit.deposit")}</th><th className="p-3" /></tr>
                  </thead>
                  <tbody>
                    {(kit ?? []).map((k) => (
                      <tr key={k.id} className="border-t border-border align-top">
                        <td className="p-3 font-mono">{k.jersey_number ?? "—"}{dupes.has(k.id) && <Badge tone="danger" className="ml-1">{t("operations.kit.duplicate")}</Badge>}</td>
                        <td className="p-3">{name.get(k.athlete_id) ?? "—"}</td>
                        <td className="p-3 text-text-secondary">
                          {[k.include_jersey && `${t("operations.kit.jersey")} ${k.jersey_size ?? "?"}`, k.include_shorts && `${t("operations.kit.shorts")} ${k.shorts_size ?? "?"}`,
                            k.include_warmup && `${t("operations.kit.warmup")} ${k.warmup_size ?? "?"}`].filter(Boolean).join(" · ")}
                        </td>
                        <td className="p-3"><Badge tone={k.status === "sizes_requested" ? "warning" : k.status === "handed_out" ? "success" : "neutral"}>{t.dynamic(`operations.kit.statuses.${k.status}`)}</Badge></td>
                        <td className="p-3">
                          {k.deposit_amount ? f.money(k.deposit_amount, k.currency ?? f.currency) : "—"}
                          {k.deposit_invoice_id && <Link href={`/admin/invoices/${k.deposit_invoice_id}`} className="ml-2 text-brand-primary hover:underline">{t("operations.kit.invoice")}</Link>}
                        </td>
                        <td className="flex flex-wrap gap-1 p-3">
                          {NEXT[k.status].map((s) => (
                            <OpsButton key={s} action={setKitStatus.bind(null, { id: k.id, status: s })} label={t.dynamic(`operations.kit.moveTo.${s}`)} />
                          ))}
                          {k.deposit_amount && !k.deposit_invoice_id ? <OpsButton action={invoiceKitDeposit.bind(null, k.id)} label={t("operations.kit.invoiceDeposit")} /> : null}
                          <OpsButton action={deleteKitAssignment.bind(null, k.id)} label={t("common.delete")} variant="ghost" confirm={t("operations.common.confirmDelete")} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

          {team && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>{t("operations.kit.requestTitle")}</CardTitle></CardHeader>
                <CardBody className="space-y-3">
                  <p className="text-sm text-text-muted">{t("operations.kit.requestHelp")}</p>
                  <OpsForm action={requestKitSizes} submitLabel={t("operations.kit.request")} columns={1} fields={[
                    { name: "teamId", label: "", type: "hidden", defaultValue: team.id },
                    { name: "includeWarmup", label: t("operations.kit.includeWarmup"), type: "checkbox" },
                    { name: "depositAmount", label: t("operations.kit.depositAmount", { currency: f.currency }), type: "number", step: "0.01", min: 0 },
                  ]} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader><CardTitle>{t("operations.kit.assign")}</CardTitle></CardHeader>
                <CardBody className="space-y-3">
                  {free.length > 0 && <p className="text-xs text-text-muted">{t("operations.kit.freeNumbers", { numbers: free.join(", ") })}</p>}
                  <OpsForm action={saveKitAssignment.bind(null, null)} submitLabel={t("common.save")} fields={[
                    { name: "teamId", label: "", type: "hidden", defaultValue: team.id },
                    { name: "athleteId", label: t("operations.kit.player"), type: "select", required: true,
                      options: athleteIds.map((id) => ({ value: id, label: name.get(id) ?? id })) },
                    { name: "jerseyNumber", label: t("operations.kit.number"), type: "number", min: 0, max: 999 },
                    { name: "jerseySize", label: t("operations.kit.jerseySize") },
                    { name: "shortsSize", label: t("operations.kit.shortsSize") },
                    { name: "warmupSize", label: t("operations.kit.warmupSize") },
                    { name: "depositAmount", label: t("operations.kit.depositAmount", { currency: f.currency }), type: "number", step: "0.01", min: 0 },
                    { name: "includeJersey", label: t("operations.kit.jersey"), type: "checkbox", defaultValue: true },
                    { name: "includeShorts", label: t("operations.kit.shorts"), type: "checkbox", defaultValue: true },
                    { name: "includeWarmup", label: t("operations.kit.warmup"), type: "checkbox" },
                  ]} />
                </CardBody>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
