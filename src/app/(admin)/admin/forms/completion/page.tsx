import { ClipboardCheck } from "lucide-react";
import { EmptyState, ErrorState, PageHeader, Select } from "@/components/ui";
import { requireRole } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getCompletion, loadTargets } from "@/lib/forms/data";
import { formsDb } from "@/lib/forms/db";
import { FormsNav } from "@/components/forms/forms-nav";
import { CompletionTable } from "@/components/forms/completion-table";
import { ReminderButton } from "@/components/forms/assignment-manager";

export const dynamic = "force-dynamic";

/** Completion dashboard: every active assignment, filterable by programme / camp. */
export default async function CompletionPage({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const me = await requireRole(["admin"]);
  const { program } = await searchParams;
  const programId = program && /^[0-9a-f-]{36}$/i.test(program) ? program : undefined;
  const { t } = await getI18n();
  const [res, targets] = await Promise.all([getCompletion({ programId }), loadTargets(await formsDb(), me.orgId!)]);
  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={t("forms.completion.title")} description={t("forms.completion.description")} actions={<ReminderButton formId={null} />} />
      <FormsNav active="completion" />
      <form className="flex flex-wrap items-end gap-2" method="get">
        <div>
          <label htmlFor="cp-prog" className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("forms.completion.programme")}</label>
          <Select id="cp-prog" name="program" defaultValue={programId ?? ""}>
            <option value="">{t("forms.completion.allProgrammes")}</option>
            {targets.programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <button type="submit" className="h-10 rounded border border-line px-4 text-sm text-ink hover:border-maroon">{t("forms.completion.filter")}</button>
      </form>
      {res.error !== null ? <ErrorState title={t("forms.errors.loadFailed")} message={res.error} /> : res.data.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title={t("forms.completion.empty")} description={t("forms.completion.emptyHint")} />
      ) : <CompletionTable rows={res.data} showForm />}
    </div>
  );
}
