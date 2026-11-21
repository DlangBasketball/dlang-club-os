import { CalendarDays, MapPin, Users, Clock, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BlockOf } from "@/lib/site/blocks";
import { loadLiveBlock, type LiveData } from "@/lib/site/live";
import { jsonLdString, sportsEventLd } from "@/lib/site/seo";
import { RemoteImage } from "./site-image";
import type { RenderCtx } from "./types";

/**
 * Live blocks: app data through the public data layer, refreshed
 * automatically when the club changes it (cache tag site-live:<org>).
 * Links lead into the app's own flows (camp basket, booking, shop, donate).
 */

const WRAP = "mx-auto w-full max-w-[var(--site-max)] px-4 sm:px-6 lg:px-8";

function Head({ b, fallback }: { b: BlockOf<"live">; fallback: string }) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {b.eyebrow && <p className="site-eyebrow">{b.eyebrow}</p>}
        <h2 className="site-h mt-2 text-3xl text-text sm:text-4xl lg:text-5xl">{b.heading || fallback}</h2>
        {b.intro && <p className="mt-4 text-lg text-text-secondary">{b.intro}</p>}
      </div>
    </header>
  );
}

function Status({ status, ctx }: { status: string; ctx: RenderCtx }) {
  const tone = status === "open" ? "bg-success-soft text-success" : status === "full" ? "bg-warning-soft text-warning" : "bg-surface-elevated text-text-muted";
  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide", tone)}>{ctx.t.dynamic(`website.status.${status}`, {}, status)}</span>;
}

function Empty({ ctx }: { ctx: RenderCtx }) {
  return <p className="site-card p-8 text-center text-text-secondary">{ctx.t("site.live.empty")}</p>;
}

function LdScript({ data }: { data: unknown[] }) {
  if (!data.length) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data.length === 1 ? data[0] : data) }} />;
}

export async function LiveBlockView({ b, ctx }: { b: BlockOf<"live">; ctx: RenderCtx }) {
  const data = await loadLiveBlock(b, { orgId: ctx.site.orgId, tenant: ctx.site.tenant, origin: ctx.site.origin, defaultLanguage: ctx.defaultLang }, ctx.lang);
  const fallback = ctx.t.dynamic(`site.live.titles.${b.source}`);
  if (!data) return ctx.preview ? <section className={cn(WRAP, "py-10")}><p className="site-card p-6 text-sm text-text-muted">{ctx.t("site.live.sectionOff")}</p></section> : null;
  return (
    <section className={cn(WRAP, "py-16 sm:py-24")}>
      <Head b={b} fallback={fallback} />
      <LiveBody data={data} ctx={ctx} />
    </section>
  );
}

