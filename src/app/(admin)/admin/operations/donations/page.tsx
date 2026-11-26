import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label, PageHeader } from "@/components/ui";
import { OpsButton, OpsForm } from "@/components/operations/ops-form";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { zonedDayKey } from "@/lib/staff/hours";
import { opsDb } from "@/lib/operations/db";
import { campaignProgress, donorYearTotals } from "@/lib/operations/fundraising";
import { CAMPAIGN_STATUSES, DONATION_METHODS } from "@/lib/operations/validation";
import { recordDonation, refundDonation, saveCampaign } from "@/lib/actions/operations-sponsors";

/** Fundraising campaigns, donations and annual donation receipts. */
export default async function DonationsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const db = await opsDb();
  const today = zonedDayKey(new Date(), f.timeZone);
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : Number(today.slice(0, 4));
  const [{ data: campaigns }, { data: donations }, { data: donors }] = await Promise.all([
    db.from("fundraising_campaigns").select("*").eq("org_id", me.orgId).order("created_at", { ascending: false }).limit(200),
    db.from("donations").select("*").eq("org_id", me.orgId).order("donated_on", { ascending: false }).limit(2000),
    db.from("ops_customers").select("id,name,email").eq("org_id", me.orgId).order("name").limit(2000),
  ]);
  const donorName = new Map((donors ?? []).map((d) => [d.id, d.name]));
  const campaignTitle = new Map((campaigns ?? []).map((c) => [c.id, c.title]));
  const like = (donations ?? []).map((d) => ({ amount: Number(d.amount), currency: d.currency, status: d.status, donorId: d.donor_id, donatedOn: d.donated_on, campaignId: d.campaign_id }));
  const yearTotals = donorYearTotals(like, year);
  const campaignOpts = [{ value: "", label: t("operations.donations.general") }, ...(campaigns ?? []).map((c) => ({ value: c.id, label: c.title }))];

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader eyebrow={<Link href="/admin/operations" className="hover:text-text">{t("operations.hub.title")}</Link>}
        title={t("operations.donations.title")} description={t("operations.donations.description")} />

      <Card>
        <CardHeader><CardTitle>{t("operations.campaigns.title")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {(campaigns ?? []).length === 0 && <p className="text-sm text-text-muted">{t("operations.campaigns.empty")}</p>}
          {(campaigns ?? []).map((c) => {
            const p = campaignProgress(Number(c.goal_amount), c.currency, like.filter((d) => d.campaignId === c.id));
            return (
              <div key={c.id} className="space-y-1.5 border-b border-border pb-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{c.title}</span>
                  <span className="flex flex-wrap gap-1.5 text-xs">
                    <Badge tone={c.status === "active" ? "success" : "neutral"}>{t.dynamic(`operations.campaigns.statuses.${c.status}`)}</Badge>
                    {c.is_public && <a href={`/club/donate/${c.slug}`} target="_blank" rel="noopener noreferrer"><Badge tone="info">{t("operations.campaigns.publicPage")}</Badge></a>}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-elevated" role="progressbar" aria-valuenow={p.barPercent} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-brand-primary" style={{ width: `${p.barPercent}%` }} />
                </div>
                <p className="text-sm text-text-muted">
                  {t("operations.campaigns.progress", { raised: f.money(p.raised, c.currency), goal: f.money(p.goal, c.currency), percent: f.number(p.percent), donors: p.donorCount })}
                </p>
              </div>
            );
          })}
          <OpsForm action={saveCampaign.bind(null, null)} submitLabel={t("operations.campaigns.add")} columns={3} reset fields={[
            { name: "title", label: t("operations.common.title"), required: true },
            { name: "slug", label: t("operations.campaigns.slug"), required: true, hint: t("operations.campaigns.slugHint") },
            { name: "goalAmount", label: t("operations.campaigns.goal", { currency: f.currency }), type: "number", step: "0.01", min: 1, required: true },
            { name: "startsOn", label: t("operations.common.from"), type: "date" },
            { name: "endsOn", label: t("operations.common.to"), type: "date" },
            { name: "status", label: t("common.status"), type: "select", options: CAMPAIGN_STATUSES.map((s) => ({ value: s, label: t.dynamic(`operations.campaigns.statuses.${s}`) })) },
            { name: "description", label: t("operations.campaigns.descriptionField"), type: "textarea", rows: 3 },
            { name: "isPublic", label: t("operations.campaigns.isPublic"), type: "checkbox" },
          ]} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t("operations.donations.list")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {(donations ?? []).length === 0 && <li className="text-text-muted">{t("operations.donations.empty")}</li>}
              {(donations ?? []).slice(0, 100).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
                  <span>
                    <span className="text-text-muted">{f.date(d.donated_on)}</span> · {f.money(d.amount, d.currency)} · {d.donor_id ? donorName.get(d.donor_id) : t("operations.donations.unknownDonor")}
                    {d.is_anonymous && <Badge className="ml-1">{t("operations.donations.anonymous")}</Badge>}
                    {d.campaign_id && <span className="text-xs text-text-muted"> · {campaignTitle.get(d.campaign_id)}</span>}
                    {d.status === "refunded" && <Badge tone="danger" className="ml-1">{t("operations.donations.refunded")}</Badge>}
                  </span>
                  {d.status === "received" && <OpsButton action={refundDonation.bind(null, d.id)} label={t("operations.donations.markRefunded")} variant="ghost" confirm={t("operations.common.confirmDelete")} />}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("operations.donations.record")}</CardTitle></CardHeader>
          <CardBody>
            <OpsForm action={recordDonation} submitLabel={t("operations.donations.record")} reset fields={[
              { name: "campaignId", label: t("operations.donations.campaign"), type: "select", options: campaignOpts },
              { name: "donorId", label: t("operations.donations.donor"), type: "select", options: [{ value: "", label: t("operations.donations.newDonor") }, ...(donors ?? []).map((d) => ({ value: d.id, label: d.name }))] },
              { name: "donorName", label: t("operations.donations.donorName") },
              { name: "donorEmail", label: t("common.email"), type: "email" },
              { name: "amount", label: t("common.amount"), type: "number", step: "0.01", min: 0.01, required: true },
              { name: "donatedOn", label: t("common.date"), type: "date", defaultValue: today, required: true },
              { name: "method", label: t("operations.donations.method"), type: "select", options: DONATION_METHODS.map((m) => ({ value: m, label: t.dynamic(`operations.donations.methods.${m}`) })) },
              { name: "purpose", label: t("operations.donations.purpose") },
              { name: "isAnonymous", label: t("operations.donations.anonymousField"), type: "checkbox" },
            ]} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t("operations.receipt.sectionTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-warning">{t("operations.receipt.verify")}</p>
          <form method="get" className="flex items-end gap-2">
            <div>
              <Label htmlFor="year">{t("operations.receipt.year")}</Label>
              <Input id="year" name="year" type="number" min={2000} max={2100} defaultValue={year} className="w-28" />
            </div>
            <Button type="submit" variant="secondary">{t("operations.common.show")}</Button>
          </form>
          <ul className="space-y-1.5 text-sm">
            {yearTotals.length === 0 && <li className="text-text-muted">{t("operations.receipt.none")}</li>}
            {yearTotals.map((r) => (
              <li key={`${r.donorId}:${r.currency}`} className="flex items-center justify-between gap-2">
                <span>{donorName.get(r.donorId) ?? "—"} · {f.money(r.total, r.currency)} ({r.count})</span>
                <a href={`/admin/operations/donations/receipt?donor=${r.donorId}&year=${year}`} className="text-brand-primary hover:underline">{t("operations.receipt.download")}</a>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}
