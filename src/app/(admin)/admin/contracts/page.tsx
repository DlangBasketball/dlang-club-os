import Link from "next/link";
import { FilePen } from "lucide-react";
import { Badge, EmptyState, ErrorState, Input, PageHeader, Select } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { listContracts, listTemplates } from "@/lib/contracts/data";
import { FormsNav } from "@/components/forms/forms-nav";
import { contractTone } from "@/components/forms/contract-view";

export const dynamic = "force-dynamic";


/** All contracts of the club, filterable by status, template and text. */
export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ status?: string; template?: string; q?: string }> }) {
  await requireRole(["admin"]);
  const sp = await searchParams;
  const { t, f } = await getI18n();
  const [res, templates] = await Promise.all([
    listContracts({ status: sp.status, templateId: sp.template && /^[0-9a-f-]{36}$/i.test(sp.template) ? sp.template : undefined, q: sp.q }),
    listTemplates(),
  ]);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("forms.contracts.title")} description={t("forms.contracts.description")} />
      <FormsNav active="contracts" />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <Select name="status" defaultValue={sp.status ?? ""} aria-label={t("forms.contracts.status")} className="w-auto">
          <option value="">{t("forms.contracts.allStatuses")}</option>
          {(["issued", "signed", "void"] as const).map((s) => <option key={s} value={s}>{t.dynamic(`forms.contractStatus.${s}`)}</option>)}
        </Select>
        <Select name="template" defaultValue={sp.template ?? ""} aria-label={t("forms.contracts.template")} className="w-auto">
          <option value="">{t("forms.contracts.allTemplates")}</option>
          {(templates.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </Select>
        <Input name="q" defaultValue={sp.q ?? ""} placeholder={t("forms.contracts.search")} aria-label={t("forms.contracts.search")} className="w-56" />
        <button type="submit" className="h-10 rounded border border-line px-4 text-sm text-ink hover:border-maroon">{t("forms.completion.filter")}</button>
      </form>
      {res.error !== null ? <ErrorState title={t("forms.errors.loadFailed")} message={res.error} /> : res.data.length === 0 ? (
        <EmptyState icon={<FilePen className="h-5 w-5" />} title={t("forms.contracts.empty")} description={t("forms.contracts.emptyHint")} />
      ) : (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="px-3 py-2">{t("forms.contracts.contractTitle")}</th>
              <th className="px-3 py-2">{t("forms.contracts.family")}</th>
              <th className="px-3 py-2">{t("forms.contracts.issuedAt")}</th>
              <th className="px-3 py-2">{t("forms.contracts.signedAt")}</th>
              <th className="px-3 py-2">{t("forms.contracts.status")}</th>
            </tr></thead>
            <tbody>
              {res.data.map((c) => (
                <tr key={c.id} className="border-b border-line-soft last:border-0">
                  <td className="px-3 py-2"><Link href={`/admin/contracts/${c.id}`} className="text-ink hover:text-maroon">{c.title}</Link><div className="text-xs text-ink-3">{c.athleteName ?? ""} · v{c.templateVersion}</div></td>
                  <td className="px-3 py-2 text-ink-2">{c.familyName}</td>
                  <td className="px-3 py-2 text-ink-2">{f.date(c.issuedAt)}</td>
                  <td className="px-3 py-2 text-ink-2">{c.signedAt ? f.dateTime(c.signedAt) : "–"}</td>
                  <td className="px-3 py-2"><Badge tone={contractTone(c.status)}>{t.dynamic(`forms.contractStatus.${c.status}`)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
