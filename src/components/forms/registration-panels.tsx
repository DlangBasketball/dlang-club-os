import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { formsDb } from "@/lib/forms/db";
import { getSafetyAnswers } from "@/lib/forms/data";
import { displayAnswer } from "@/lib/forms/logic";
import { answerRows } from "@/lib/registration-form/server";
import { listContracts, listTemplates } from "@/lib/contracts/data";
import { contractTone } from "./contract-view";
import { IssueContractForm } from "./record-actions";

/** Registration detail: custom answers (as asked) + participation contracts. Admins only. */
export async function RegistrationFormsPanels({ registrationId }: { registrationId: string }) {
  const { t, f } = await getI18n();
  const db = await formsDb();
  const [{ data: ans }, contracts, templates] = await Promise.all([
    db.from("registration_answers").select("answers,questions,program_id").eq("registration_id", registrationId).maybeSingle(),
    listContracts({ registrationId }),
    listTemplates(),
  ]);
  const rows = ans ? answerRows(ans.questions, ans.answers) : [];
  const labels = { yes: t("common.yes"), no: t("common.no"), accepted: t("forms.view.accepted") };
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("forms.regForm.answersTitle")}</CardTitle>
          {ans && <Link href={`/admin/forms/export?program=${ans.program_id}`} className="text-xs text-maroon hover:underline">{t("forms.regForm.export")}</Link>}
        </CardHeader>
        <CardBody>
          {rows.length === 0 ? <p className="text-sm text-ink-3">{t("forms.regForm.noAnswers")}</p> : (
            <dl className="divide-y divide-line-soft rounded border border-line text-sm">
              {rows.map((r) => (
                <div key={r.field.id} className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-3">
                  <dt className="text-ink-3">{r.label}</dt>
                  <dd className="whitespace-pre-wrap text-ink sm:col-span-2">{r.field.type === "date" && typeof r.value === "string" ? f.date(r.value) : displayAnswer(r.field, r.value, labels)}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t("forms.contracts.title")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          {(contracts.data ?? []).length === 0 ? <p className="text-sm text-ink-3">{t("forms.contracts.noneForRegistration")}</p> : (
            <ul className="divide-y divide-line-soft text-sm">
              {(contracts.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2">
                  <Link href={`/admin/contracts/${c.id}`} className="text-ink hover:text-maroon">{c.title} · v{c.templateVersion}</Link>
                  <Badge tone={contractTone(c.status)}>{t.dynamic(`forms.contractStatus.${c.status}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
          <IssueContractForm registrationId={registrationId} templates={(templates.data ?? []).filter((x) => x.status === "published").map((x) => ({ id: x.id, name: x.name, version: x.version }))} />
        </CardBody>
      </Card>
    </>
  );
}

/** Coach / admin: the safety-flagged answers of an athlete's valid forms. */
export async function SafetyInfoCard({ athleteId }: { athleteId: string }) {
  const { t, f } = await getI18n();
  const rows = await getSafetyAnswers(athleteId);
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("forms.safety.title")}</CardTitle></CardHeader>
      <CardBody>
        <p className="mb-2 text-xs text-ink-3">{t("forms.safety.hint")}</p>
        <dl className="divide-y divide-line-soft rounded border border-line text-sm">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 gap-1 px-3 py-2 sm:grid-cols-3">
              <dt className="text-ink-3">{r.label}<span className="block text-[11px] text-ink-4">{r.formTitle} · {f.date(r.submittedAt)}</span></dt>
              <dd className="whitespace-pre-wrap text-ink sm:col-span-2">{r.answer}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