function LiveBody({ data, ctx }: { data: LiveData; ctx: RenderCtx }) {
  const t = ctx.t;
  const org = ctx.site.tenant.name;
  switch (data.source) {
    case "camps": {
      const editions = data.items.flatMap((g) => g.editions.map((e) => ({ ...e, group: g.title })));
      if (!editions.length) return <Empty ctx={ctx} />;
      const ld = editions.slice(0, 20).map((e) => {
        const prices = e.price_options.map((o) => o.price?.amount).filter((x): x is number => typeof x === "number");
        return sportsEventLd({
          name: e.name, startDate: e.dates.starts_on, endDate: e.dates.ends_on, url: e.action_url, location: [e.venue.name, e.venue.city].filter(Boolean).join(", ") || null,
          image: e.cover_url, organizer: org,
          offer: prices.length ? { price: Math.min(...prices), currency: e.price_options[0]?.price?.currency ?? ctx.site.tenant.currency, url: e.action_url, available: e.status === "open" } : null,
        });
      });
      return (
        <>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {editions.map((e) => {
              const from = e.price_options.map((o) => o.price).filter((p): p is NonNullable<typeof p> => !!p).sort((a, b) => a.amount - b.amount)[0];
              return (
                <li key={e.id} className="site-reveal site-card group flex flex-col overflow-hidden">
                  <div className="relative aspect-[16/10] overflow-hidden bg-cover-fallback">
                    {e.cover_url ? <RemoteImage src={e.cover_url} alt="" sizes="(min-width: 1024px) 33vw, 100vw" className="transition duration-700 group-hover:scale-105" /> : <div aria-hidden className="absolute inset-0 bg-cover-pattern" />}
                    <div className="absolute start-3 top-3"><Status status={e.status} ctx={ctx} /></div>
                  </div>
                  <div className="flex flex-1 flex-col p-6">
                    <p className="site-eyebrow">{e.dates.formatted}</p>
                    <h3 className="site-h mt-2 text-2xl text-text">{e.name}</h3>
                    <ul className="mt-4 space-y-2 text-sm text-text-secondary">
                      {(e.venue.name || e.venue.city) && <li className="flex gap-2"><MapPin className="h-4 w-4 shrink-0" aria-hidden />{[e.venue.name, e.venue.city].filter(Boolean).join(", ")}</li>}
                      {e.ages && <li className="flex gap-2"><Users className="h-4 w-4 shrink-0" aria-hidden />{e.ages.label}</li>}
                    </ul>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-6">
                      {from ? <p className="text-text"><span className="text-sm text-text-muted">{t("site.live.from")} </span><strong className="text-lg">{from.formatted}</strong></p> : <span />}
                      {e.action_url && e.status === "open" && <a href={e.action_url} className="site-btn site-btn-primary">{t("site.live.register")}</a>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <LdScript data={ld} />
        </>
      );
    }
    case "programs": {
      if (!data.items.length) return <Empty ctx={ctx} />;
      return (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((p) => (
            <li key={p.id} className="site-reveal site-card group flex flex-col overflow-hidden">
              <div className="relative aspect-[16/10] overflow-hidden bg-cover-fallback">
                {p.cover_url ? <RemoteImage src={p.cover_url} alt="" sizes="(min-width: 1024px) 33vw, 100vw" className="transition duration-700 group-hover:scale-105" /> : <div aria-hidden className="absolute inset-0 bg-cover-pattern" />}
                <div className="absolute start-3 top-3"><Status status={p.status} ctx={ctx} /></div>
              </div>
              <div className="flex flex-1 flex-col p-6">
                {p.dates_formatted && <p className="site-eyebrow">{p.dates_formatted}</p>}
                <h3 className="site-h mt-2 text-2xl text-text">{p.name}</h3>
                <ul className="mt-3 space-y-1 text-sm text-text-secondary">
                  {p.age_range && <li>{p.age_range.label}</li>}
                  {p.location && <li>{p.location}</li>}
                </ul>
                <div className="mt-auto flex items-center justify-between gap-3 pt-6">
                  {p.price_from ? <strong className="text-lg text-text">{p.price_from.formatted}</strong> : <span />}
                  {p.status === "open" && <a href={p.action_url} className="site-btn site-btn-primary">{t("site.live.register")}</a>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      );
    }
    case "schedule":
    case "results": {
      if (!data.items.length) return <Empty ctx={ctx} />;
      const ld = data.items.filter((e) => e.type === "game" || e.type === "tournament").slice(0, 20).map((e) =>
        sportsEventLd({ name: e.title, startDate: e.starts_at, endDate: e.ends_at, url: e.url, location: e.venue?.name ?? null, organizer: org, cancelled: e.status === "cancelled" }),
      );
      return (
        <>
          <ol className="divide-y divide-border overflow-hidden rounded-[var(--site-radius)] border border-border bg-surface">
            {data.items.map((e) => (
              <li key={e.id} className="site-reveal grid gap-2 p-5 sm:grid-cols-[12rem_1fr_auto] sm:items-center sm:gap-6">
                <div className="text-sm text-text-muted">
                  <p className="font-semibold text-text">{e.starts_at_formatted}</p>
                  <p>{e.time_formatted}</p>
                </div>
                <div>
                  <p className={cn("text-lg font-semibold text-text", e.status === "cancelled" && "line-through opacity-70")}>{e.title}</p>
                  {e.venue?.name && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-text-secondary">
                      <MapPin className="h-4 w-4" aria-hidden />
                      {e.venue.maps_url ? <a className="site-link" href={e.venue.maps_url} target="_blank" rel="noopener noreferrer">{e.venue.name}</a> : e.venue.name}
                    </p>
                  )}
                </div>
                <div className="sm:text-end">
                  {e.result ? (
                    <p className="site-h text-2xl text-text" dir="ltr">
                      {e.result.our_score}<span className="mx-1 text-text-muted">:</span>{e.result.their_score}
                      <span className={cn("ms-3 rounded-full px-2 py-0.5 align-middle font-sans text-xs uppercase", e.result.outcome === "win" ? "bg-success-soft text-success" : e.result.outcome === "loss" ? "bg-danger-soft text-danger" : "bg-surface-elevated text-text-muted")}>
                        {t.dynamic(`website.outcome.${e.result.outcome}`, {}, e.result.outcome)}
                      </span>
                    </p>
                  ) : e.status !== "scheduled" ? (
                    <span className="text-sm font-semibold text-warning">{t.dynamic(`website.eventStatus.${e.status}`, {}, e.status)}</span>
                  ) : (
                    <span className="text-xs uppercase tracking-wide text-text-muted">{t.dynamic(`website.events.types.${e.type}`, {}, e.type)}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <LdScript data={ld} />
        </>
      );
    }
    case "teams":
    case "team": {
      const items = data.items as { slug: string; name: string; age_group: string | null; league: string | null; cover_url: string | null; url: string; coaches: { name: string; role_label: string; photo_url: string | null }[]; training_times: { weekday_label: string; start: string; end: string; venue: string | null }[]; roster?: { name: string; number: number | null }[] }[];
      if (!items.length) return <Empty ctx={ctx} />;
      if (data.source === "team") {
        const tm = items[0]!;
        return (
          <div className="grid gap-8 lg:grid-cols-2">
            <div className="site-card relative aspect-[16/10] overflow-hidden bg-cover-fallback">
              {tm.cover_url ? <RemoteImage src={tm.cover_url} alt="" sizes="(min-width: 1024px) 50vw, 100vw" /> : <div aria-hidden className="absolute inset-0 bg-cover-pattern" />}
            </div>
            <div>
              <h3 className="site-h text-4xl text-text">{tm.name}</h3>
              <p className="mt-2 text-text-secondary">{[tm.age_group, tm.league].filter(Boolean).join(" · ")}</p>
              {!!tm.training_times.length && (
                <>
                  <h4 className="mt-8 font-semibold text-text">{t("site.live.trainingTimes")}</h4>
                  <ul className="mt-2 space-y-1 text-text-secondary">
                    {tm.training_times.map((s, i) => <li key={i} className="flex gap-2"><Clock className="mt-0.5 h-4 w-4" aria-hidden />{s.weekday_label} {s.start}–{s.end}{s.venue ? ` · ${s.venue}` : ""}</li>)}
                  </ul>
                </>
              )}
              {!!tm.coaches.length && (
                <>
                  <h4 className="mt-8 font-semibold text-text">{t("site.live.coaches")}</h4>
                  <ul className="mt-3 flex flex-wrap gap-4">
                    {tm.coaches.map((c, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <span className="relative h-12 w-12 overflow-hidden rounded-full bg-surface-elevated">{c.photo_url && <RemoteImage src={c.photo_url} alt="" sizes="48px" />}</span>
                        <span><span className="block font-medium text-text">{c.name}</span><span className="text-sm text-text-muted">{c.role_label}</span></span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!!tm.roster?.length && (
                <>
                  <h4 className="mt-8 font-semibold text-text">{t("site.live.roster")}</h4>
                  <ul className="mt-2 grid grid-cols-2 gap-1 text-text-secondary sm:grid-cols-3">
                    {tm.roster.map((r, i) => <li key={i}>{r.number !== null ? <span className="me-2 font-mono text-text-muted">#{r.number}</span> : null}{r.name}</li>)}
                  </ul>
                </>
              )}
              <a href={tm.url} className="site-btn site-btn-primary mt-8">{t("site.live.fullSchedule")}</a>
            </div>
          </div>
        );
      }
      return (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((tm) => (
            <li key={tm.slug} className="site-reveal site-card group overflow-hidden">
              <a href={tm.url} className="block focus-visible:shadow-focus focus-visible:outline-none">
                <div className="relative aspect-[4/3] overflow-hidden bg-cover-fallback">
                  {tm.cover_url ? <RemoteImage src={tm.cover_url} alt="" sizes="(min-width: 1024px) 33vw, 100vw" className="transition duration-700 group-hover:scale-105" /> : <div aria-hidden className="absolute inset-0 bg-cover-pattern" />}
                  <div aria-hidden className="absolute inset-0 site-scrim-gradient" />
                  <div className="absolute inset-x-0 bottom-0 p-5">
                    {tm.age_group && <p className="site-eyebrow site-on-photo">{tm.age_group}</p>}
                    <h3 className="site-h site-on-photo mt-1 text-3xl">{tm.name}</h3>
                  </div>
                </div>
                <div className="space-y-1 p-5 text-sm text-text-secondary">
                  {tm.league && <p>{tm.league}</p>}
                  {tm.training_times.slice(0, 3).map((s, i) => <p key={i} className="flex gap-2"><Clock className="mt-0.5 h-4 w-4" aria-hidden />{s.weekday_label} {s.start}–{s.end}</p>)}
                </div>
              </a>
            </li>
          ))}
        </ul>
      );
    }
    case "coaches": {
      if (!data.items.length) return <Empty ctx={ctx} />;
      return (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {data.items.map((c) => (
            <li key={c.id} className="site-reveal site-card overflow-hidden">
              <div className="relative aspect-[4/5] bg-cover-fallback">{c.photo_url ? <RemoteImage src={c.photo_url} alt={c.name} sizes="(min-width: 1024px) 25vw, 50vw" /> : <div aria-hidden className="absolute inset-0 bg-cover-pattern" />}</div>
              <div className="p-5">
                <h3 className="site-h text-xl text-text">{c.name}</h3>
                {c.role && <p className="text-sm text-brand-accent">{c.role}</p>}
                {c.bio && <p className="mt-3 line-clamp-4 text-sm text-text-secondary">{c.bio}</p>}
                {!!c.licences.length && <p className="mt-3 text-xs text-text-muted">{c.licences.join(" · ")}</p>}
              </div>
            </li>
          ))}
        </ul>
      );
    }
    case "training": {
      if (!data.items.length) return <Empty ctx={ctx} />;
      return (
        <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((s) => (
            <li key={s.id} className="site-reveal site-card flex flex-col p-7">
              <h3 className="site-h text-2xl text-text">{s.name}</h3>
              <p className="mt-1 text-sm text-text-muted">{t("site.live.duration", { minutes: s.duration })}</p>
              {s.description && <p className="mt-4 text-text-secondary">{s.description}</p>}
              {!!s.packages.length && (
                <ul className="mt-5 space-y-2 border-t border-border pt-4 text-sm">
                  {s.packages.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3"><span className="text-text-secondary">{p.name}</span><strong className="text-text">{p.price?.formatted}</strong></li>
                  ))}
                </ul>
              )}
              <div className="mt-auto flex items-center justify-between gap-3 pt-6">
                {s.price ? <strong className="text-xl text-text">{s.price.formatted}</strong> : <span />}
                <a href={s.action_url} className="site-btn site-btn-primary">{t("site.live.book")}</a>
              </div>
            </li>
          ))}
        </ul>
      );
    }
    case "shop": {
      if (!data.items.length) return <Empty ctx={ctx} />;
      return (
        <ul className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
          {data.items.map((p) => (
            <li key={p.id} className="site-reveal site-card group overflow-hidden">
              <a href={p.action_url} className="block focus-visible:shadow-focus focus-visible:outline-none">
                <div className="relative aspect-square overflow-hidden bg-bg-secondary">{p.images[0] ? <RemoteImage src={p.images[0]} alt={p.name} sizes="(min-width: 1024px) 25vw, 50vw" className="transition duration-700 group-hover:scale-105" /> : null}</div>
                <div className="p-4">
                  <h3 className="font-semibold text-text">{p.name}</h3>
                  <p className="mt-1 text-text-secondary">{p.price?.formatted}</p>
                  {!p.in_stock && <p className="mt-1 text-xs font-semibold uppercase text-warning">{t("site.live.soldOut")}</p>}
                </div>
              </a>
            </li>
          ))}
        </ul>
      );
    }
    case "campaigns": {
      if (!data.items.length) return <Empty ctx={ctx} />;
      return (
        <ul className="grid gap-6 md:grid-cols-2">
          {data.items.map((c) => (
            <li key={c.slug} className="site-reveal site-card p-7">
              <h3 className="site-h text-2xl text-text">{c.title}</h3>
              {c.description && <p className="mt-3 text-text-secondary">{c.description}</p>}
              <div className="site-progress mt-6 h-3 overflow-hidden rounded-full" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.progress_pct)} aria-label={t("site.live.raised")}>
                <span className="block h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, c.progress_pct))}%` }} />
              </div>
              <p className="mt-3 text-sm text-text-secondary">{t("site.live.raisedOf", { raised: c.raised?.formatted ?? "", goal: c.goal?.formatted ?? "" })}</p>
              <a href={c.url} className="site-btn site-btn-primary mt-6">{t("site.live.donate")}</a>
            </li>
          ))}
        </ul>
      );
    }
    case "news": {
      if (!data.items.length) return <Empty ctx={ctx} />;
      return (
        <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data.items.map((n) => (
            <li key={n.id} className="site-reveal site-card group overflow-hidden">
              <a href={n.url} className="block h-full focus-visible:shadow-focus focus-visible:outline-none">
                <div className="relative aspect-[16/10] overflow-hidden bg-cover-fallback">{n.imageUrl ? <RemoteImage src={n.imageUrl} alt="" sizes="(min-width: 1024px) 33vw, 100vw" className="transition duration-700 group-hover:scale-105" /> : <div aria-hidden className="absolute inset-0 bg-cover-pattern" />}</div>
                <div className="p-6">
                  <p className="flex items-center gap-2 text-sm text-text-muted"><CalendarDays className="h-4 w-4" aria-hidden /><time dateTime={n.date}>{n.dateFormatted}</time></p>
                  <h3 className="site-h mt-2 text-2xl text-text">{n.title}</h3>
                  {n.excerpt && <p className="mt-3 line-clamp-3 text-text-secondary">{n.excerpt}</p>}
                  <span className="site-link mt-4 inline-block text-sm font-semibold">{t("site.live.readMore")}</span>
                </div>
              </a>
            </li>
          ))}
        </ul>
      );
    }
    case "calendar": {
      const c = data.items[0]!;
      return (
        <div className="site-card flex flex-col items-start gap-4 p-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-text-secondary">{t("site.live.calendarText")}</p>
          <div className="flex flex-wrap gap-3">
            <a href={c.webcalUrl} className="site-btn site-btn-primary"><CalendarDays className="h-4 w-4" aria-hidden />{t("site.live.subscribe")}</a>
            <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(c.webcalUrl)}`} target="_blank" rel="noopener noreferrer" className="site-btn site-btn-secondary">{t("site.live.googleCalendar")}</a>
            <a href={c.icsUrl} className="site-btn site-btn-secondary" download><Download className="h-4 w-4" aria-hidden />{t("site.live.downloadIcs")}</a>
          </div>
        </div>
      );
    }
  }
}
