"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Label } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { saveLanguageSettings } from "@/lib/i18n/settings-actions";
import type { CatalogStatus } from "@/lib/i18n/languages";

export type LanguageOption = {
  tag: string;
  nativeName: string;
  /** Name in the admin's UI language. */
  localName: string;
  status: CatalogStatus;
  dir: "ltr" | "rtl";
};

/** Region choice for one language with a server-rendered preview (identical on server and client). */
export type RegionPreview = {
  region: string;
  label: string;
  /** Per language: catalog variant name + formatted samples in that language/region. */
  samples: Record<string, { spelling: string; money: string; date: string; number: string }>;
};

const sel =
  "h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-maroon/40";

export function LanguageSettingsForm({
  languages,
  planned,
  regions,
  initial,
  canEdit,
}: {
  languages: LanguageOption[];
  planned: LanguageOption[];
  regions: RegionPreview[];
  initial: { enabled: string[]; defaultLocale: string; regions: Record<string, string> };
  canEdit: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [enabled, setEnabled] = React.useState<string[]>(initial.enabled);
  const [def, setDef] = React.useState(initial.defaultLocale);
  const [reg, setReg] = React.useState<Record<string, string>>(initial.regions);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (tag: string) =>
    setEnabled((cur) => (cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]));
  const ordered = languages.filter((l) => enabled.includes(l.tag)).map((l) => l.tag);
  const defaultValid = ordered.includes(def) ? def : ordered[0] ?? "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await saveLanguageSettings({ languages: ordered, defaultLocale: defaultValid, regions: reg });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: t("languageSettings.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  const statusBadge = (s: CatalogStatus) =>
    s === "complete" ? (
      <Badge tone="success">{t("languageSettings.statusComplete")}</Badge>
    ) : s === "partial" ? (
      <Badge tone="warning">{t("languageSettings.statusPartial")}</Badge>
    ) : (
      <Badge>{t("languageSettings.statusNone")}</Badge>
    );

  return (
    <form className="max-w-4xl space-y-6" onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>{t("languageSettings.enabled")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-3">{t("languageSettings.description")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs uppercase tracking-wide text-ink-4">
                  <th className="py-2 pe-3 text-start font-medium">{t("languageSettings.language")}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t("languageSettings.status")}</th>
                  <th className="py-2 pe-3 text-start font-medium">{t("languageSettings.region")}</th>
                  <th className="py-2 text-start font-medium">{t("languageSettings.preview")}</th>
                </tr>
              </thead>
              <tbody>
                {languages.map((l) => {
                  const on = enabled.includes(l.tag);
                  const region = reg[l.tag] ?? regions[0]?.region ?? "";
                  const sample = regions.find((r) => r.region === region)?.samples[l.tag];
                  return (
                    <tr key={l.tag} className="border-b border-line/60 align-top">
                      <td className="py-2.5 pe-3">
                        <label className="flex items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-1 accent-maroon"
                            checked={on}
                            disabled={!canEdit}
                            onChange={() => toggle(l.tag)}
                          />
                          <span>
                            <span lang={l.tag} dir={l.dir} className="font-medium text-ink">
                              {l.nativeName}
                            </span>
                            <span className="block text-xs text-ink-4">{l.localName}</span>
                          </span>
                        </label>
                      </td>
                      <td className="py-2.5 pe-3">
                        {statusBadge(l.status)}
                        {l.status === "partial" && <p className="mt-1 max-w-[14rem] text-xs text-ink-4">{t("languageSettings.betaHint")}</p>}
                      </td>
                      <td className="py-2.5 pe-3">
                        <select
                          aria-label={t("languageSettings.regionFor", { language: l.nativeName })}
                          className={sel}
                          value={region}
                          disabled={!canEdit || !on}
                          onChange={(e) => setReg({ ...reg, [l.tag]: e.target.value })}
                        >
                          {regions.map((r) => (
                            <option key={r.region} value={r.region}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                        {sample && <p className="mt-1 text-xs text-ink-4">{t("languageSettings.spelling", { name: sample.spelling })}</p>}
                      </td>
                      <td className="py-2.5 text-xs text-ink-3">
                        {sample && (
                          <span lang={l.tag} className="tnum block space-y-0.5">
                            <span className="block">{sample.money}</span>
                            <span className="block">{sample.number}</span>
                            <span className="block">{sample.date}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ordered.length === 0 && <p className="text-sm text-danger">{t("languageSettings.errors.noLanguage")}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("languageSettings.default")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="max-w-xs">
            <Label htmlFor="lang-default">{t("languageSettings.default")}</Label>
            <select id="lang-default" className={sel} value={defaultValid} disabled={!canEdit || !ordered.length} onChange={(e) => setDef(e.target.value)}>
              {languages
                .filter((l) => enabled.includes(l.tag))
                .map((l) => (
                  <option key={l.tag} value={l.tag} lang={l.tag}>
                    {l.nativeName}
                  </option>
                ))}
            </select>
          </div>
          <p className="text-xs text-ink-4">{t("languageSettings.defaultHint")}</p>
          <p className="text-xs text-ink-4">{t("languageSettings.negotiation")}</p>
        </CardBody>
      </Card>

      {planned.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("languageSettings.planned")}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-ink-3">{t("languageSettings.plannedHint")}</p>
            <ul className="flex flex-wrap gap-2">
              {planned.map((l) => (
                <li key={l.tag} className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs text-ink-3">
                  <span lang={l.tag} dir={l.dir}>
                    {l.nativeName}
                  </span>
                  <span className="text-ink-4">· {l.localName}</span>
                  {statusBadge(l.status)}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || ordered.length === 0}>
            {busy ? t("languageSettings.saving") : t("languageSettings.save")}
          </Button>
          {msg && (
            <span role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>
              {msg.text}
            </span>
          )}
        </div>
      )}
    </form>
  );
}
