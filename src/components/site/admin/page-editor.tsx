"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, Copy, GripVertical, ImagePlus, Languages, Plus, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, FieldHint, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import {
  BLOCK_FIELDS, BLOCK_TYPES, cloneBlocks, moveItem, newBlock, newBlockId, pageContentSchema,
  type Block, type BlockType, type Field, type MediaRef, type PageContent, type PageLang,
} from "@/lib/site/blocks";
import { nativeLanguageName } from "@/lib/site/languages";
import { draftSiteTranslation, restoreSiteVersion, saveSitePageContent, updateSitePageMeta } from "@/lib/actions/site";
import { Status } from "./site-admin";

type Img = { id: string; path: string; url: string; alt: string | null; cleared: boolean };
type Msg = { ok: boolean; text: string } | null;
type Obj = Record<string, unknown>;

export const ImagesCtx = React.createContext<Img[]>([]);

// ---------------------------------------------------------------------------
// Image picker
// ---------------------------------------------------------------------------

function ImagePicker({ open, onClose, onPick, multi = false }: { open: boolean; onClose: () => void; onPick: (imgs: Img[]) => void; multi?: boolean }) {
  const t = useT();
  const images = React.useContext(ImagesCtx);
  const [sel, setSel] = React.useState<string[]>([]);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setSel([]);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={t("site.editor.pickImage")} className="fixed inset-0 z-[90] flex items-center justify-center bg-bg/80 p-4">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border p-3">
          <p className="font-medium">{t("site.editor.pickImage")}</p>
          <Button ref={closeRef} size="icon" variant="ghost" onClick={onClose} aria-label={t("site.editor.close")}><X className="h-4 w-4" aria-hidden /></Button>
        </div>
        <div className="overflow-y-auto p-3">
          {!images.length && <p className="p-6 text-center text-sm text-text-muted">{t("site.editor.noImages")}</p>}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {images.map((img) => {
              const on = sel.includes(img.path);
              return (
                <li key={img.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => (multi ? setSel((s) => (on ? s.filter((x) => x !== img.path) : [...s, img.path])) : onPick([img]))}
                    className={cn("relative block aspect-square w-full overflow-hidden rounded-md border-2", on ? "border-brand-primary" : "border-transparent")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail of a public library image */}
                    <img src={img.url} alt={img.alt ?? ""} className="h-full w-full object-cover" loading="lazy" />
                    {!img.cleared && <span className="absolute inset-x-1 bottom-1 rounded bg-warning px-1 text-[10px] font-semibold text-bg">{t("site.editor.notCleared")}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {multi && (
          <div className="flex justify-end gap-2 border-t border-border p-3">
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button disabled={!sel.length} onClick={() => onPick(images.filter((i) => sel.includes(i.path)))}>{t("site.editor.addSelected", { count: sel.length })}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function MediaField({ id, value, onChange }: { id: string; value: MediaRef | null | undefined; onChange: (v: MediaRef | null) => void }) {
  const t = useT();
  const images = React.useContext(ImagesCtx);
  const [open, setOpen] = React.useState(false);
  const img = value ? images.find((i) => i.path === value.path) : null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-28 overflow-hidden rounded border border-border bg-bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail */}
          {img && <img src={img.url} alt="" className="h-full w-full object-cover" style={{ objectPosition: `${value?.focalX ?? 50}% ${value?.focalY ?? 50}%` }} />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button id={id} type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}><ImagePlus className="h-4 w-4" aria-hidden /> {value ? t("site.editor.changeImage") : t("site.editor.chooseImage")}</Button>
          {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>{t("site.editor.removeImage")}</Button>}
        </div>
      </div>
      {img && !img.cleared && <p className="text-xs text-warning">{t("site.editor.notClearedHint")}</p>}
      {value && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <Label htmlFor={`${id}-alt`}>{t("site.fields.alt")}</Label>
            <Input id={`${id}-alt`} maxLength={300} dir="auto" value={value.alt ?? ""} onChange={(e) => onChange({ ...value, alt: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`${id}-fx`}>{t("site.fields.focalX")}</Label>
            <Input id={`${id}-fx`} type="range" min={0} max={100} value={value.focalX ?? 50} onChange={(e) => onChange({ ...value, focalX: Number(e.target.value) })} />
          </div>
          <div>
            <Label htmlFor={`${id}-fy`}>{t("site.fields.focalY")}</Label>
            <Input id={`${id}-fy`} type="range" min={0} max={100} value={value.focalY ?? 50} onChange={(e) => onChange({ ...value, focalY: Number(e.target.value) })} />
          </div>
        </div>
      )}
      <ImagePicker open={open} onClose={() => setOpen(false)} onPick={([i]) => { if (i) onChange({ path: i.path, alt: i.alt ?? undefined, focalX: 50, focalY: 50 }); setOpen(false); }} />
    </div>
  );
}

function MediaListField({ id, value, onChange }: { id: string; value: MediaRef[]; onChange: (v: MediaRef[]) => void }) {
  const t = useT();
  const images = React.useContext(ImagesCtx);
  const [open, setOpen] = React.useState(false);
  return (
    <div className="space-y-2">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {value.map((v, i) => {
          const img = images.find((x) => x.path === v.path);
          return (
            <li key={`${v.path}-${i}`} className="relative aspect-square overflow-hidden rounded border border-border bg-bg-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail */}
              {img && <img src={img.url} alt="" className="h-full w-full object-cover" />}
              {img && !img.cleared && <span className="absolute inset-x-0 top-0 bg-warning px-1 text-[9px] font-semibold text-bg">{t("site.editor.notCleared")}</span>}
              <div className="absolute inset-x-0 bottom-0 flex justify-between bg-bg/80">
                <button type="button" className="p-1" aria-label={t("site.editor.moveUp")} onClick={() => onChange(moveItem(value, i, i - 1))}><ArrowUp className="h-3 w-3 rtl:rotate-180" aria-hidden /></button>
                <button type="button" className="p-1" aria-label={t("site.editor.removeImage")} onClick={() => onChange(value.filter((_, k) => k !== i))}><X className="h-3 w-3" aria-hidden /></button>
                <button type="button" className="p-1" aria-label={t("site.editor.moveDown")} onClick={() => onChange(moveItem(value, i, i + 1))}><ArrowDown className="h-3 w-3 rtl:rotate-180" aria-hidden /></button>
              </div>
            </li>
          );
        })}
      </ul>
      <Button id={id} type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}><ImagePlus className="h-4 w-4" aria-hidden /> {t("site.editor.addImages")}</Button>
      <ImagePicker multi open={open} onClose={() => setOpen(false)} onPick={(imgs) => { onChange([...value, ...imgs.map((i) => ({ path: i.path, alt: i.alt ?? undefined, focalX: 50, focalY: 50 }))].slice(0, 80)); setOpen(false); }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rich text (HTML with a tiny toolbar; sanitised on save)
// ---------------------------------------------------------------------------

export function RichTextField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  const wrap = (open: string, close: string, placeholder = "") => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b) || placeholder;
    onChange(`${value.slice(0, a)}${open}${sel}${close}${value.slice(b)}`);
    requestAnimationFrame(() => el.focus());
  };
  const tools: [string, () => void][] = [
    [t("site.editor.rt.bold"), () => wrap("<strong>", "</strong>")],
    [t("site.editor.rt.italic"), () => wrap("<em>", "</em>")],
    [t("site.editor.rt.h2"), () => wrap("<h2>", "</h2>\n")],
    [t("site.editor.rt.h3"), () => wrap("<h3>", "</h3>\n")],
    [t("site.editor.rt.paragraph"), () => wrap("<p>", "</p>\n")],
    [t("site.editor.rt.list"), () => wrap("<ul>\n<li>", "</li>\n</ul>\n")],
    [t("site.editor.rt.link"), () => {
      const url = window.prompt(t("site.editor.rt.linkPrompt"), "https://");
      if (url) wrap(`<a href="${url.replace(/"/g, "")}">`, "</a>", url);
    }],
  ];
  return (
    <div>
      <div className="mb-1 flex flex-wrap gap-1" role="toolbar" aria-label={t("site.editor.rt.toolbar")}>
        {tools.map(([label, fn]) => (
          <button key={label} type="button" onClick={fn} className="rounded border border-border bg-bg-secondary px-2 py-1 text-xs text-text hover:border-brand-primary">
            {label}
          </button>
        ))}
      </div>
      <Textarea id={id} ref={ref} rows={8} dir="auto" className="font-mono text-[13px]" value={value} onChange={(e) => onChange(e.target.value)} />
      <FieldHint>{t("site.editor.rt.hint")}</FieldHint>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic field editor driven by BLOCK_FIELDS
// ---------------------------------------------------------------------------

function FieldEditor({ field, value, onChange, idPrefix }: { field: Field; value: unknown; onChange: (v: unknown) => void; idPrefix: string }) {
  const t = useT();
  const id = `${idPrefix}-${field.key}`;
  const label = t.dynamic(`site.fields.${field.key}`, {}, field.key);
  switch (field.kind) {
    case "text":
    case "href":
      return (
        <div>
          <Label htmlFor={id}>{label}</Label>
          <Input id={id} dir={field.kind === "href" ? "ltr" : "auto"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "textarea":
      return (
        <div className="sm:col-span-2">
          <Label htmlFor={id}>{label}</Label>
          <Textarea id={id} rows={3} dir="auto" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "richtext":
      return (
        <div className="sm:col-span-2">
          <Label htmlFor={id}>{label}</Label>
          <RichTextField id={id} value={(value as string) ?? ""} onChange={onChange} />
        </div>
      );
    case "media":
      return (
        <div className="sm:col-span-2">
          <Label htmlFor={id}>{label}</Label>
          <MediaField id={id} value={value as MediaRef | null} onChange={onChange} />
        </div>
      );
    case "mediaList":
      return (
        <div className="sm:col-span-2">
          <Label htmlFor={id}>{label}</Label>
          <MediaListField id={id} value={(value as MediaRef[]) ?? []} onChange={onChange} />
        </div>
      );
    case "select":
      return (
        <div>
          <Label htmlFor={id}>{label}</Label>
          <Select id={id} value={String(value ?? field.options?.[0] ?? "")} onChange={(e) => onChange(e.target.value)}>
            {(field.options ?? []).map((o) => <option key={o} value={o}>{t.dynamic(`site.options.${field.key}.${o}`, {}, o)}</option>)}
          </Select>
          {field.key === "source" && <FieldHint>{t.dynamic(`site.liveHints.${String(value)}`, {}, "")}</FieldHint>}
        </div>
      );
    case "number":
      return (
        <div>
          <Label htmlFor={id}>{label}</Label>
          <Input id={id} type="number" min={field.min} max={field.max} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
        </div>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-sm text-text">
          <input id={id} type="checkbox" className="h-4 w-4 accent-[var(--brand-primary)]" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      );
    case "ctas": {
      const list = ((value as Obj[]) ?? []) as { label: string; href: string; style: string }[];
      return (
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm font-medium text-text">{label}</p>
          {list.map((c, i) => (
            <div key={i} className="grid gap-2 rounded border border-border-soft p-2 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end">
              <div><Label htmlFor={`${id}-${i}-l`}>{t("site.fields.label")}</Label><Input id={`${id}-${i}-l`} dir="auto" value={c.label} onChange={(e) => onChange(list.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /></div>
              <div><Label htmlFor={`${id}-${i}-h`}>{t("site.fields.href")}</Label><Input id={`${id}-${i}-h`} dir="ltr" placeholder="/register/camps" value={c.href} onChange={(e) => onChange(list.map((x, k) => (k === i ? { ...x, href: e.target.value } : x)))} /></div>
              <div>
                <Label htmlFor={`${id}-${i}-s`}>{t("site.fields.style")}</Label>
                <Select id={`${id}-${i}-s`} value={c.style} onChange={(e) => onChange(list.map((x, k) => (k === i ? { ...x, style: e.target.value } : x)))}>
                  <option value="primary">{t("site.options.style.primary")}</option>
                  <option value="secondary">{t("site.options.style.secondary")}</option>
                </Select>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label={t("site.editor.removeItem")} onClick={() => onChange(list.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
            </div>
          ))}
          {list.length < 3 && <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...list, { label: "", href: "/", style: list.length ? "secondary" : "primary" }])}><Plus className="h-4 w-4" aria-hidden /> {t("site.editor.addButton")}</Button>}
        </div>
      );
    }
    case "items": {
      const list = ((value as Obj[]) ?? []) as Obj[];
      return (
        <div className="space-y-2 sm:col-span-2">
          <p className="text-sm font-medium text-text">{label}</p>
          {list.map((it, i) => (
            <div key={i} className="rounded border border-border-soft p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-text-muted">#{i + 1}</span>
                <div className="flex gap-1">
                  <Button type="button" size="icon" variant="ghost" aria-label={t("site.editor.moveUp")} onClick={() => onChange(moveItem(list, i, i - 1))}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={t("site.editor.moveDown")} onClick={() => onChange(moveItem(list, i, i + 1))}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={t("site.editor.removeItem")} onClick={() => onChange(list.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {(field.item ?? []).map((sub) => (
                  <FieldEditor key={sub.key} field={sub} idPrefix={`${id}-${i}`} value={it[sub.key]} onChange={(v) => onChange(list.map((x, k) => (k === i ? { ...x, [sub.key]: v } : x)))} />
                ))}
              </div>
            </div>
          ))}
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange([...list, Object.fromEntries((field.item ?? []).filter((s) => s.kind === "text" || s.kind === "textarea" || s.kind === "richtext").map((s) => [s.key, ""]))])}>
            <Plus className="h-4 w-4" aria-hidden /> {t("site.editor.addItem")}
          </Button>
        </div>
      );
    }
  }
}

function BlockCard({ block, index, count, onChange, onMove, onDuplicate, onDelete, dragHandlers }: {
  block: Block; index: number; count: number; onChange: (b: Block) => void; onMove: (to: number) => void; onDuplicate: () => void; onDelete: () => void;
  dragHandlers: React.HTMLAttributes<HTMLLIElement> & { draggable: boolean };
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const typeLabel = t.dynamic(`site.blocks.${block.type}`, {}, block.type);
  const summary = (block as Obj).headline ?? (block as Obj).heading ?? (block as Obj).title ?? (block.type === "live" ? t.dynamic(`site.options.source.${block.source}`, {}, block.source) : "");
  return (
    <li {...dragHandlers} className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 p-2">
        <GripVertical className="h-4 w-4 cursor-grab text-text-muted" aria-hidden />
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-tap flex-1 items-center gap-2 text-start">
          <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} aria-hidden />
          <span className="font-medium text-text">{typeLabel}</span>
          {summary ? <span className="truncate text-sm text-text-muted">· {String(summary)}</span> : null}
        </button>
        <Button type="button" size="icon" variant="ghost" disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={t("site.editor.moveBlockUp", { block: typeLabel })}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
        <Button type="button" size="icon" variant="ghost" disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={t("site.editor.moveBlockDown", { block: typeLabel })}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
        <Button type="button" size="icon" variant="ghost" onClick={onDuplicate} aria-label={t("site.editor.duplicateBlock", { block: typeLabel })}><Copy className="h-4 w-4" aria-hidden /></Button>
        <Button type="button" size="icon" variant="ghost" onClick={() => window.confirm(t("site.editor.confirmDeleteBlock")) && onDelete()} aria-label={t("site.editor.deleteBlock", { block: typeLabel })}><Trash2 className="h-4 w-4" aria-hidden /></Button>
      </div>
      {open && (
        <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2">
          <p className="text-sm text-text-muted sm:col-span-2">{t.dynamic(`site.blockHints.${block.type}`, {}, "")}</p>
          {BLOCK_FIELDS[block.type].map((f) => (
            <FieldEditor key={f.key} field={f} idPrefix={block.id} value={(block as Obj)[f.key]} onChange={(v) => onChange({ ...(block as Obj), [f.key]: v } as Block)} />
          ))}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export type EditorPage = {
  id: string; path: string; parentId: string | null; showInNav: boolean; template: string; content: PageContent;
  versions: { id: string; note: string | null; createdAt: string }[];
};

export function PageEditor({ page, languages, defaultLang, images, parents, aiAvailable }: {
  page: EditorPage; languages: string[]; defaultLang: string; images: Img[]; parents: { id: string; title: string; path: string }[]; aiAvailable: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const initial = React.useMemo(() => {
    const c: PageContent = { ...page.content };
    const base = c[defaultLang] ?? Object.values(c)[0];
    for (const l of languages) if (!c[l]) c[l] = { title: base?.title ?? "", state: "needs_translation", blocks: [] };
    return c;
  }, [page.content, languages, defaultLang]);
  const [content, setContent] = React.useState<PageContent>(initial);
  const [lang, setLang] = React.useState(languages.includes(defaultLang) ? defaultLang : languages[0]!);
  const [addType, setAddType] = React.useState<BlockType>("richText");
  const [msg, setMsg] = React.useState<Msg>(null);
  const [busy, setBusy] = React.useState<null | "save" | "meta" | "ai">(null);
  const [drag, setDrag] = React.useState<number | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [meta, setMeta] = React.useState({ path: page.path, parentId: page.parentId ?? "", showInNav: page.showInNav, template: page.template });
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const cur: PageLang = content[lang] ?? { title: "", state: "needs_translation", blocks: [] };
  const update = (next: Partial<PageLang>) => {
    setContent((c) => ({ ...c, [lang]: { ...cur, ...next } }));
    setDirty(true);
  };
  const setBlocks = (blocks: Block[]) => update({ blocks });

  async function save() {
    // Drop empty translations that still wait for a translation and have no blocks: they stay flagged.
    const check = pageContentSchema.safeParse(content);
    if (!check.success) {
      const issue = check.error.issues[0];
      setMsg({ ok: false, text: t("site.errors.content", { where: (issue?.path ?? []).slice(0, 4).join(" › ") || "-" }) });
      return;
    }
    setBusy("save");
    const res = await saveSitePageContent({ id: page.id, content });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) {
      setDirty(false);
      router.refresh();
    }
  }
  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    setBusy("meta");
    const res = await updateSitePageMeta({ id: page.id, path: meta.path, parentId: meta.parentId || null, showInNav: meta.showInNav, template: meta.template as "default" | "landing" | "narrow" });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  function copyFrom(from: string) {
    const src = content[from];
    if (!src) return;
    if (cur.blocks.length && !window.confirm(t("site.editor.confirmCopy", { language: nativeLanguageName(from) }))) return;
    update({ ...src, blocks: cloneBlocks(src.blocks), state: "needs_translation" });
  }
  async function draft(from: string) {
    const src = content[from];
    if (!src) return;
    setBusy("ai");
    const res = await draftSiteTranslation({ from, to: lang, lang: src });
    setBusy(null);
    if (res.ok && res.data) {
      update({ ...res.data.lang, state: "machine_draft" });
      setMsg({ ok: true, text: res.message });
    } else setMsg({ ok: false, text: res.ok ? "" : res.error });
  }
  async function restore(versionId: string) {
    if (dirty && !window.confirm(t("site.editor.confirmRestore"))) return;
    const res = await restoreSiteVersion({ pageId: page.id, versionId });
    setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    if (res.ok) {
      setDirty(false);
      router.refresh();
      window.location.reload();
    }
  }

  return (
    <ImagesCtx.Provider value={images}>
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <div role="tablist" aria-label={t("site.editor.languages")} className="flex flex-wrap gap-1 border-b border-border">
            {languages.map((l) => {
              const st = content[l]?.state ?? "needs_translation";
              return (
                <button
                  key={l}
                  role="tab"
                  type="button"
                  aria-selected={l === lang}
                  onClick={() => setLang(l)}
                  className={cn("inline-flex min-h-tap items-center gap-2 border-b-2 px-3 text-sm", l === lang ? "border-brand-primary text-text" : "border-transparent text-text-muted hover:text-text")}
                >
                  <span lang={l}>{nativeLanguageName(l)}</span>
                  {l === defaultLang && <Badge tone="brand">{t("site.editor.default")}</Badge>}
                  {st !== "ok" && <Badge tone="warning">{t.dynamic(`site.langState.${st}`)}</Badge>}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" className="space-y-5" lang={lang}>
            {(cur.state !== "ok" || lang !== defaultLang) && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-bg-secondary p-3 text-sm">
                {cur.state === "needs_translation" && <span className="me-auto text-warning">{t("site.editor.needsTranslation")}</span>}
                {cur.state === "machine_draft" && <span className="me-auto text-warning">{t("site.editor.machineDraftNotice")}</span>}
                {cur.state === "ok" && <span className="me-auto text-text-muted">{t("site.editor.translationOk")}</span>}
                {lang !== defaultLang && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => copyFrom(defaultLang)}>
                    <Languages className="h-4 w-4" aria-hidden /> {t("site.editor.copyFrom", { language: nativeLanguageName(defaultLang) })}
                  </Button>
                )}
                {lang !== defaultLang && aiAvailable && (
                  <Button type="button" size="sm" variant="secondary" loading={busy === "ai"} onClick={() => draft(defaultLang)}>
                    <Sparkles className="h-4 w-4" aria-hidden /> {t("site.editor.draftTranslation")}
                  </Button>
                )}
                {cur.state !== "ok" && (
                  <Button type="button" size="sm" onClick={() => update({ state: "ok" })}>{t("site.editor.markReviewed")}</Button>
                )}
              </div>
            )}

            <Card>
              <CardBody className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="pg-title">{t("site.pages.title")}</Label>
                  <Input id="pg-title" dir="auto" maxLength={200} value={cur.title} onChange={(e) => update({ title: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="pg-mt">{t("site.fields.metaTitle")}</Label>
                  <Input id="pg-mt" dir="auto" maxLength={120} value={cur.metaTitle ?? ""} onChange={(e) => update({ metaTitle: e.target.value })} />
                </div>
                <div>
                  <Label htmlFor="pg-md">{t("site.fields.metaDescription")}</Label>
                  <Textarea id="pg-md" dir="auto" rows={2} maxLength={320} value={cur.metaDescription ?? ""} onChange={(e) => update({ metaDescription: e.target.value })} />
                  <FieldHint>{t("site.editor.metaCount", { count: (cur.metaDescription ?? "").length })}</FieldHint>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="pg-og">{t("site.fields.ogImage")}</Label>
                  <MediaField id="pg-og" value={cur.ogImage ?? null} onChange={(v) => update({ ogImage: v })} />
                </div>
              </CardBody>
            </Card>

            <ol className="space-y-2" aria-label={t("site.editor.blocks")}>
              {cur.blocks.map((b, i) => (
                <BlockCard
                  key={b.id}
                  block={b}
                  index={i}
                  count={cur.blocks.length}
                  onChange={(nb) => setBlocks(cur.blocks.map((x, k) => (k === i ? nb : x)))}
                  onMove={(to) => setBlocks(moveItem(cur.blocks, i, to))}
                  onDuplicate={() => setBlocks([...cur.blocks.slice(0, i + 1), { ...(JSON.parse(JSON.stringify(b)) as Block), id: newBlockId() }, ...cur.blocks.slice(i + 1)])}
                  onDelete={() => setBlocks(cur.blocks.filter((_, k) => k !== i))}
                  dragHandlers={{
                    draggable: true,
                    onDragStart: () => setDrag(i),
                    onDragOver: (e) => e.preventDefault(),
                    onDrop: () => {
                      if (drag !== null) setBlocks(moveItem(cur.blocks, drag, i));
                      setDrag(null);
                    },
                  }}
                />
              ))}
            </ol>
            {!cur.blocks.length && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">{t("site.editor.noBlocks")}</p>}

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="add-type">{t("site.editor.addBlock")}</Label>
                <Select id="add-type" value={addType} onChange={(e) => setAddType(e.target.value as BlockType)}>
                  {BLOCK_TYPES.map((b) => <option key={b} value={b}>{t.dynamic(`site.blocks.${b}`, {}, b)}</option>)}
                </Select>
              </div>
              <Button type="button" variant="secondary" onClick={() => setBlocks([...cur.blocks, newBlock(addType)])}><Plus className="h-4 w-4" aria-hidden /> {t("site.editor.add")}</Button>
            </div>

            <div className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-border bg-bg py-3">
              <Button onClick={save} loading={busy === "save"} disabled={!!busy}>{t("site.editor.save")}</Button>
              {dirty && <span className="text-sm text-warning">{t("site.editor.unsaved")}</span>}
              <Status msg={msg} />
            </div>
          </div>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{t("site.editor.pageSettings")}</CardTitle></CardHeader>
            <CardBody>
              <form onSubmit={saveMeta} className="space-y-3">
                <div><Label htmlFor="m-path">{t("site.pages.path")}</Label><Input id="m-path" dir="ltr" value={meta.path} onChange={(e) => setMeta({ ...meta, path: e.target.value })} /></div>
                <FieldHint>{t("site.editor.pathHint")}</FieldHint>
                <div>
                  <Label htmlFor="m-parent">{t("site.pages.parent")}</Label>
                  <Select id="m-parent" value={meta.parentId} onChange={(e) => setMeta({ ...meta, parentId: e.target.value })}>
                    <option value="">{t("site.pages.noParent")}</option>
                    {parents.filter((p) => p.id !== page.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="m-tpl">{t("site.editor.layout")}</Label>
                  <Select id="m-tpl" value={meta.template} onChange={(e) => setMeta({ ...meta, template: e.target.value })}>
                    {(["default", "landing", "narrow"] as const).map((k) => <option key={k} value={k}>{t.dynamic(`site.options.layout.${k}`, {}, k)}</option>)}
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--brand-primary)]" checked={meta.showInNav} onChange={(e) => setMeta({ ...meta, showInNav: e.target.checked })} />{t("site.pages.showInNav")}</label>
                <Button type="submit" size="sm" variant="secondary" loading={busy === "meta"}>{t("common.save")}</Button>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("site.editor.history")}</CardTitle></CardHeader>
            <CardBody>
              {page.versions.length ? (
                <ul className="space-y-2 text-sm">
                  {page.versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2">
                      <span><span className="text-text">{f.dateTime(v.createdAt)}</span> <span className="text-text-muted">· {t.dynamic(`site.versionNotes.${(v.note ?? "save").replace(/\s+/g, "_")}`, {}, v.note ?? "")}</span></span>
                      <Button size="sm" variant="ghost" onClick={() => restore(v.id)}><RotateCcw className="h-3.5 w-3.5" aria-hidden /> {t("site.editor.restore")}</Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">{t("site.editor.noHistory")}</p>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </ImagesCtx.Provider>
  );
}
