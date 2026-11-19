import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, type BadgeProps } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { accountingDb } from "@/lib/accounting/db";
import { listCancellable, listRefundRequests } from "@/lib/accounting/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.cancel.title") };
}

const TONE: Record<string, BadgeProps["tone"]> = { requested: "warning", processing: "info", stripe_failed: "warning", completed: "success", rejected: "neutral" };

/** Parent: cancel a registration / booking (refund shown before confirming) and follow the requests. Own family only (RLS). */
export default async function ParentRefundsPage() {
  const [me, { t, f }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId) redirect("/login");
  const db = await accountingDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", me.id);
  const familyIds = (links ?? []).map((l) => l.family_id);
  const [cancellable, requests] = await Promise.all([listCancellable(me.orgId, familyIds), listRefundRequests(me.orgId, { familyIds })]);

  return (
    <div className="animate-fade-up max-w-3xl space-y-6">
      <PageHeader title={t("accounting.cancel.title")} description={t("accounting.cancel.description")} />
      <Card>
        <CardHeader><CardTitle>{t("accounting.cancel.cancellableTitle")}</CardTitle></CardHeader>
        <CardBody>
          {cancellable.length === 0 ? <p className="text-sm text-ink-3">{t("accounting.cancel.cancellableEmpty")}</p> : (
            <ul className="divide-y divide-line-soft">
              {cancellable.map((c) => (
                <li key={`${c.kind}-${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <div className="text-ink">{c.label}</div>
                    <div className="text-xs text-ink-3">{c.athlete}{c.startsOn ? ` · ${f.date(c.startsOn)}` : ""}</div>
                  </div>
                  <Link href={`/parent/refunds/cancel?${c.kind}=${c.id}`} className="text-sm text-maroon hover:underline">{t("accounting.cancel.cancel")}</Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <section aria-labelledby="my-req" className="space-y-2">
        <h2 id="my-req" className="font-display text-lg text-ink">{t("accounting.cancel.myRequests")}</h2>
        {(requests.data ?? []).length === 0 ? (
          <EmptyState title={t("accounting.cancel.requestsEmpty")} />
        ) : (requests.data ?? []).map((r) => (
          <Card key={r.id}>
            <CardBody className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div>
                <div className="text-ink">{r.subject ?? r.invoiceNumber ?? "—"}</div>
                <div className="text-xs text-ink-3">{t("accounting.refunds.requestedOn", { date: f.date(r.requested_at) })}
                  {r.iban_last4 ? ` · ${t("accounting.refunds.ibanLast4", { last4: r.iban_last4 })}` : ""}</div>
                {r.rejected_reason && <div className="mt-1 text-xs text-ink-2">{r.rejected_reason}</div>}
              </div>
              <div className="text-right">
                <Badge tone={TONE[r.status]}>{t(`accounting.cancel.statuses.${r.status}`)}</Badge>
                <div className="tnum mt-1 text-sm text-ink">{f.money(Number(r.payout_amount ?? r.final_amount ?? r.computed_amount), r.currency)}</div>
                {r.resolution && r.resolution !== "none" && <div className="text-xs text-ink-3">{t.dynamic(`accounting.refunds.resolutions.${r.resolution}`)}</div>}
              </div>
            </CardBody>
          </Card>
        ))}
      </section>
    </div>
  );
}
