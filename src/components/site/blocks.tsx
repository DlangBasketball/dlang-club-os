import { MapPin, Clock, Phone, Mail, ChevronDown, Quote } from "lucide-react";
import { cn } from "@/lib/utils";
import { objectPosition } from "@/lib/media/cover";
import { videoEmbed, type Block, type BlockOf, type Cta } from "@/lib/site/blocks";
import { localizedPath } from "@/lib/site/paths";
import { loadSponsorNames } from "@/lib/site/live";
import { LiveBlockView } from "./live-blocks";
import { CountUp, GalleryLightbox, HeroSlideshow, SiteForm, VideoFacade } from "./client";
import { SiteImage, resolveImg } from "./site-image";
import type { RenderCtx } from "./types";

/**
 * Server rendering of site blocks. Text is escaped by React; rich text was
 * sanitised when it was saved (sanitizeRichText) and is re-sanitised on parse.
 * Logical properties (start / end, ms / me, ps / pe) keep RTL languages right.
 */

const WRAP = "mx-auto w-full max-w-[var(--site-max)] px-4 sm:px-6 lg:px-8";

/** Internal links get the page language prefix (/fr/...); external stay as they are. */
export function siteHref(ctx: RenderCtx, href: string): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const appPath = /^\/(register|book|shop|club|login|embed|legal|api|signup|waitlist)(\/|$|\?)/.test(href);
  if (appPath) return href;
  const [path, rest] = href.split(/(?=[?#])/);
  return `${localizedPath(path || "/", ctx.lang, ctx.defaultLang)}${rest ?? ""}`;
}

function Ctas({ ctas, ctx, onPhoto = false }: { ctas: Cta[]; ctx: RenderCtx; onPhoto?: boolean }) {
  if (!ctas.length) return null;
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      {ctas.map((c, i) => (
        <a key={i} href={siteHref(ctx, c.href)} className={cn("site-btn", c.style === "primary" ? "site-btn-primary" : "site-btn-secondary", onPhoto && c.style !== "primary" && "site-on-scrim")}>
          {c.label}
        </a>
      ))}
    </div>
  );
}

export function SectionHead({ eyebrow, heading, intro, center = false, id }: { eyebrow?: string; heading?: string; intro?: string; center?: boolean; id?: string }) {
  if (!eyebrow && !heading && !intro) return null;
  return (
    <header className={cn("mb-10 max-w-3xl", center && "mx-auto text-center")}>
      {eyebrow && <p className="site-eyebrow">{eyebrow}</p>}
      {heading && (
        <h2 id={id} className="site-h mt-2 text-3xl text-text sm:text-4xl lg:text-5xl">
          {heading}
        </h2>
      )}
      {intro && <p className="mt-4 text-lg text-text-secondary">{intro}</p>}
    </header>
  );
}

function Hero({ b, ctx, first }: { b: BlockOf<"hero">; ctx: RenderCtx; first: boolean }) {
  const img = resolveImg(ctx, b.image);
  const video = b.videoUrl ? videoEmbed(b.videoUrl) : null;
  const h = b.height === "full" ? "min-h-[88svh]" : b.height === "large" ? "min-h-[68svh]" : "min-h-[44svh]";
  const Tag = first ? "h1" : "h2";
  if (b.slides?.length && !video) {
    // Slideshow: the block's own slide first, then the extra slides (h1 only on the first one).
    const slides = [{ eyebrow: b.eyebrow, headline: b.headline, subheadline: b.subheadline, image: b.image, ctas: b.ctas }, ...b.slides];
    return (
      <section className={cn("relative isolate overflow-hidden bg-cover-fallback", h)} aria-roledescription={ctx.t("site.render.slideshow")} aria-label={b.headline || ctx.site.tenant.name}>
        <HeroSlideshow
          autoplay={b.autoplay !== false}
          interval={b.interval ?? 7}
          labels={{ pause: ctx.t("site.render.slidePause"), play: ctx.t("site.render.slidePlay"), goTo: ctx.t("site.render.slideGoTo"), slide: ctx.t("site.render.slide") }}
        >
          {slides.map((s, i) => {
            const simg = resolveImg(ctx, s.image ?? null);
            const STag = i === 0 ? Tag : "p";
            return (
              <div key={i} className="relative flex h-full items-end">
                {simg ? (
                  <div className="absolute inset-0 -z-20 site-kenburns">
                    <SiteImage img={simg} fill sizes="100vw" priority={first && i === 0} unclearedLabel={ctx.t("site.render.notCleared")} />
                  </div>
                ) : (
                  <div aria-hidden className="absolute inset-0 -z-20 bg-cover-pattern" />
                )}
                <div aria-hidden className="absolute inset-0 -z-10 site-scrim" style={{ opacity: b.overlay / 100 }} />
                <div aria-hidden className="absolute inset-0 -z-10 site-scrim-gradient" />
                <div className={cn(WRAP, "pb-20 pt-32 sm:pb-28", b.align === "center" && "text-center")}>
                  <div className={cn("max-w-4xl", b.align === "center" && "mx-auto")}>
                    {s.eyebrow && <p className="site-eyebrow site-on-photo">{s.eyebrow}</p>}
                    {s.headline && <STag className="site-h site-on-photo mt-3 text-5xl sm:text-6xl lg:text-7xl xl:text-8xl">{s.headline}</STag>}
                    {s.subheadline && <p className="site-on-photo mt-6 max-w-2xl text-lg sm:text-xl">{s.subheadline}</p>}
                    <div className={cn(b.align === "center" && "flex justify-center")}>
                      <Ctas ctas={s.ctas ?? []} ctx={ctx} onPhoto />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </HeroSlideshow>
      </section>
    );
  }
  return (
    <section className={cn("relative isolate flex items-end overflow-hidden bg-cover-fallback", h)}>
      {video?.kind === "file" ? (
        <video className="absolute inset-0 -z-20 h-full w-full object-cover" src={video.url} autoPlay muted loop playsInline aria-hidden poster={img?.url} />
      ) : img ? (
        <div className="absolute inset-0 -z-20 site-kenburns">
          <SiteImage img={img} fill sizes="100vw" priority={first} unclearedLabel={ctx.t("site.render.notCleared")} />
        </div>
      ) : (
        <div aria-hidden className="absolute inset-0 -z-20 bg-cover-pattern" />
      )}
      <div aria-hidden className="absolute inset-0 -z-10 site-scrim" style={{ opacity: b.overlay / 100 }} />
      <div aria-hidden className="absolute inset-0 -z-10 site-scrim-gradient" />
      <div className={cn(WRAP, "pb-16 pt-32 sm:pb-24", b.align === "center" && "text-center")}>
        <div className={cn("max-w-4xl", b.align === "center" && "mx-auto")}>
          {b.eyebrow && <p className="site-eyebrow site-on-photo">{b.eyebrow}</p>}
          {b.headline && <Tag className="site-h site-on-photo mt-3 text-5xl sm:text-6xl lg:text-7xl xl:text-8xl">{b.headline}</Tag>}
          {b.subheadline && <p className="site-on-photo mt-6 max-w-2xl text-lg sm:text-xl">{b.subheadline}</p>}
          <div className={cn(b.align === "center" && "flex justify-center")}>
            <Ctas ctas={b.ctas} ctx={ctx} onPhoto />
          </div>
        </div>
      </div>
    </section>
  );
}

function Rich({ html, className }: { html: string; className?: string }) {
  // html is sanitised (sanitizeRichText) by the block schema on save and on parse.
  return <div className={cn("site-prose", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

function TwoColumn({ b, ctx }: { b: BlockOf<"twoColumn">; ctx: RenderCtx }) {
  const img = resolveImg(ctx, b.image);
  return (
    <section className={cn(WRAP, "site-reveal py-16 sm:py-24")}>
      <div className={cn("grid items-center gap-10 lg:grid-cols-2 lg:gap-16", !img && "lg:grid-cols-1")}>
        {img && (
          <div className={cn("relative aspect-[4/3] overflow-hidden rounded-[var(--site-radius)] shadow-lg", b.imageSide === "start" ? "lg:order-first" : "lg:order-last")}>
            <SiteImage img={img} fill sizes="(min-width: 1024px) 50vw, 100vw" unclearedLabel={ctx.t("site.render.notCleared")} />
          </div>
        )}
        <div>
          {b.eyebrow && <p className="site-eyebrow">{b.eyebrow}</p>}
          {b.heading && <h2 className="site-h mt-2 text-3xl text-text sm:text-4xl lg:text-5xl">{b.heading}</h2>}
          <Rich html={b.html} className="mt-6" />
          <Ctas ctas={b.ctas} ctx={ctx} />
        </div>
      </div>
    </section>
  );
}

function Stats({ b, ctx }: { b: BlockOf<"stats">; ctx: RenderCtx }) {
  if (!b.items.length) return null;
  return (
    <section className="site-band-deep py-16 sm:py-20">
      <div className={WRAP}>
        <SectionHead heading={b.heading} center />
        <dl className={cn("grid gap-8 text-center", b.items.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-3")}>
          {b.items.map((it, i) => (
            <div key={i} className="flex flex-col-reverse">
              <dt className="mt-2 text-sm uppercase tracking-[0.16em] text-text-secondary">{it.label}</dt>
              <dd className="site-h text-5xl text-brand-accent sm:text-6xl">
                <CountUp value={it.value} locale={ctx.f.locale} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function Cards({ b, ctx }: { b: BlockOf<"cards">; ctx: RenderCtx }) {
  if (!b.items.length) return null;
  const cols = b.columns === 2 ? "sm:grid-cols-2" : b.columns === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <section className={cn(WRAP, "py-16 sm:py-24")}>
      <SectionHead eyebrow={b.eyebrow} heading={b.heading} intro={b.intro} />
      <ul className={cn("grid gap-5", cols)}>
        {b.items.map((it, i) => {
          const img = resolveImg(ctx, it.image);
          const inner = (
            <>
              <div className="relative aspect-[4/5] overflow-hidden bg-cover-fallback">
                {img ? <SiteImage img={img} fill sizes="(min-width: 1024px) 33vw, 100vw" className="transition duration-700 group-hover:scale-105" unclearedLabel={ctx.t("site.render.notCleared")} /> : <div aria-hidden className="absolute inset-0 bg-cover-pattern" />}
                <div aria-hidden className="absolute inset-0 site-scrim-gradient" />
                <div className="absolute inset-x-0 bottom-0 p-5">
                  {it.eyebrow && <p className="site-eyebrow site-on-photo">{it.eyebrow}</p>}
                  <h3 className="site-h site-on-photo mt-1 text-2xl sm:text-3xl">{it.title}</h3>
                </div>
              </div>
              {it.text && <p className="p-5 text-text-secondary">{it.text}</p>}
            </>
          );
          return (
            <li key={i} className="site-reveal site-card group overflow-hidden">
              {it.href ? (
                <a href={siteHref(ctx, it.href)} className="block focus-visible:shadow-focus focus-visible:outline-none">
                  {inner}
                </a>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Testimonials({ b }: { b: BlockOf<"testimonials"> }) {
  if (!b.items.length) return null;
  return (
    <section className={cn(WRAP, "py-16 sm:py-24")}>
      <SectionHead heading={b.heading} center />
      <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {b.items.map((it, i) => (
          <li key={i} className="site-reveal site-card flex flex-col p-8">
            <Quote className="h-8 w-8 text-brand-accent rtl:-scale-x-100" aria-hidden />
            <blockquote className="mt-4 flex-1 text-lg text-text">{it.quote}</blockquote>
            <p className="mt-6 font-semibold text-text">{it.name}</p>
            {it.role && <p className="text-sm text-text-muted">{it.role}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Logos({ b, ctx }: { b: BlockOf<"logos">; ctx: RenderCtx }) {
  const sponsors = b.source === "sponsors" ? await loadSponsorNames(ctx.site.orgId) : [];
  const manual = b.items.map((it) => ({ name: it.name, img: resolveImg(ctx, it.image), href: it.href }));
  const names = new Set(manual.map((m) => m.name.toLowerCase()));
  const items = [...manual, ...sponsors.filter((s) => !names.has(s.name.toLowerCase())).map((s) => ({ name: s.name, img: null, href: undefined }))];
  if (!items.length) return null;
  return (
    <section className={cn(WRAP, "py-14 sm:py-20")}>
      <SectionHead heading={b.heading} center />
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-8">
        {items.map((it, i) => {
          const body = it.img ? (
            <span className="relative block h-16 w-40 opacity-80 grayscale transition hover:opacity-100 hover:grayscale-0">
              <SiteImage img={it.img} fill sizes="160px" className="!object-contain" alt={it.name} />
            </span>
          ) : (
            <span className="site-h text-xl text-text-secondary">{it.name}</span>
          );
          return (
            <li key={i}>
              {it.href ? (
                <a href={it.href} rel="noopener noreferrer sponsored" target="_blank" className="block focus-visible:shadow-focus">
                  {body}
                </a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Faq({ b }: { b: BlockOf<"faq"> }) {
  if (!b.items.length) return null;
  return (
    <section className={cn(WRAP, "max-w-4xl py-16 sm:py-24")}>
      <SectionHead heading={b.heading} />
      <div className="divide-y divide-border border-y border-border">
        {b.items.map((it, i) => (
          <details key={i} className="group py-2">
            <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-4 py-3 text-lg font-medium text-text focus-visible:shadow-focus [&::-webkit-details-marker]:hidden">
              {it.q}
              <ChevronDown className="h-5 w-5 shrink-0 transition group-open:rotate-180" aria-hidden />
            </summary>
            <Rich html={it.a} className="pb-4" />
          </details>
        ))}
      </div>
    </section>
  );
}

function CtaBanner({ b, ctx }: { b: BlockOf<"cta">; ctx: RenderCtx }) {
  const img = resolveImg(ctx, b.image);
  const tone = b.tone === "brand" ? "site-band" : b.tone === "dark" ? "site-band-deep" : "bg-surface text-text";
  return (
    <section className={cn("relative isolate overflow-hidden py-20 sm:py-28", img ? "" : tone)}>
      {img && (
        <>
          <div className="absolute inset-0 -z-20">
            <SiteImage img={img} fill sizes="100vw" unclearedLabel={ctx.t("site.render.notCleared")} />
          </div>
          <div aria-hidden className="absolute inset-0 -z-10 site-scrim opacity-60" />
        </>
      )}
      <div className={cn(WRAP, "text-center")}>
        <h2 className={cn("site-h mx-auto max-w-4xl text-4xl sm:text-5xl lg:text-6xl", img && "site-on-photo")}>{b.heading}</h2>
        {b.text && <p className={cn("mx-auto mt-5 max-w-2xl text-lg opacity-90", img && "site-on-photo")}>{b.text}</p>}
        <div className="flex justify-center">
          <Ctas ctas={b.ctas} ctx={ctx} onPhoto={!!img} />
        </div>
      </div>
    </section>
  );
}

function FormBlock({ b, ctx }: { b: BlockOf<"form">; ctx: RenderCtx }) {
  const t = ctx.t;
  return (
    <section className={cn(WRAP, "max-w-4xl py-16 sm:py-24")} id={`form-${b.kind}`}>
      <SectionHead heading={b.heading ?? t.dynamic(`site.form.titles.${b.kind}`)} intro={b.intro} />
      <SiteForm
        kind={b.kind}
        lang={ctx.lang}
        pagePath={ctx.path}
        labels={{
          name: b.kind === "athlete_application" ? t("site.form.nameGuardian") : t("site.form.name"),
          email: t("site.form.email"),
          phone: t("site.form.phone"),
          message: t("site.form.message"),
          consent: t("site.form.consent", { club: ctx.site.tenant.name }),
          submit: t("site.form.submit"),
          sending: t("site.form.sending"),
          optional: t("site.form.optional"),
          honeypot: t("site.form.honeypot"),
          minorsNote: b.kind === "athlete_application" ? t("site.form.minorsNote") : undefined,
        }}
      />
    </section>
  );
}

function MapBlock({ b, ctx }: { b: BlockOf<"map">; ctx: RenderCtx }) {
  const q = [b.venueName, b.address].filter(Boolean).join(", ");
  const hasPoint = typeof b.lat === "number" && typeof b.lng === "number";
  const osm = hasPoint
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${b.lng! - 0.01}%2C${b.lat! - 0.006}%2C${b.lng! + 0.01}%2C${b.lat! + 0.006}&layer=mapnik&marker=${b.lat}%2C${b.lng}`
    : null;
  const link = hasPoint ? `https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lng}#map=16/${b.lat}/${b.lng}` : q ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}` : null;
  return (
    <section className={cn(WRAP, "py-16 sm:py-24")}>
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SectionHead heading={b.heading} />
          <ul className="space-y-4 text-text-secondary">
            {(b.venueName || b.address) && (
              <li className="flex gap-3">
                <MapPin className="mt-1 h-5 w-5 shrink-0 text-brand-primary" aria-hidden />
                <span>
                  {b.venueName && <strong className="block text-text">{b.venueName}</strong>}
                  {b.address && <span className="whitespace-pre-line">{b.address}</span>}
                </span>
              </li>
            )}
            {b.hours && (
              <li className="flex gap-3">
                <Clock className="mt-1 h-5 w-5 shrink-0 text-brand-primary" aria-hidden />
                <span>{b.hours}</span>
              </li>
            )}
            {b.phone && (
              <li className="flex gap-3">
                <Phone className="mt-1 h-5 w-5 shrink-0 text-brand-primary" aria-hidden />
                <a href={`tel:${b.phone.replace(/[^+\d]/g, "")}`} className="site-link" dir="ltr">
                  {b.phone}
                </a>
              </li>
            )}
            {b.email && (
              <li className="flex gap-3">
                <Mail className="mt-1 h-5 w-5 shrink-0 text-brand-primary" aria-hidden />
                <a href={`mailto:${b.email}`} className="site-link">
                  {b.email}
                </a>
              </li>
            )}
          </ul>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="site-btn site-btn-primary mt-8">
              {ctx.t("site.render.openMap")}
            </a>
          )}
        </div>
        {osm && (
          <div className="site-card relative min-h-[20rem] overflow-hidden lg:col-span-3">
            <iframe src={osm} title={b.venueName ?? ctx.t("site.render.map")} loading="lazy" className="absolute inset-0 h-full w-full border-0" referrerPolicy="no-referrer" />
          </div>
        )}
      </div>
    </section>
  );
}

function Video({ b, ctx }: { b: BlockOf<"video">; ctx: RenderCtx }) {
  const v = videoEmbed(b.url);
  if (!v) return null;
  const poster = resolveImg(ctx, b.poster);
  return (
    <section className={cn(WRAP, "max-w-5xl py-14 sm:py-20")}>
      {b.title && <h2 className="site-h mb-6 text-3xl text-text sm:text-4xl">{b.title}</h2>}
      <div className="site-card relative aspect-video overflow-hidden">
        {v.kind === "file" ? (
          <video className="absolute inset-0 h-full w-full" src={v.url} controls preload="metadata" poster={poster?.url} />
        ) : (
          <VideoFacade embedUrl={v.embedUrl} thumbUrl={poster?.url ?? v.thumbUrl} title={b.title ?? ctx.t("site.render.video")} playLabel={ctx.t("site.render.play")} notice={ctx.t("site.render.videoNotice", { provider: v.kind === "youtube" ? "YouTube" : "Vimeo" })} />
        )}
      </div>
      {b.caption && <p className="mt-3 text-sm text-text-muted">{b.caption}</p>}
    </section>
  );
}

function Gallery({ b, ctx }: { b: BlockOf<"gallery">; ctx: RenderCtx }) {
  const imgs = b.images.map((r) => resolveImg(ctx, r)).filter((x): x is NonNullable<ReturnType<typeof resolveImg>> => !!x);
  if (!imgs.length) return null;
  return (
    <section className={cn(WRAP, "py-14 sm:py-20")}>
      <SectionHead heading={b.heading} />
      <GalleryLightbox
        columns={b.columns}
        images={imgs.map((i) => ({ url: i.url, alt: i.ref.alt ?? i.alt ?? "", width: i.width ?? 1600, height: i.height ?? 1067, pos: objectPosition(i.ref.focalX, i.ref.focalY) }))}
        labels={{ open: ctx.t("site.render.openImage"), close: ctx.t("site.render.close"), prev: ctx.t("site.render.previous"), next: ctx.t("site.render.next"), counter: ctx.t("site.render.counter", { current: "{current}", total: "{total}" }) }}
      />
    </section>
  );
}

function ImageBlock({ b, ctx }: { b: BlockOf<"image">; ctx: RenderCtx }) {
  const img = resolveImg(ctx, b.image);
  if (!img) return null;
  return (
    <figure className={cn("site-reveal py-10", b.width === "full" ? "" : b.width === "wide" ? WRAP : cn(WRAP, "max-w-3xl"))}>
      <div className={cn("relative overflow-hidden", b.width !== "full" && "rounded-[var(--site-radius)]")}>
        <SiteImage img={img} sizes={b.width === "full" ? "100vw" : "(min-width: 1024px) 80vw, 100vw"} unclearedLabel={ctx.t("site.render.notCleared")} />
      </div>
      {b.caption && <figcaption className={cn("mt-3 text-sm text-text-muted", b.width === "full" && WRAP)}>{b.caption}</figcaption>}
    </figure>
  );
}

/** Render a list of blocks. The first hero renders an <h1>; otherwise the page title does. */
export function Blocks({ blocks, ctx }: { blocks: Block[]; ctx: RenderCtx }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={b.id} b={b} ctx={ctx} first={i === 0} />
      ))}
    </>
  );
}

export function BlockView({ b, ctx, first }: { b: Block; ctx: RenderCtx; first: boolean }) {
  switch (b.type) {
    case "hero":
      return <Hero b={b} ctx={ctx} first={first} />;
    case "richText":
      return (
        <section className={cn(WRAP, "site-reveal py-12 sm:py-16", b.width === "narrow" ? "max-w-3xl" : "max-w-5xl")}>
          <Rich html={b.html} />
        </section>
      );
    case "image":
      return <ImageBlock b={b} ctx={ctx} />;
    case "gallery":
      return <Gallery b={b} ctx={ctx} />;
    case "video":
      return <Video b={b} ctx={ctx} />;
    case "twoColumn":
      return <TwoColumn b={b} ctx={ctx} />;
    case "stats":
      return <Stats b={b} ctx={ctx} />;
    case "cards":
      return <Cards b={b} ctx={ctx} />;
    case "testimonials":
      return <Testimonials b={b} />;
    case "logos":
      return <Logos b={b} ctx={ctx} />;
    case "faq":
      return <Faq b={b} />;
    case "cta":
      return <CtaBanner b={b} ctx={ctx} />;
    case "form":
      return <FormBlock b={b} ctx={ctx} />;
    case "map":
      return <MapBlock b={b} ctx={ctx} />;
    case "spacer":
      return <div aria-hidden className={cn(WRAP, b.size === "sm" ? "py-4" : b.size === "lg" ? "py-16" : "py-8")}>{b.divider && <hr className="border-border" />}</div>;
    case "live":
      return <LiveBlockView b={b} ctx={ctx} />;
  }
}

export { WRAP };
