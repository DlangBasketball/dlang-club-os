"use client";

import * as React from "react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { deleteWebsiteNews, saveWebsiteNews, setPublicFlag } from "@/lib/actions/website";
import { Status, useRunner } from "./shared";

export type NewsRow = { id: string; title: string; excerpt: string | null; linkUrl: string | null; isPublic: boolean; source: string; publishedAt: string };
export type AlertRow = { id: string; title: string; startsAt: string; isPublic: boolean };

function NewsForm({ row, onDone }: { row: NewsRow | null; onDone: () => void }) {
  const t = useT();
  const r = useRunner();
  const [v, setV] = React.useState({ title: row?.title ?? "", excerpt: row?.excerpt ?? "", body: "", linkUrl: row?.linkUrl ?? "", isPublic: row?.isPublic ?? false });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        r.run(() => saveWebsiteNews(row?.id ?? null, v), () => onDone());
      }}
    >
      <div>
        <Label htmlFor="news-title">{t("website.admin.news.titleField")}</Label>
        <Input id="news-title" required maxLength={200} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="news-excerpt">{t("website.admin.news.excerpt")}</Label>
        <Textarea id="news-excerpt" rows={2} maxLength={1000} value={v.excerpt} onChange={(e) => setV({ ...v, excerpt: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="news-body">{t("website.admin.news.body")}</Label>
        <Textarea id="news-body" rows={5} maxLength={20000} value={v.body} placeholder={row ? t("website.admin.news.bodyKeep") : undefined} onChange={(e) => setV({ ...v, body: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="news-link">{t("website.admin.news.link")}</Label>
        <Input id="news-link" type="url" placeholder="https://" value={v.linkUrl} onChange={(e) => setV({ ...v, linkUrl: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.isPublic} onChange={(e) => setV({ ...v, isPublic: e.target.checked })} />{t("website.admin.flags.showOnWebsite")}</label>
      <p className="text-xs text-text-muted">{t("website.admin.news.privacyHint")}</p>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" loading={r.busy}>{t("website.admin.save")}</Button>
        <Status msg={r.msg} />
      </div>
    </form>
  );
}

/** Public news written in the app (and posts imported from the website), plus club-wide alerts shown on the website. */
export function NewsManager({ news, alerts }: { news: NewsRow[]; alerts: AlertRow[] }) {
  const t = useT();
  const f = useFormat();
  const del = useRunner();
  const alertRunner = useRunner();
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("website.admin.news.title")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {editing === "new" ? <NewsForm row={null} onDone={() => setEditing(null)} /> : (
            <Button type="button" size="sm" onClick={() => setEditing("new")}>{t("website.admin.news.add")}</Button>
          )}
          <Status msg={del.msg} />
          {news.length === 0 ? <p className="text-sm text-text-muted">{t("website.widgets.empty")}</p> : (
            <ul className="divide-y divide-border">
              {news.map((n) => (
                <li key={n.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1 font-medium">{n.title}</span>
                    <span className="text-xs text-text-muted">{f.date(n.publishedAt)}</span>
                    <Badge tone={n.isPublic ? "success" : "neutral"}>{n.isPublic ? t("website.admin.news.public") : t("website.admin.news.draft")}</Badge>
                    {n.source === "wordpress" && <Badge tone="info">{t("website.admin.news.imported")}</Badge>}
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(editing === n.id ? null : n.id)}>{t("website.admin.news.edit")}</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => { if (window.confirm(t("website.admin.news.deleteConfirm"))) del.run(() => deleteWebsiteNews(n.id)); }}>{t("website.admin.news.delete")}</Button>
                  </div>
                  {editing === n.id && <NewsForm row={n} onDone={() => setEditing(null)} />}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("website.admin.news.alertsTitle")}</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-text-muted">{t("website.admin.news.alertsIntro")}</p>
          <Status msg={alertRunner.msg} />
          {alerts.length === 0 ? <p className="text-sm text-text-muted">{t("website.widgets.empty")}</p> : (
            <ul className="divide-y divide-border">
              {alerts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="flex-1 text-sm">{a.title} <span className="text-text-muted">· {f.date(a.startsAt)}</span></span>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" defaultChecked={a.isPublic} onChange={(e) => alertRunner.run(() => setPublicFlag("alert", a.id, e.target.checked))} />
                    {t("website.admin.flags.showOnWebsite")}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
