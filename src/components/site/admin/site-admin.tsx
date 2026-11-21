"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, ExternalLink, GripVertical, Plus, Trash2, Wand2, CheckCircle2, Circle } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import {
  addSiteRedirect, createSitePage, deleteSitePage, deleteSiteRedirect, deleteSiteSubmission, duplicateSitePage, generateStarterSite,
  reorderSitePages, saveSiteSettings, setSiteSubmissionStatus, unpublishSitePage, publishSitePage, type SiteSettingsInput,
} from "@/lib/actions/site";
import { previewSiteImport, runSiteImport } from "@/lib/actions/site-import";
import { languageNameIn, nativeLanguageName } from "@/lib/site/languages";
import { localizedPath } from "@/lib/site/paths";
import type { ImportPlan, ImportReport } from "@/lib/site/wp-import";
import type { AdminPageRow } from "@/lib/site/admin-data";

type Msg = { ok: boolean; text: string } | null;

export function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={cn("text-sm", msg.ok ? "text-success" : "text-danger")}>
      {msg.text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Page tree: order with drag and drop OR the move buttons (keyboard).
// ---------------------------------------------------------------------------

export function PageTree({ pages, defaultLang }: { pages: AdminPageRow[]; defaultLang: string }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [items, setItems] = React.useState(pages);
  const [msg, setMsg] = React.useState<Msg>(null);
  const [busy, setBusy] = React.useState(false);
  const [drag, setDrag] = React.useState<string | null>(null);
  React.useEffect(() => setItems(pages), [pages]);

  // Flatten the tree: parents in position order, children under them.
  const ordered = React.useMemo(() => {
    const kids = (pid: string | null) => items.filter((p) => p.parentId === pid).sort((a, b) => a.position - b.position || a.path.localeCompare(b.path));
    const out: { page: AdminPageRow; depth: number }[] = [];
    const seen = new Set<string>();
    const walk = (pid: string | null, depth: number) => {
      for (const p of kids(pid)) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push({ page: p, depth });
        if (depth < 3) walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
    for (const p of items) if (!seen.has(p.id)) out.push({ page: p, depth: 0 });
    return out;
  }, [items]);

  async function persist(next: AdminPageRow[]) {
    setItems(next);
    setBusy(true);
    const res = await reorderSitePages(next.map((p) => ({ id: p.id, parentId: p.parentId, position: p.position })));
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  function move(id: string, dir: -1 | 1) {
    const page = items.find((p) => p.id === id);
    if (!page) return;
    const siblings = items.filter((p) => p.parentId === page.parentId).sort((a, b) => a.position - b.position || a.path.localeCompare(b.path));
    const i = siblings.findIndex((p) => p.id === id);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    const swapped = [...siblings];
    [swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];
    const pos = new Map(swapped.map((p, k) => [p.id, k * 10]));
    void persist(items.map((p) => (pos.has(p.id) ? { ...p, position: pos.get(p.id)! } : p)));
  }

  function dropOn(targetId: string) {
    if (!drag || drag === targetId) return;
    const target = items.find((p) => p.id === targetId);
    if (!target) return;
    // Dropped onto a row: becomes its sibling, placed before it.
    const siblings = items.filter((p) => p.parentId === target.parentId && p.id !== drag).sort((a, b) => a.position - b.position);
    const idx = siblings.findIndex((p) => p.id === targetId);
    const dragged = items.find((p) => p.id === drag)!;
    siblings.splice(idx, 0, { ...dragged, parentId: target.parentId });
    const pos = new Map(siblings.map((p, k) => [p.id, k * 10]));
    setDrag(null);
    void persist(items.map((p) => (pos.has(p.id) ? { ...p, parentId: p.id === drag ? target.parentId : p.parentId, position: pos.get(p.id)! } : p)));
  }

  async function act(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error ?? "" });
    if (res.ok) router.refresh();
  }

  if (!items.length) return <p className="rounded-lg border border-dashed border-border p-8 text-center text-text-muted">{t("site.pages.empty")}</p>;
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface" aria-busy={busy}>
        {ordered.map(({ page: p, depth }) => (
          <li
            key={p.id}
            draggable
            onDragStart={() => setDrag(p.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => dropOn(p.id)}
            className={cn("flex flex-wrap items-center gap-3 px-3 py-3", drag === p.id && "opacity-50")}
          >
            <GripVertical className="h-4 w-4 cursor-grab text-text-muted" aria-hidden />
            <div className="min-w-0 flex-1" style={{ paddingInlineStart: `${depth * 1.25}rem` }}>
              <Link href={`/admin/site/pages/${p.id}`} className="font-medium text-text hover:text-brand-primary">
                {p.title}
              </Link>
              <p className="truncate font-mono text-xs text-text-muted" dir="ltr">{p.path}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={p.status === "published" ? "success" : p.status === "scheduled" ? "info" : "neutral"}>{t.dynamic(`site.status.${p.status}`)}</Badge>
              {p.status === "scheduled" && p.publishedAt && <span className="text-xs text-text-muted">{f.dateTime(p.publishedAt)}</span>}
              {p.dirty && <Badge tone="warning">{t("site.pages.unpublishedChanges")}</Badge>}
              {p.showInNav && <Badge tone="brand">{t("site.pages.inMenu")}</Badge>}
              {p.langs.filter((l) => l.state !== "ok").map((l) => (
                <Badge key={l.tag} tone="warning" title={t.dynamic(`site.langState.${l.state}`)}>{l.tag}</Badge>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => move(p.id, -1)} disabled={busy} aria-label={t("site.pages.moveUp", { page: p.title })}>
                <ArrowUp className="h-4 w-4" aria-hidden />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => move(p.id, 1)} disabled={busy} aria-label={t("site.pages.moveDown", { page: p.title })}>
                <ArrowDown className="h-4 w-4" aria-hidden />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => act(() => duplicateSitePage(p.id))} disabled={busy} aria-label={t("site.pages.duplicate", { page: p.title })}>
                <Copy className="h-4 w-4" aria-hidden />
              </Button>
              <a href={`/admin/site/preview/${p.id}?lang=${encodeURIComponent(defaultLang)}`} target="_blank" rel="noopener" className="inline-flex h-10 w-10 items-center justify-center rounded text-text-muted hover:text-text" aria-label={t("site.pages.preview", { page: p.title })}>
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
              <Button
                size="icon"
                variant="ghost"
                disabled={busy}
                aria-label={t("site.pages.delete", { page: p.title })}
                onClick={() => {
                  if (window.confirm(t("site.pages.confirmDelete", { page: p.title }))) void act(() => deleteSitePage(p.id));
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <FieldHint>{t("site.pages.orderHint")}</FieldHint>
      <Status msg={msg} />
    </div>
  );
}

export function NewPageForm({ pages }: { pages: AdminPageRow[] }) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [path, setPath] = React.useState("");
  const [parent, setParent] = React.useState("");
  const [msg, setMsg] = React.useState<Msg>(null);
  const [busy, setBusy] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await createSitePage({ title, path: path || undefined, parentId: parent || null });
    setBusy(false);
    if (res.ok && res.data) router.push(`/admin/site/pages/${res.data.id}`);
    else setMsg(res.ok ? null : { ok: false, text: res.error });
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <div>
        <Label htmlFor="np-title">{t("site.pages.title")}</Label>
        <Input id="np-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="np-path">{t("site.pages.path")}</Label>
        <Input id="np-path" dir="ltr" placeholder="/about-us" maxLength={300} value={path} onChange={(e) => setPath(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="np-parent">{t("site.pages.parent")}</Label>
        <Select id="np-parent" value={parent} onChange={(e) => setParent(e.target.value)}>
          <option value="">{t("site.pages.noParent")}</option>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.path})</option>)}
        </Select>
      </div>
      <Button type="submit" loading={busy}>
        <Plus className="h-4 w-4" aria-hidden /> {t("site.pages.add")}
      </Button>
      <div className="sm:col-span-4"><Status msg={msg} /></div>
    </form>
  );
}

export function StarterButton({ hasPages }: { hasPages: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const [publish, setPublish] = React.useState(!hasPages);
  async function run() {
    setBusy(true);
    const res = await generateStarterSite({ publish });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} className="h-4 w-4 accent-[var(--brand-primary)]" />
        {t("site.starter.publishNow")}
      </label>
      <Button onClick={run} loading={busy} variant={hasPages ? "secondary" : "primary"}>
        <Wand2 className="h-4 w-4" aria-hidden /> {t("site.starter.button")}
      </Button>
      <FieldHint>{t("site.starter.hint")}</FieldHint>
      <Status msg={msg} />
    </div>
  );
}

export function Checklist({ items }: { items: readonly { key: string; done: boolean }[] }) {
  const t = useT();
  return (
    <ol className="space-y-2">
      {items.map((it) => (
        <li key={it.key} className="flex items-start gap-2 text-sm">
          {it.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />}
          <span className={it.done ? "text-text" : "text-text-secondary"}>
            <span className="sr-only">{it.done ? t("site.checklist.done") : t("site.checklist.todo")}: </span>
            {t.dynamic(`site.checklist.items.${it.key}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type SettingsFormValue = SiteSettingsInput & { languagesList: string[] };

export function SiteSettingsForm({
  initial, pages, images, contrast, social, appLocale,
}: {
  initial: SiteSettingsInput;
  pages: { id: string; title: string; path: string }[];
  images: { path: string; url: string; alt: string | null; cleared: boolean }[];
  contrast: { label: string; ratio: number; ok: boolean; min: number }[];
  social: readonly string[];
  appLocale: string;
}) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = React.useState<SiteSettingsInput>(initial);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const set = <K extends keyof SiteSettingsInput>(k: K, val: SiteSettingsInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const langs = String(v.languages ?? "").split(/[\s,;]+/).filter(Boolean);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await saveSiteSettings(v);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  const imgSelect = (id: string, key: "logoPath" | "faviconPath" | "ogImagePath", onlyCleared = false) => (
    <Select id={id} value={(v[key] as string | null | undefined) ?? ""} onChange={(e) => set(key, e.target.value || null)}>
      <option value="">{t("site.settings.none")}</option>
      {images.filter((i) => !onlyCleared || i.cleared).map((i) => <option key={i.path} value={i.path}>{i.alt || i.path.split("/").pop()}</option>)}
    </Select>
  );
  const PALETTE = ["primary", "accent", "background", "surface", "text"] as const;
  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader><CardTitle>{t("site.settings.general")}</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-start gap-3 sm:col-span-2">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--brand-primary)]" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            <span>
              <span className="block font-medium text-text">{t("site.settings.enabled")}</span>
              <span className="text-sm text-text-muted">{t("site.settings.enabledHint")}</span>
            </span>
          </label>
          <div>
            <Label htmlFor="s-template">{t("site.settings.template")}</Label>
            <Select id="s-template" value={v.template} onChange={(e) => set("template", e.target.value)}>
              {(["arena", "court", "classic"] as const).map((k) => <option key={k} value={k}>{t.dynamic(`site.templates.${k}`)}</option>)}
            </Select>
            <FieldHint>{t.dynamic(`site.templates.${v.template}Hint`)}</FieldHint>
          </div>
          <div>
            <Label htmlFor="s-home">{t("site.settings.homePage")}</Label>
            <Select id="s-home" value={v.homePageId ?? ""} onChange={(e) => set("homePageId", e.target.value || null)}>
              <option value="">{t("site.settings.homeAuto")}</option>
              {pages.map((p) => <option key={p.id} value={p.id}>{p.title} ({p.path})</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="s-langs">{t("site.settings.languages")}</Label>
            <Input id="s-langs" dir="ltr" value={v.languages} onChange={(e) => set("languages", e.target.value)} placeholder="en, fr, de-CH" />
            <FieldHint>{t("site.settings.languagesHint")}</FieldHint>
            <p className="mt-1 text-xs text-text-muted">{langs.map((l) => `${l}: ${nativeLanguageName(l)} (${languageNameIn(l, appLocale)})`).join(" · ")}</p>
          </div>
          <div>
            <Label htmlFor="s-def">{t("site.settings.defaultLanguage")}</Label>
            <Select id="s-def" value={v.defaultLanguage} onChange={(e) => set("defaultLanguage", e.target.value)}>
              {langs.map((l) => <option key={l} value={l}>{nativeLanguageName(l)}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="s-email">{t("site.settings.contactEmail")}</Label>
            <Input id="s-email" type="email" value={v.contactEmail ?? ""} onChange={(e) => set("contactEmail", e.target.value)} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("site.settings.brand")}</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="s-logo">{t("site.settings.logo")}</Label>{imgSelect("s-logo", "logoPath")}</div>
          <div><Label htmlFor="s-fav">{t("site.settings.favicon")}</Label>{imgSelect("s-fav", "faviconPath")}</div>
          {PALETTE.map((k) => (
            <div key={k}>
              <Label htmlFor={`s-c-${k}`}>{t.dynamic(`site.settings.colors.${k}`)}</Label>
              <div className="flex items-center gap-2">
                <input
                  id={`s-c-${k}`}
                  type="color"
                  className="h-10 w-14 cursor-pointer rounded border border-border bg-surface"
                  value={(v.palette as Record<string, string> | undefined)?.[k] || "#808080"}
                  onChange={(e) => set("palette", { ...(v.palette ?? {}), [k]: e.target.value.toUpperCase() })}
                />
                <Button type="button" size="sm" variant="ghost" onClick={() => { const p = { ...(v.palette ?? {}) } as Record<string, string>; delete p[k]; set("palette", p); }}>
                  {t("site.settings.useClubColor")}
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Label htmlFor="s-fd">{t("site.settings.fontDisplay")}</Label>
            <Input id="s-fd" value={(v.fonts as Record<string, string> | undefined)?.display ?? ""} onChange={(e) => set("fonts", { ...(v.fonts ?? {}), display: e.target.value })} placeholder="Fraunces" />
          </div>
          <div>
            <Label htmlFor="s-fu">{t("site.settings.fontUi")}</Label>
            <Input id="s-fu" value={(v.fonts as Record<string, string> | undefined)?.ui ?? ""} onChange={(e) => set("fonts", { ...(v.fonts ?? {}), ui: e.target.value })} placeholder="Geist" />
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-text">{t("site.settings.contrast")}</p>
            <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
              {contrast.map((c, i) => (
                <li key={i} className={c.ok ? "text-success" : "text-danger"}>
                  {t.dynamic(`site.settings.contrastPairs.${i}`, {}, c.label)}: {c.ratio.toFixed(2)}:1 {c.ok ? "✓" : t("site.settings.contrastFail", { min: c.min })}
                </li>
              ))}
            </ul>
            <FieldHint>{t("site.settings.contrastHint")}</FieldHint>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("site.settings.seo")}</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="s-suffix">{t("site.settings.titleSuffix")}</Label>
            <Input id="s-suffix" maxLength={80} value={v.titleSuffix ?? ""} onChange={(e) => set("titleSuffix", e.target.value)} />
          </div>
          <div><Label htmlFor="s-og">{t("site.settings.ogImage")}</Label>{imgSelect("s-og", "ogImagePath", true)}</div>
          {langs.map((l) => (
            <div key={l} className="sm:col-span-2">
              <Label htmlFor={`s-desc-${l}`}>{t("site.settings.description", { language: nativeLanguageName(l) })}</Label>
              <Textarea id={`s-desc-${l}`} rows={2} maxLength={320} dir="auto" value={(v.description as Record<string, string> | undefined)?.[l] ?? ""} onChange={(e) => set("description", { ...(v.description ?? {}), [l]: e.target.value })} />
            </div>
          ))}
          <div>
            <Label htmlFor="s-an">{t("site.settings.analytics")}</Label>
            <Select id="s-an" value={v.analyticsProvider ?? "none"} onChange={(e) => set("analyticsProvider", e.target.value as "none" | "plausible" | "ga4")}>
              <option value="none">{t("site.settings.analyticsNone")}</option>
              <option value="plausible">Plausible</option>
              <option value="ga4">Google Analytics 4</option>
            </Select>
            <FieldHint>{t("site.settings.analyticsHint")}</FieldHint>
          </div>
          <div>
            <Label htmlFor="s-anid">{t("site.settings.analyticsId")}</Label>
            <Input id="s-anid" dir="ltr" value={v.analyticsId ?? ""} onChange={(e) => set("analyticsId", e.target.value)} />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("site.settings.social")}</CardTitle></CardHeader>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {social.map((k) => (
            <div key={k}>
              <Label htmlFor={`s-so-${k}`}>{t.dynamic(`website.social.${k}`, {}, k)}</Label>
              <Input id={`s-so-${k}`} dir="ltr" type="url" placeholder="https://" value={(v.social as Record<string, string> | undefined)?.[k] ?? ""} onChange={(e) => set("social", { ...(v.social ?? {}), [k]: e.target.value })} />
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy}>{t("common.save")}</Button>
        <Status msg={msg} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

export function RedirectsManager({ rows }: { rows: { id: string; from: string; to: string; status: number }[] }) {
  const t = useT();
  const router = useRouter();
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [status, setStatus] = React.useState<301 | 302>(301);
  const [msg, setMsg] = React.useState<Msg>(null);
  const [busy, setBusy] = React.useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await addSiteRedirect({ from, to, status });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) {
      setFrom("");
      setTo("");
      router.refresh();
    }
  }
  async function remove(id: string) {
    const res = await deleteSiteRedirect(id);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  return (
    <div className="space-y-4">
      <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_8rem_auto] sm:items-end">
        <div><Label htmlFor="r-from">{t("site.redirects.from")}</Label><Input id="r-from" dir="ltr" required placeholder="/old-page" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label htmlFor="r-to">{t("site.redirects.to")}</Label><Input id="r-to" dir="ltr" required placeholder="/new-page" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div>
          <Label htmlFor="r-status">{t("site.redirects.type")}</Label>
          <Select id="r-status" value={status} onChange={(e) => setStatus(Number(e.target.value) === 302 ? 302 : 301)}>
            <option value={301}>{t("site.redirects.permanent")}</option>
            <option value={302}>{t("site.redirects.temporary")}</option>
          </Select>
        </div>
        <Button type="submit" loading={busy}>{t("site.redirects.add")}</Button>
      </form>
      <Status msg={msg} />
      {rows.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2 font-mono text-sm" dir="ltr">
              <span className="min-w-0 flex-1 truncate">{r.from}</span>
              <span className="text-text-muted">→</span>
              <span className="min-w-0 flex-1 truncate">{r.to}</span>
              <Badge>{r.status}</Badge>
              <Button size="icon" variant="ghost" onClick={() => remove(r.id)} aria-label={t("site.redirects.delete", { from: r.from })}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">{t("site.redirects.empty")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form submissions
// ---------------------------------------------------------------------------

export function SubmissionsList({ rows }: { rows: { id: string; kind: string; name: string; email: string; phone: string | null; message: string; pagePath: string | null; status: string; leadId: string | null; createdAt: string }[] }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [msg, setMsg] = React.useState<Msg>(null);
  async function setStatus(id: string, status: "new" | "handled" | "spam") {
    const res = await setSiteSubmissionStatus({ id, status });
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  async function remove(id: string) {
    if (!window.confirm(t("site.forms.confirmDelete"))) return;
    const res = await deleteSiteSubmission(id);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  if (!rows.length) return <p className="rounded-lg border border-dashed border-border p-8 text-center text-text-muted">{t("site.forms.empty")}</p>;
  return (
    <div className="space-y-3">
      <Status msg={msg} />
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{t.dynamic(`site.form.titles.${r.kind}`)}</Badge>
              <Badge tone={r.status === "new" ? "warning" : r.status === "spam" ? "danger" : "success"}>{t.dynamic(`site.forms.status.${r.status}`)}</Badge>
              {r.leadId && <Link href="/admin/leads" className="text-xs text-brand-primary underline">{t("site.forms.inLeads")}</Link>}
              <span className="ms-auto text-xs text-text-muted">{f.dateTime(r.createdAt)}</span>
            </div>
            <p className="mt-2 font-medium text-text">{r.name} · <a className="text-brand-primary" href={`mailto:${r.email}`}>{r.email}</a>{r.phone ? ` · ${r.phone}` : ""}</p>
            <p className="mt-2 whitespace-pre-line text-sm text-text-secondary" dir="auto">{r.message}</p>
            {r.pagePath && <p className="mt-1 font-mono text-xs text-text-muted" dir="ltr">{r.pagePath}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {r.status !== "handled" && <Button size="sm" variant="secondary" onClick={() => setStatus(r.id, "handled")}>{t("site.forms.markHandled")}</Button>}
              {r.status !== "spam" && <Button size="sm" variant="ghost" onClick={() => setStatus(r.id, "spam")}>{t("site.forms.markSpam")}</Button>}
              <Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" aria-hidden /> {t("common.delete")}</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import wizard
// ---------------------------------------------------------------------------

export function ImportWizard({ initialUrl }: { initialUrl: string }) {
  const t = useT();
  const router = useRouter();
  const [url, setUrl] = React.useState(initialUrl);
  const [plan, setPlan] = React.useState<ImportPlan | null>(null);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [cleared, setCleared] = React.useState(false);
  const [publish, setPublish] = React.useState(false);
  const [busy, setBusy] = React.useState<null | "preview" | "run">(null);
  const [msg, setMsg] = React.useState<Msg>(null);
  async function preview(e: React.FormEvent) {
    e.preventDefault();
    setBusy("preview");
    setReport(null);
    const res = await previewSiteImport(url);
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    setPlan(res.ok ? res.data : null);
  }
  async function run() {
    setBusy("run");
    const res = await runSiteImport({ url, clearedForPublic: cleared, publish });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) {
      setReport(res.data);
      router.refresh();
    }
  }
  const importable = plan?.pages.filter((p) => !p.skip) ?? [];
  const skipped = plan?.pages.filter((p) => p.skip) ?? [];
  return (
    <div className="space-y-6">
      <form onSubmit={preview} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="imp-url">{t("site.import.url")}</Label>
          <Input id="imp-url" dir="ltr" type="url" required placeholder="https://www.my-club.example" value={url} onChange={(e) => setUrl(e.target.value)} />
          <FieldHint>{t("site.import.urlHint")}</FieldHint>
        </div>
        <Button type="submit" loading={busy === "preview"} disabled={!!busy}>{t("site.import.preview")}</Button>
      </form>
      <Status msg={msg} />
      {plan && (
        <Card>
          <CardHeader><CardTitle>{t("site.import.planTitle")}</CardTitle></CardHeader>
          <CardBody className="space-y-5">
            <p className="text-sm text-text-secondary">
              {t("site.import.summary", { pages: importable.length, skipped: skipped.length, posts: plan.posts.length, images: plan.imageCount })}
            </p>
            <p className="text-sm text-text-secondary">
              {t("site.import.languagesFound", { list: plan.languages.length ? plan.languages.map((l) => nativeLanguageName(l.tag)).join(", ") : nativeLanguageName(plan.defaultLanguage) })}
            </p>
            {!!plan.missingLanguages.length && (
              <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-text">
                {t("site.import.missingLanguages", { list: plan.missingLanguages.map((l) => nativeLanguageName(l)).join(", ") })}
              </p>
            )}
            <div className="max-h-80 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-bg-secondary text-start text-xs uppercase text-text-muted">
                  <tr><th className="px-3 py-2 text-start">{t("site.pages.title")}</th><th className="px-3 py-2 text-start">{t("site.import.oldPath")}</th><th className="px-3 py-2 text-start">{t("site.import.newPath")}</th><th className="px-3 py-2 text-start">{t("site.import.languages")}</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {importable.map((p) => (
                    <tr key={p.sourceId}>
                      <td className="px-3 py-2">{p.title}</td>
                      <td className="px-3 py-2 font-mono text-xs" dir="ltr">{p.oldPath}</td>
                      <td className={cn("px-3 py-2 font-mono text-xs", p.oldPath !== p.newPath && "text-warning")} dir="ltr">{p.newPath}</td>
                      <td className="px-3 py-2 text-xs">{p.translations.join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!!skipped.length && (
              <details>
                <summary className="cursor-pointer text-sm text-text-secondary">{t("site.import.skippedTitle", { count: skipped.length })}</summary>
                <ul className="mt-2 space-y-1 text-xs text-text-muted">
                  {skipped.map((p) => <li key={p.sourceId}><span className="font-mono" dir="ltr">{p.oldPath}</span> · {t.dynamic(`site.import.skip.${p.skip}`)}</li>)}
                </ul>
              </details>
            )}
            {!!plan.unmatched.length && <p className="text-xs text-text-muted">{t("site.import.unmatched", { count: plan.unmatched.length })}</p>}
            <label className="flex items-start gap-3 rounded-md border border-border p-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--brand-primary)]" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
              <span>
                <span className="block font-medium text-text">{t("site.import.clearedLabel")}</span>
                <span className="text-sm text-text-muted">{t("site.import.clearedHint")}</span>
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--brand-primary)]" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
              <span className="text-sm text-text-secondary">{t("site.import.publishLabel")}</span>
            </label>
            <Button onClick={run} loading={busy === "run"} disabled={!!busy}>{t("site.import.run")}</Button>
          </CardBody>
        </Card>
      )}
      {report && (
        <Card>
          <CardHeader><CardTitle>{t("site.import.reportTitle")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {(Object.keys(report) as (keyof ImportReport)[]).map((k) => (
                <li key={k} className="flex justify-between gap-3 rounded bg-bg-secondary px-3 py-2"><span className="text-text-secondary">{t.dynamic(`site.import.report.${k}`)}</span><strong className="text-text">{report[k]}</strong></li>
              ))}
            </ul>
            {report.imagesRemaining > 0 && <p className="mt-3 text-sm text-warning">{t("site.import.runAgain")}</p>}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page publish bar (used by the editor page)
// ---------------------------------------------------------------------------

export function PublishBar({ id, status, publishedAt, previewHref, livePath }: { id: string; status: string; publishedAt: string | null; previewHref: string; livePath: string | null }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [when, setWhen] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  async function publish(at?: string) {
    setBusy(true);
    const res = await publishSitePage({ id, at });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  async function unpublish() {
    setBusy(true);
    const res = await unpublishSitePage(id);
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="me-auto text-sm">
        <Badge tone={status === "published" ? "success" : status === "scheduled" ? "info" : "neutral"}>{t.dynamic(`site.status.${status}`)}</Badge>
        {publishedAt && status !== "draft" && <span className="ms-2 text-text-muted">{f.dateTime(publishedAt)}</span>}
        {livePath && status === "published" && <a href={livePath} target="_blank" rel="noopener" className="ms-3 text-brand-primary underline">{t("site.editor.viewLive")}</a>}
      </div>
      <a href={previewHref} target="_blank" rel="noopener" className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm text-text hover:border-brand-primary">{t("site.editor.preview")}</a>
      <div>
        <Label htmlFor="pub-when">{t("site.editor.scheduleAt")}</Label>
        <Input id="pub-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <Button variant="secondary" disabled={!when || busy} onClick={() => publish(new Date(when).toISOString())}>{t("site.editor.schedule")}</Button>
      <Button loading={busy} onClick={() => publish()}>{t("site.editor.publish")}</Button>
      {status !== "draft" && <Button variant="ghost" disabled={busy} onClick={unpublish}>{t("site.editor.unpublish")}</Button>}
      <div className="w-full"><Status msg={msg} /></div>
    </div>
  );
}

export function liveUrl(path: string, lang: string, def: string): string {
  return localizedPath(path, lang, def);
}
