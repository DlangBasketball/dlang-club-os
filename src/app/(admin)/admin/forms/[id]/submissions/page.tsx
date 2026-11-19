import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Inbox } from "lucide-react";
import { Badge, EmptyState, ErrorState, PageHeader } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listSubmissions } from "@/lib/forms/data";
import { FormsNav } from "@/components/forms/forms-nav";

export const dynamic = "force-dynamic";

export default async function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { t, f } = await getI18n();
  const res = await listSubmissions({ formId: id });
  return (
    <div className="animate-fade-up space-y-5">
      <Link href={`/admin/forms/${id}`} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("forms.submissions.backToForm")}</Link>
      <PageHeader title={t("forms.submissions.title")} />
      <FormsNav active="forms" />
      {res.error !== null ? <ErrorState title={t("forms.errors.loadFailed")} message={res.error} /> : res.data.length === 0 ? (
        <EmptyState icon={<Inbox className="h-5 w-5" />} title={t("forms.submissions.empty")} />
      ) : (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="px-3 py-2">{t("forms.submissions.athlete")}</th>
              <th className="px-3 py-2">{t("forms.submissions.version")}</th>
              <th className="px-3 py-2">{t("forms.submissions.submitted")}</th>
              <th className="px-3 py-2">{t("forms.submissions.validUntil")}</th>
              <th className="px-3 py-2">{t("forms.submissions.status")}</th>
            </tr></thead>
            <tbody>
              {res.data.map((s) => (
                <tr key={s.id} className="border-b border-line-soft last:border-0">
                  <td className="px-3 py-2"><Link href={`/admin/forms/submissions/${s.id}`} className="text-ink hover:text-maroon">{s.athleteName}</Link></td>
                  <td className="px-3 py-2 text-ink-2">{t("forms.list.version", { version: s.version })}</td>
                  <td className="px-3 py-2 text-ink-2">{f.dateTime(s.submittedAt)}</td>
                  <td className="px-3 py-2 text-ink-2">{s.validUntil ? f.date(s.validUntil) : "–"}</td>
                  <td className="px-3 py-2"><Badge tone={s.status === "voided" ? "danger" : "success"}>{t.dynamic(`forms.submissionStatus.${s.status}`)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
