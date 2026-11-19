"use client";

import * as React from "react";
import { AlertTriangle, KeyRound, Plus, Send, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { parseOriginList } from "@/lib/website/origins";
import { EMBED_THEMES, PUBLIC_SECTIONS, SOCIAL_KEYS, type NavLink, type WebsiteSettings } from "@/lib/website/settings-shape";
import { rotateWebsiteWebhookSecret, saveWebsiteSettings, sendWebsiteTestWebhook } from "@/lib/actions/website";
import { CodeBox, Status, useRunner } from "./shared";

/** Admin -> Settings -> Website: connection, origins, public sections, theme, nav links, webhook + secret. */
export function WebsiteSettingsForm({ settings, appUrl }: { settings: WebsiteSettings; appUrl: string }) {
  const t = useT();
  const f = useFormat();
  const saver = useRunner();
  const secretRunner = useRunner();
  const tester = useRunner();
  const [enabled, setEnabled] = React.useState(settings.enabled);
  const [websiteUrl, setWebsiteUrl] = React.useState(settings.websiteUrl ?? "");
  const [origins, setOrigins] = React.useState(settings.allowedOrigins.join("\n"));
  const [sections, setSections] = React.useState(settings.sections);
  const [rosterPublic, setRosterPublic] = React.useState(settings.rosterPublic);
  const [theme, setTheme] = React.useState(settings.embedTheme);
  const [webhookUrl, setWebhookUrl] = React.useState(settings.webhookUrl ?? "");
  const [tagline, setTagline] = React.useState(settings.tagline ?? "");
  const [nav, setNav] = React.useState<NavLink[]>(settings.navLinks);
  const [social, setSocial] = React.useState<Record<string, string>>({ ...settings.socialLinks });
  const [secret, setSecret] = React.useState<string | null>(null);

  const parsedOrigins = parseOriginList(origins);
  const suggestOrigin = (() => {
    try {
      return websiteUrl ? new URL(websiteUrl).origin : null;
    } catch {
      return null;
    }
  })();

  const save = () =>
    saver.run(() =>
      saveWebsiteSettings({
        enabled, websiteUrl, allowedOrigins: origins, sections, rosterPublic, embedTheme: theme, webhookUrl, tagline,
        navLinks: nav.filter((l) => l.label.trim() && l.url.trim()), socialLinks: social,
      }),
    );

  const last = settings.lastDelivery;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("website.admin.connection.title")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-5">
          <p className="text-sm text-text-muted">{t("website.admin.connection.intro")}</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t("website.admin.connection.enabled")}
          </label>
          <div>
            <Label htmlFor="ws-url">{t("website.admin.connection.websiteUrl")}</Label>
            <Input id="ws-url" type="url" inputMode="url" placeholder="https://www.example.org" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} />
            <FieldHint>{t("website.admin.connection.websiteUrlHint")}</FieldHint>
          </div>
          <div>
            <Label htmlFor="ws-origins">{t("website.admin.connection.origins")}</Label>
            <Textarea id="ws-origins" rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} placeholder="https://www.example.org" />
            <FieldHint error={parsedOrigins.invalid.length > 0}>
              {parsedOrigins.invalid.length > 0
                ? t("website.errors.invalidOrigins", { list: parsedOrigins.invalid.slice(0, 5).join(", ") })
                : t("website.admin.connection.originsHint")}
            </FieldHint>
            {suggestOrigin && !parsedOrigins.origins.includes(suggestOrigin) && (
              <Button type="button" variant="link" size="sm" onClick={() => setOrigins((o) => (o.trim() ? `${o.trim()}\n${suggestOrigin}` : suggestOrigin))}>
                {t("website.admin.connection.addOrigin", { origin: suggestOrigin })}
              </Button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ws-theme">{t("website.admin.connection.theme")}</Label>
              <Select id="ws-theme" value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}>
                {EMBED_THEMES.map((th) => <option key={th} value={th}>{t.dynamic(`website.themes.${th}`, {}, th)}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="ws-tagline">{t("website.admin.connection.tagline")}</Label>
              <Input id="ws-tagline" maxLength={200} value={tagline} onChange={(e) => setTagline(e.target.value)} />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("website.admin.sections.title")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-text-muted">{t("website.admin.sections.intro")}</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {PUBLIC_SECTIONS.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={sections[s]} onChange={(e) => setSections((x) => ({ ...x, [s]: e.target.checked }))} />
                {t.dynamic(`website.sections.${s}`, {}, s)}
              </label>
            ))}
          </div>
          <div className="rounded border border-warning/40 bg-warning-soft p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={rosterPublic} onChange={(e) => setRosterPublic(e.target.checked)} />
              <span>
                <span className="font-medium">{t("website.admin.sections.roster")}</span>
                <span className="mt-1 flex items-start gap-1 text-xs text-text-secondary"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{t("website.admin.sections.rosterHint")}</span>
              </span>
            </label>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("website.admin.nav.title")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-text-muted">{t("website.admin.nav.intro")}</p>
          {nav.map((l, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[8rem] flex-1">
                <Label htmlFor={`nav-l-${i}`}>{t("website.admin.nav.label")}</Label>
                <Input id={`nav-l-${i}`} maxLength={40} value={l.label} onChange={(e) => setNav((n) => n.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              </div>
              <div className="min-w-[12rem] flex-[2]">
                <Label htmlFor={`nav-u-${i}`}>{t("website.admin.nav.url")}</Label>
                <Input id={`nav-u-${i}`} maxLength={300} value={l.url} placeholder="https://… / /shop" onChange={(e) => setNav((n) => n.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              </div>
              <Button type="button" variant="ghost" size="sm" aria-label={t("website.admin.nav.remove")} onClick={() => setNav((n) => n.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
          {nav.length < 12 && (
            <Button type="button" variant="secondary" size="sm" onClick={() => setNav((n) => [...n, { label: "", url: "" }])}>
              <Plus className="h-4 w-4" aria-hidden />
              {t("website.admin.nav.add")}
            </Button>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {SOCIAL_KEYS.map((k) => (
              <div key={k}>
                <Label htmlFor={`social-${k}`}>{t.dynamic(`website.social.${k}`, {}, k)}</Label>
                <Input id={`social-${k}`} type="url" placeholder="https://" value={social[k] ?? ""} onChange={(e) => setSocial((s) => ({ ...s, [k]: e.target.value }))} />
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("website.admin.webhook.title")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-sm text-text-muted">{t("website.admin.webhook.intro")}</p>
          <div>
            <Label htmlFor="ws-hook">{t("website.admin.webhook.url")}</Label>
            <Input id="ws-hook" type="url" inputMode="url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://www.example.org/wp-json/dlang-os/v1/purge" />
            {suggestOrigin && !webhookUrl && (
              <Button type="button" variant="link" size="sm" onClick={() => setWebhookUrl(`${suggestOrigin}/wp-json/dlang-os/v1/purge`)}>
                {t("website.admin.webhook.usePlugin")}
              </Button>
            )}
            <FieldHint>{t("website.admin.webhook.urlHint")}</FieldHint>
          </div>
          <div className="flex flex-wrap items-center gap-3 rounded border border-border p-3">
            <KeyRound className="h-4 w-4 text-text-muted" aria-hidden />
            <span className="text-sm">
              {settings.secretHint
                ? t("website.admin.webhook.secretSet", { hint: settings.secretHint, date: settings.secretSetAt ? f.date(settings.secretSetAt) : "" })
                : t("website.admin.webhook.noSecret")}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={secretRunner.busy}
              onClick={() => {
                if (settings.secretHint && !window.confirm(t("website.admin.webhook.rotateConfirm"))) return;
                secretRunner.run(() => rotateWebsiteWebhookSecret(), (r) => {
                  if (r.ok && r.data) setSecret(r.data.secret);
                });
              }}
            >
              {settings.secretHint ? t("website.admin.webhook.rotate") : t("website.admin.webhook.generate")}
            </Button>
            <Status msg={secretRunner.msg} />
          </div>
          {secret && (
            <div className="space-y-2 rounded border border-warning/40 bg-warning-soft p-3">
              <p className="text-sm font-medium">{t("website.admin.webhook.showOnce")}</p>
              <CodeBox value={secret} label={t("website.admin.webhook.secretLabel")} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" size="sm" loading={tester.busy} onClick={() => tester.run(() => sendWebsiteTestWebhook())}>
              <Send className="h-4 w-4" aria-hidden />
              {t("website.admin.webhook.test")}
            </Button>
            <Status msg={tester.msg} />
          </div>
          <div className="text-sm">
            <span className="mr-2 text-text-muted">{t("website.admin.webhook.lastDelivery")}</span>
            {last.at ? (
              <>
                <Badge tone={last.status === "sent" ? "success" : last.status === "pending" ? "warning" : "danger"}>{t.dynamic(`website.deliveryStatus.${last.status}`, {}, last.status ?? "")}</Badge>
                <span className="ml-2 text-text-muted">{f.dateTime(last.at)}{last.code ? ` · HTTP ${last.code}` : ""}{last.error && !last.code ? ` · ${last.error}` : ""}</span>
              </>
            ) : (
              <span className="text-text-muted">{t("website.admin.webhook.never")}</span>
            )}
          </div>
          <p className="text-xs text-text-muted">{t("website.admin.webhook.apiBase", { url: `${appUrl}/api/public/v1` })}</p>
        </CardBody>
      </Card>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-bg py-3">
        <Button type="button" onClick={save} loading={saver.busy} disabled={parsedOrigins.invalid.length > 0}>{t("website.admin.save")}</Button>
        <Status msg={saver.msg} />
      </div>
    </div>
  );
}
