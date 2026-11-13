import { Paperclip } from "lucide-react";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";
import { allFields, type FieldDef, type FormDefinition } from "@/lib/forms/schema";
import { displayAnswer, visibleFieldIds } from "@/lib/forms/logic";

/** Read-only answers of a submission, against the version it was made on. */
export function AnswerView({
  definition, answers, t, f, fileUrls = {},
}: {
  definition: FormDefinition;
  answers: Record<string, unknown>;
  t: Translator;
  f: Formatter;
  fileUrls?: Record<string, string>;
}) {
  const visible = visibleFieldIds(allFields(definition), answers);
  const labels = { yes: t("common.yes"), no: t("common.no"), accepted: t("forms.view.accepted") };
  return (
    <div className="space-y-5">
      {definition.sections.map((s) => {
        const fields = s.fields.filter((x) => x.type !== "info" && visible.has(x.id));
        if (!fields.length) return null;
        return (
          <section key={s.id} className="space-y-2">
            {s.title && <h3 className="text-sm font-semibold text-ink">{s.title}</h3>}
            <dl className="divide-y divide-line-soft rounded border border-line">
              {fields.map((field) => <AnswerRow key={field.id} field={field} value={answers[field.id]} labels={labels} f={f} fileUrls={fileUrls} t={t} />)}
            </dl>
          </section>
        );
      })}
    </div>
  );
}

function AnswerRow({ field, value, labels, f, fileUrls, t }: { field: FieldDef; value: unknown; labels: { yes: string; no: string; accepted: string }; f: Formatter; fileUrls: Record<string, string>; t: Translator }) {
  let content: React.ReactNode = displayAnswer(field, value, labels) || <span className="text-ink-4">–</span>;
  if (field.type === "date" && typeof value === "string") content = f.date(value);
  const path = (value as { path?: string } | null)?.path;
  if ((field.type === "file" || field.type === "signature") && path && fileUrls[path]) {
    content = field.type === "signature" ? (
      <span className="flex flex-col gap-1">
        <span>{displayAnswer(field, value, labels)}</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={fileUrls[path]} alt={t("forms.view.signatureAlt")} className="h-16 w-auto rounded" style={{ background: "var(--text)" }} />
      </span>
    ) : (
      <a href={fileUrls[path]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-maroon hover:underline"><Paperclip className="h-3.5 w-3.5" /> {displayAnswer(field, value, labels)}</a>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-1 px-3 py-2 text-sm sm:grid-cols-3">
      <dt className="text-ink-3">{field.label}</dt>
      <dd className="whitespace-pre-wrap text-ink sm:col-span-2">{content}</dd>
    </div>
  );
}
