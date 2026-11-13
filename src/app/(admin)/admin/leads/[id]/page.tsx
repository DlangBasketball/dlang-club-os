import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { LeadActions } from "@/components/messaging/leads";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getLead } from "@/lib/messaging/data";
import { uuid } from "@/lib/messaging/validation";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("messaging.leads.title") };
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const [{ t, f }, data] = await Promise.all([getI18n(), getLead(id)]);
  if (!data) notFound();
  const { lead, replies, programName } = data;
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        eyebrow={<Link href="/admin/leads" className="inline-flex items-center gap-1 hover:text-text"><ArrowLeft className="h-3.5 w-3.5" /> {t("messaging.leads.title")}</Link>}
        title={lead.name}
        description={f.dateTime(lead.created_at, "medium")}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{t("messaging.leads.details")}</CardTitle></CardHeader>
            <CardBody className="space-y-3 text-sm">
              <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2">
                <dt className="text-text-muted">{t("messaging.contact.email")}</dt>
                <dd><a className="text-brand-primary underline-offset-4 hover:underline" href={`mailto:${lead.email}`}>{lead.email}</a></dd>
                {lead.phone && <><dt className="text-text-muted">{t("messaging.contact.phone")}</dt><dd>{lead.phone}</dd></>}
                <dt className="text-text-muted">{t("messaging.contact.interest")}</dt>
                <dd><Badge tone="neutral">{t(`messaging.leads.interest.${lead.interest}`)}</Badge>{programName ? ` · ${programName}` : ""}</dd>
                {lead.source_page && <><dt className="text-text-muted">{t("messaging.leads.source")}</dt><dd className="break-all">{lead.source_page}</dd></>}
                <dt className="text-text-muted">{t("messaging.leads.consent")}</dt>
                <dd>{t("messaging.leads.consentGiven", { date: f.dateTime(lead.consent_at, "short") })}</dd>
              </dl>
              <blockquote className="whitespace-pre-wrap rounded-md border border-border bg-surface p-3 text-text">{lead.message}</blockquote>
            </CardBody>
          </Card>
          {replies.length > 0 && (
            <Card className="p-0">
              <CardHeader><CardTitle>{t("messaging.leads.replies")}</CardTitle></CardHeader>
              <ul className="divide-y divide-border">
                {replies.map((r) => (
                  <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
                    <div className="text-xs text-text-muted">
                      {r.authorName ?? t("messaging.common.someone")} · {f.dateTime(r.created_at, "short")} · {r.email_sent ? t("messaging.leads.emailSent") : t("messaging.leads.emailNotSent")}
                    </div>
                    <p className="whitespace-pre-wrap text-text">{r.body}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <LeadActions leadId={lead.id} status={lead.status} familyId={lead.family_id} />
      </div>
    </div>
  );
}
