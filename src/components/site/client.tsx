"use client";

import * as React from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Globe, Menu, Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { submitSiteForm } from "@/lib/actions/site-forms";
import { HONEYPOT_FIELD } from "@/lib/site/forms";
import type { FormKind } from "@/lib/site/blocks";

/**
 * Interactive pieces of the club site. Every string arrives as a prop from
 * the server (translated for the page language), so these work for any site
 * language, including ones the app UI does not ship.
 */

// ---------------------------------------------------------------------------
// Gallery with lightbox (keyboard: arrows, Escape; focus returns)
// ---------------------------------------------------------------------------

export type GalleryImage = { url: string; alt: string; width: number; height: number; pos: string };

export function GalleryLightbox({ images, columns, labels }: { images: GalleryImage[]; columns: number; labels: { open: string; close: string; prev: string; next: string; counter: string } }) {
  const [index, setIndex] = React.useState<number | null>(null);
  const triggers = React.useRef<(HTMLButtonElement | null)[]>([]);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const close = React.useCallback(() => {
    setIndex((i) => {
      if (i !== null) setTimeout(() => triggers.current[i]?.focus(), 0);
      return null;
    });
  }, []);
  const step = React.useCallback((d: number) => setIndex((i) => (i === null ? i : (i + d + images.length) % images.length)), [images.length]);
  React.useEffect(() => {
    if (index === null) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(document.dir === "rtl" ? -1 : 1);
      else if (e.key === "ArrowLeft") step(document.dir === "rtl" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [index, close, step]);
  const cols = columns === 2 ? "sm:grid-cols-2" : columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : columns === 5 ? "sm:grid-cols-3 lg:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-3";
  const cur = index === null ? null : images[index];
  return (
    <>
      <ul className={cn("grid grid-cols-2 gap-2 sm:gap-3", cols)}>
        {images.map((img, i) => (
          <li key={img.url} className={cn(i % 7 === 0 && columns >= 3 ? "row-span-2" : "")}>
            <button
              type="button"
              ref={(el) => {
                triggers.current[i] = el;
              }}
              onClick={() => setIndex(i)}
              className="group relative block h-full min-h-[9rem] w-full overflow-hidden rounded-[var(--site-radius)] focus-visible:shadow-focus focus-visible:outline-none"
              aria-label={img.alt ? `${labels.open}: ${img.alt}` : labels.open}
            >
              <Image src={img.url} alt={img.alt} fill sizes="(min-width: 1024px) 25vw, 50vw" className="object-cover transition duration-500 group-hover:scale-105" style={{ objectPosition: img.pos }} />
            </button>
          </li>
        ))}
      </ul>
      {cur && (
        <div role="dialog" aria-modal="true" aria-label={cur.alt || labels.open} className="fixed inset-0 z-[100] flex items-center justify-center site-lightbox p-4" onClick={close}>
          <div className="relative h-full max-h-[88vh] w-full max-w-6xl" onClick={(e) => e.stopPropagation()}>
            <Image src={cur.url} alt={cur.alt} fill sizes="100vw" className="object-contain" />
          </div>
          <p className="absolute bottom-4 start-1/2 -translate-x-1/2 text-sm site-on-scrim rtl:translate-x-1/2" aria-live="polite">
            {labels.counter.replace("{current}", String((index ?? 0) + 1)).replace("{total}", String(images.length))}
          </p>
          <button ref={closeRef} type="button" onClick={close} aria-label={labels.close} className="absolute end-4 top-4 rounded-full p-3 site-on-scrim focus-visible:shadow-focus">
            <X className="h-6 w-6" aria-hidden />
          </button>
          {images.length > 1 && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); step(-1); }} aria-label={labels.prev} className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full p-3 site-on-scrim focus-visible:shadow-focus">
                <ChevronLeft className="h-8 w-8 rtl:rotate-180" aria-hidden />
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); step(1); }} aria-label={labels.next} className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-3 site-on-scrim focus-visible:shadow-focus">
                <ChevronRight className="h-8 w-8 rtl:rotate-180" aria-hidden />
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Video: click-to-load facade (no third-party request before the click)
// ---------------------------------------------------------------------------

export function VideoFacade({ embedUrl, thumbUrl, title, playLabel, notice }: { embedUrl: string; thumbUrl: string | null; title: string; playLabel: string; notice: string }) {
  const [on, setOn] = React.useState(false);
  if (on) {
    return (
      <iframe
        src={embedUrl}
        title={title}
        className="absolute inset-0 h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  return (
    <button type="button" onClick={() => setOn(true)} className="group absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-secondary focus-visible:shadow-focus focus-visible:outline-none">
      {thumbUrl && <Image src={thumbUrl} alt="" fill sizes="(min-width: 1024px) 60vw, 100vw" className="object-cover opacity-70 transition group-hover:opacity-90" />}
      <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand-primary text-on-brand shadow-glow-strong transition group-hover:scale-110">
        <Play className="ms-1 h-7 w-7" aria-hidden />
      </span>
      <span className="relative site-chip-dark rounded px-3 py-1 text-xs">{playLabel}</span>
      <span className="relative max-w-sm px-4 text-center site-chip-dark rounded text-[11px]">{notice}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Animated counter (reduced-motion: final value at once)
// ---------------------------------------------------------------------------

export function CountUp({ value, locale }: { value: string; locale: string }) {
  const m = /^([^\d-]*)(-?\d[\d'.,\s]*)(.*)$/.exec(value);
  const target = m ? Number(m[2]!.replace(/[^\d.-]/g, "")) : NaN;
  const [shown, setShown] = React.useState(value);
  const ref = React.useRef<HTMLSpanElement | null>(null);
  React.useEffect(() => {
    if (!m || !Number.isFinite(target) || target <= 0 || target > 1e9) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    if (!el) return;
    const fmt = new Intl.NumberFormat(locale);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / 1400);
        const eased = 1 - Math.pow(1 - p, 3);
        setShown(`${m[1]}${fmt.format(Math.round(target * eased))}${m[3]}`);
        if (p < 1) raf = requestAnimationFrame(tick);
        else setShown(value);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, locale]);
  return (
    <span ref={ref} aria-label={value}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hero slideshow: cross-fading slides (server-rendered), dots, pause / play.
// No autoplay when the visitor prefers reduced motion; pauses on hover / focus.
// ---------------------------------------------------------------------------

export function HeroSlideshow({ children, autoplay, interval, labels }: { children: React.ReactNode[]; autoplay: boolean; interval: number; labels: { pause: string; play: string; goTo: string; slide: string } }) {
  const count = children.length;
  const [index, setIndex] = React.useState(0);
  const [playing, setPlaying] = React.useState(autoplay);
  const [hold, setHold] = React.useState(false);
  React.useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);
  React.useEffect(() => {
    if (!playing || hold || count < 2) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % count), Math.max(3, interval) * 1000);
    return () => window.clearTimeout(id);
  }, [playing, hold, index, count, interval]);
  const fmt = (s: string, n: number) => s.replace("{n}", String(n)).replace("{count}", String(count));
  return (
    <div className="absolute inset-0" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocus={() => setHold(true)} onBlur={() => setHold(false)}>
      {children.map((child, i) => (
        <div
          key={i}
          className="site-slide absolute inset-0"
          data-active={i === index ? "true" : "false"}
          role="group"
          aria-roledescription={labels.slide}
          aria-label={fmt("{n} / {count}", i + 1)}
          aria-hidden={i === index ? undefined : true}
          inert={i === index ? undefined : true}
        >
          {child}
        </div>
      ))}
      {count > 1 && (
        <div className="absolute inset-x-0 bottom-6 z-10 flex items-center justify-center gap-3">
          <button type="button" onClick={() => setPlaying((p) => !p)} className="site-chip-dark inline-flex min-h-tap min-w-tap items-center justify-center rounded-full focus-visible:shadow-focus" aria-label={playing ? labels.pause : labels.play}>
            {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          </button>
          <ul className="flex items-center gap-1">
            {children.map((_, i) => (
              <li key={i}>
                <button type="button" onClick={() => setIndex(i)} aria-current={i === index ? "true" : undefined} aria-label={fmt(labels.goTo, i + 1)} className="inline-flex min-h-tap min-w-tap items-center justify-center focus-visible:shadow-focus">
                  <span className="site-slide-dot" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header: mobile menu + language menu
// ---------------------------------------------------------------------------

export type NavLink = { label: string; href: string; current: boolean; children?: { label: string; href: string; current: boolean }[] };

export function MobileNav({ links, extra, labels, wide = false }: { links: NavLink[]; wide?: boolean; extra: { label: string; href: string; primary?: boolean }[]; labels: { open: string; close: string; nav: string } }) {
  const [open, setOpen] = React.useState(false);
  const btn = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className={wide ? "xl:hidden" : "lg:hidden"}>
      <button ref={btn} type="button" aria-expanded={open} aria-controls="site-mobile-nav" onClick={() => setOpen((v) => !v)} className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-full focus-visible:shadow-focus">
        {open ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
        <span className="sr-only">{open ? labels.close : labels.open}</span>
      </button>
      {open && (
        <nav id="site-mobile-nav" aria-label={labels.nav} className="site-header-glass fixed inset-x-0 top-16 z-50 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-border px-4 pb-8 pt-4">
          <ul className="space-y-1">
            {links.map((l, i) => (
              <li key={`${l.href}-${i}`}>
                {l.href ? (
                  <a href={l.href} aria-current={l.current ? "page" : undefined} className={cn("block rounded-md px-3 py-3 text-lg font-medium", l.current ? "text-brand-primary" : "text-text")}>
                    {l.label}
                  </a>
                ) : (
                  <p className={cn("px-3 pb-1 pt-3 text-lg font-medium", l.current ? "text-brand-primary" : "text-text")}>{l.label}</p>
                )}
                {!!l.children?.length && (
                  <ul className="ms-4 border-s border-border ps-3">
                    {l.children.map((c, k) => (
                      <li key={`${c.href}-${k}`}>
                        <a href={c.href} aria-current={c.current ? "page" : undefined} className="block px-3 py-2 text-text-secondary">
                          {c.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-col gap-3">
            {extra.map((x) => (
              <a key={x.href} href={x.href} className={cn("site-btn", x.primary ? "site-btn-primary" : "site-btn-secondary")}>
                {x.label}
              </a>
            ))}
          </div>
        </nav>
      )}
    </div>
  );
}

export function LanguageMenu({ current, options, label }: { current: string; options: { tag: string; name: string; href: string }[]; label: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (options.length < 2) return null;
  const cur = options.find((o) => o.tag === current);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((v) => !v)} className="inline-flex min-h-tap items-center gap-1.5 rounded-full px-3 text-sm font-medium focus-visible:shadow-focus">
        <Globe className="h-4 w-4" aria-hidden />
        <span className="sr-only">{label}: </span>
        <span>{cur?.name ?? current}</span>
      </button>
      {open && (
        <ul className="absolute end-0 top-full z-50 mt-2 min-w-[11rem] overflow-hidden rounded-md border border-border bg-surface-elevated py-1 shadow-lg">
          {options.map((o) => (
            <li key={o.tag}>
              <a href={o.href} hrefLang={o.tag} lang={o.tag} aria-current={o.tag === current ? "true" : undefined} className={cn("block px-4 py-2 text-sm hover:bg-surface", o.tag === current ? "font-semibold text-brand-primary" : "text-text")}>
                {o.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms (contact / join / applications)
// ---------------------------------------------------------------------------

export type SiteFormLabels = {
  name: string; email: string; phone: string; message: string; consent: string; submit: string; sending: string;
  optional: string; honeypot: string; minorsNote?: string;
};

export function SiteForm({ kind, lang, pagePath, labels }: { kind: FormKind; lang: string; pagePath: string; labels: SiteFormLabels }) {
  const [state, setState] = React.useState<{ status: "idle" | "sending" | "done" | "error"; message?: string }>({ status: "idle" });
  const startedAt = React.useRef<number>(0);
  React.useEffect(() => {
    startedAt.current = Date.now();
  }, []);
  const id = React.useId();
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setState({ status: "sending" });
    const res = await submitSiteForm({
      kind,
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? "") || undefined,
      message: String(fd.get("message") ?? ""),
      consent: fd.get("consent") === "on" ? true : (false as unknown as true),
      lang,
      pagePath,
      startedAt: startedAt.current,
      [HONEYPOT_FIELD]: String(fd.get(HONEYPOT_FIELD) ?? ""),
    });
    setState(res.ok ? { status: "done", message: res.message } : { status: "error", message: res.error });
  }
  if (state.status === "done") {
    return (
      <p role="status" className="site-card p-6 text-lg text-text">
        {state.message}
      </p>
    );
  }
  const field = "mt-1 block w-full rounded-md border border-border bg-surface-input px-3 py-3 text-text placeholder:text-text-muted focus-visible:shadow-focus focus-visible:outline-none";
  return (
    <form onSubmit={onSubmit} className="site-card grid gap-4 p-6 sm:grid-cols-2 sm:p-8" noValidate={false}>
      {labels.minorsNote && <p className="text-sm text-text-secondary sm:col-span-2">{labels.minorsNote}</p>}
      <label className="block text-sm font-medium text-text" htmlFor={`${id}-name`}>
        {labels.name}
        <input id={`${id}-name`} name="name" required maxLength={120} autoComplete="name" className={field} />
      </label>
      <label className="block text-sm font-medium text-text" htmlFor={`${id}-email`}>
        {labels.email}
        <input id={`${id}-email`} name="email" type="email" required maxLength={254} autoComplete="email" className={field} />
      </label>
      <label className="block text-sm font-medium text-text sm:col-span-2" htmlFor={`${id}-phone`}>
        {labels.phone} <span className="font-normal text-text-muted">({labels.optional})</span>
        <input id={`${id}-phone`} name="phone" type="tel" maxLength={40} autoComplete="tel" className={field} />
      </label>
      <label className="block text-sm font-medium text-text sm:col-span-2" htmlFor={`${id}-message`}>
        {labels.message}
        <textarea id={`${id}-message`} name="message" required maxLength={3000} rows={5} className={field} />
      </label>
      {/* Honeypot: hidden from people and assistive tech, bots fill it. */}
      <div aria-hidden="true" className="absolute -start-[10000px] h-px w-px overflow-hidden">
        <label>
          {labels.honeypot}
          <input name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <label className="flex items-start gap-3 text-sm text-text-secondary sm:col-span-2">
        <input name="consent" type="checkbox" required className="mt-1 h-5 w-5 accent-[var(--brand-primary)]" />
        <span>{labels.consent}</span>
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {state.message}
        </p>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={state.status === "sending"} className="site-btn site-btn-primary disabled:opacity-60">
          {state.status === "sending" ? labels.sending : labels.submit}
        </button>
      </div>
    </form>
  );
}
