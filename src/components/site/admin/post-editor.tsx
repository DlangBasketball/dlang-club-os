"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, FieldHint, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { deleteSitePost, saveSitePost } from "@/lib/actions/site";
import { nativeLanguageName } from "@/lib/site/languages";
import type { MediaRef, PostContent, PostLang } from "@/lib/site/blocks";
import { ImagesCtx, MediaField, RichTextField } from "./page-editor";
import { Status } from "./site-admin";

type Img = { id: string; path: string; url: string; alt: string | null; cleared: boolean };

export function PostsList({ posts }: { posts: { id: string; slug: string; status: string; publishedAt: string | null; title: string }[] }) {
  const t = useT();
  const f = useFormat();
  return (
    <div className="space-y-4">
      <Link href="/admin/site/posts/new" className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-primary px-4 text-sm font-medium text-on-brand">
        <Plus className="h-4 w-4" aria-hidden /> {t("site.posts.new")}
      </Link>
      {posts.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {posts.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link href={`/admin/site/posts/${p.id}`} className="min-w-0 flex-1 font-medium text-text hover:text-brand-primary">{p.title}</Link>
              <span className="font-mono text-xs text-text-muted" dir="ltr">/news/{p.slug}</span>
              <Badge tone={p.status === "published" ? "success" : p.status === "scheduled" ? "info" : "neutral"}>{t.dynamic(`site.status.${p.status}`)}</Badge>
              {p.publishedAt && <span className="text-xs text-text-muted">{f.date(p.publishedAt)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-text-muted">{t("site.posts.empty")}</p>
      )}
    </div>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PostEditor({ post, languages, defaultLang, images }: {
  post: { id: string | null; slug: string; status: string; publishedAt: string | null; coverPath: string | null; authorName: string | null; tags: string[]; content: PostContent };
  languages: string[];
  defaultLang: string;
  images: Img[];
}) {
  const t = useT();
  const router = useRouter();
  const [content, setContent] = React.useState<PostContent>(() => {
    const c = { ...post.content };
    for (const l of languages) if (!c[l]) c[l] = { title: c[defaultLang]?.title ?? "", bodyHtml: "", state: l === defaultLang ? "ok" : "needs_translation" };
    return c;
  });
  const [lang, setLang] = React.useState(defaultLang);
  const [slug, setSlug] = React.useState(post.slug);
  const [status, setStatus] = React.useState(post.status === "scheduled" ? "published" : post.status);
  const [when, setWhen] = React.useState(toLocalInput(post.publishedAt));
  const [cover, setCover] = React.useState<MediaRef | null>(post.coverPath ? { path: post.coverPath, focalX: 50, focalY: 50 } : null);
  const [author, setAuthor] = React.useState(post.authorName ?? "");
  const [tags, setTags] = React.useState(post.tags.join(", "));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const cur: PostLang = content[lang] ?? { title: "", bodyHtml: "", state: "needs_translation" };
  const update = (p: Partial<PostLang>) => setContent((c) => ({ ...c, [lang]: { ...cur, ...p } }));

  async function save() {
    setBusy(true);
    const res = await saveSitePost({
      id: post.id ?? undefined, slug, status: status as "draft" | "published", publishedAt: when ? new Date(when).toISOString() : null,
      coverPath: cover?.path ?? null, authorName: author, tags: tags.split(",").map((x) => x.trim()).filter(Boolean), content,
    });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok && res.data && !post.id) router.replace(`/admin/site/posts/${res.data.id}`);
    else if (res.ok) router.refresh();
  }
  async function remove() {
    if (!post.id || !window.confirm(t("site.posts.confirmDelete"))) return;
    const res = await deleteSitePost(post.id);
    if (res.ok) router.push("/admin/site/posts");
    else setMsg({ ok: false, text: res.error });
  }

  return (
    <ImagesCtx.Provider value={images}>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
            {languages.map((l) => (
              <button key={l} role="tab" type="button" aria-selected={l === lang} onClick={() => setLang(l)} className={cn("inline-flex min-h-tap items-center gap-2 border-b-2 px-3 text-sm", l === lang ? "border-brand-primary text-text" : "border-transparent text-text-muted")}>
                <span lang={l}>{nativeLanguageName(l)}</span>
                {content[l]?.state !== "ok" && <Badge tone="warning">{t.dynamic(`site.langState.${content[l]?.state ?? "needs_translation"}`)}</Badge>}
              </button>
            ))}
          </div>
          <Card>
            <CardBody className="space-y-4" lang={lang}>
              <div><Label htmlFor="po-title">{t("site.pages.title")}</Label><Input id="po-title" dir="auto" maxLength={200} value={cur.title} onChange={(e) => update({ title: e.target.value })} /></div>
              <div><Label htmlFor="po-ex">{t("site.fields.excerpt")}</Label><Textarea id="po-ex" dir="auto" rows={2} maxLength={600} value={cur.excerpt ?? ""} onChange={(e) => update({ excerpt: e.target.value })} /></div>
              <div><Label htmlFor="po-body">{t("site.fields.body")}</Label><RichTextField id="po-body" value={cur.bodyHtml} onChange={(v) => update({ bodyHtml: v })} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label htmlFor="po-mt">{t("site.fields.metaTitle")}</Label><Input id="po-mt" dir="auto" maxLength={120} value={cur.metaTitle ?? ""} onChange={(e) => update({ metaTitle: e.target.value })} /></div>
                <div><Label htmlFor="po-md">{t("site.fields.metaDescription")}</Label><Input id="po-md" dir="auto" maxLength={320} value={cur.metaDescription ?? ""} onChange={(e) => update({ metaDescription: e.target.value })} /></div>
              </div>
              {cur.state !== "ok" && <Button size="sm" variant="secondary" onClick={() => update({ state: "ok" })}>{t("site.editor.markReviewed")}</Button>}
            </CardBody>
          </Card>
          <div className="flex items-center gap-3">
            <Button onClick={save} loading={busy}>{t("site.editor.save")}</Button>
            {post.id && <Button variant="ghost" onClick={remove}><Trash2 className="h-4 w-4" aria-hidden /> {t("common.delete")}</Button>}
            <Status msg={msg} />
          </div>
        </div>
        <aside>
          <Card>
            <CardBody className="space-y-3">
              <div><Label htmlFor="po-slug">{t("site.posts.slug")}</Label><Input id="po-slug" dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="season-opener" /><FieldHint>/news/{slug || "…"}</FieldHint></div>
              <div>
                <Label htmlFor="po-status">{t("site.posts.status")}</Label>
                <Select id="po-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="draft">{t("site.status.draft")}</option>
                  <option value="published">{t("site.status.published")}</option>
                </Select>
              </div>
              <div><Label htmlFor="po-when">{t("site.posts.date")}</Label><Input id="po-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /><FieldHint>{t("site.posts.dateHint")}</FieldHint></div>
              <div><Label htmlFor="po-cover">{t("site.fields.cover")}</Label><MediaField id="po-cover" value={cover} onChange={setCover} /></div>
              <div><Label htmlFor="po-author">{t("site.posts.author")}</Label><Input id="po-author" maxLength={120} value={author} onChange={(e) => setAuthor(e.target.value)} /></div>
              <div><Label htmlFor="po-tags">{t("site.posts.tags")}</Label><Input id="po-tags" value={tags} onChange={(e) => setTags(e.target.value)} /></div>
            </CardBody>
          </Card>
        </aside>
      </div>
    </ImagesCtx.Provider>
  );
}
