"use client";

import * as React from "react";
import { Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n/config";
import { EMBED_WIDGETS, WIDGET_PARAMS, embedPath, iframeSnippetFor, scriptSnippetFor, shortcodeFor, type EmbedSpec, type EmbedWidget } from "@/lib/website/embed-code";
import { EMBED_THEMES, type EmbedTheme } from "@/lib/website/settings-shape";
import { CodeBox } from "./shared";

/** Shortcode / script / iframe generator with copy buttons and a live preview of the widget. */
export function EmbedGenerator({ club, appUrl, origins, defaultTheme, enabled }: { club: string; appUrl: string; origins: string[]; defaultTheme: EmbedTheme; enabled: boolean }) {
  const t = useT();
  const [widget, setWidget] = React.useState<EmbedWidget>("camps");
  const [theme, setTheme] = React.useState<EmbedTheme>(defaultTheme);
  const [lang, setLang] = React.useState("");
  const [params, setParams] = React.useState<Record<string, string>>({});
  const spec: EmbedSpec = { widget, club, theme, lang: lang || null, params };
  const previewSrc = embedPath(spec, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("website.admin.embed.title")}</CardTitle>
      </CardHeader>
      <CardBody className="space-y-5">
        <p className="text-sm text-text-muted">{t("website.admin.embed.intro")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="emb-widget">{t("website.admin.embed.widget")}</Label>
            <Select id="emb-widget" value={widget} onChange={(e) => { setWidget(e.target.value as EmbedWidget); setParams({}); }}>
              {EMBED_WIDGETS.map((w) => <option key={w} value={w}>{t.dynamic(`website.widgetNames.${w}`, {}, w)}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="emb-theme">{t("website.admin.connection.theme")}</Label>
            <Select id="emb-theme" value={theme} onChange={(e) => setTheme(e.target.value as EmbedTheme)}>
              {EMBED_THEMES.map((th) => <option key={th} value={th}>{t.dynamic(`website.themes.${th}`, {}, th)}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="emb-lang">{t("website.admin.embed.language")}</Label>
            <Select id="emb-lang" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="">{t("website.admin.embed.clubLanguage")}</option>
              {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
            </Select>
          </div>
          {WIDGET_PARAMS[widget].map((p) => (
            <div key={p}>
              <Label htmlFor={`emb-${p}`}>{t.dynamic(`website.admin.embed.params.${p}`, {}, p)}</Label>
              <Input id={`emb-${p}`} value={params[p] ?? ""} maxLength={80} onChange={(e) => setParams((x) => ({ ...x, [p]: e.target.value.trim() }))} />
            </div>
          ))}
        </div>
        <CodeBox label={t("website.admin.embed.shortcode")} value={shortcodeFor(spec)} />
        <CodeBox label={t("website.admin.embed.script")} value={scriptSnippetFor(spec, appUrl)} />
        <CodeBox label={t("website.admin.embed.iframe")} value={iframeSnippetFor(spec, appUrl, origins[0] ?? null)} />
        <div className="space-y-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("website.admin.embed.preview")}</span>
          {enabled ? (
            <iframe key={previewSrc} src={previewSrc} title={t("website.admin.embed.preview")} className="h-[420px] w-full rounded border border-border bg-bg" />
          ) : (
            <FieldHint>{t("website.admin.embed.previewDisabled")}</FieldHint>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
