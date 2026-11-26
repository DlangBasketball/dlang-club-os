import { CalendarDays, ExternalLink, MapPin, Trophy, Users } from "lucide-react";
import { buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Translator } from "@/lib/i18n/translator";
import type {
  buildCampaigns, buildCamps, buildNews, buildPrograms, buildShop, buildTeams, buildTraining, loadPublicEvents,
} from "@/lib/website/public-data";

/**
 * Public website widgets: the SAME data as the public API (built by
 * src/lib/website/public-data.ts), rendered for embeds (/embed/*) and the
 * app's own public pages (/club/schedule, /club). Server components.
 * `target` opens actions in a new top-level tab from an embed (checkout and
 * login need first-party cookies); `withReturn` appends ?return_to=.
 */

type Camps = Awaited<ReturnType<typeof buildCamps>>;
type Programs = Awaited<ReturnType<typeof buildPrograms>>;
type Events = Awaited<ReturnType<typeof loadPublicEvents>>;
type Teams = Awaited<ReturnType<typeof buildTeams>>;
type Training = Awaited<ReturnType<typeof buildTraining>>;
type Shop = Awaited<ReturnType<typeof buildShop>>;
type Campaigns = Awaited<ReturnType<typeof buildCampaigns>>;
type News = Awaited<ReturnType<typeof buildNews>>;

export type LinkOpts = { newTab: boolean; returnTo: string | null };

export function actionHref(url: string, o: LinkOpts): string {
  if (!o.returnTo) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("return_to", o.returnTo);
    return u.toString();
  } catch {
    return url;
  }
}

function A({ href, o, className, children }: { href: string; o: LinkOpts; className?: string; children: React.ReactNode }) {
  return (
    <a href={actionHref(href, o)} className={className} {...(o.newTab ? { target: "_blank", rel: "noopener" } : {})}>
      {children}
    </a>
  );
}

const card = "rounded-md border border-border bg-surface p-4 shadow-sm";

function Empty({ t }: { t: Translator }) {
  return <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-text-muted">{t("website.widgets.empty")}</p>;
}

function StatusBadge({ status, t }: { status: string; t: Translator }) {
  const tone = status === "open" ? "bg-success-soft text-success" : status === "full" ? "bg-warning-soft text-warning" : "bg-surface-elevated text-text-muted";
  return <span className={cn("rounded px-2 py-0.5 text-xs font-medium", tone)}>{t.dynamic(`website.status.${status}`, {}, status)}</span>;
}

export function CampsWidget({ data, t, o }: { data: Camps; t: Translator; o: LinkOpts }) {
  if (!data.length) return <Empty t={t} />;
  return (
    <div className="space-y-6">
      {data.map((g) => (
        <section key={`${g.season}-${g.year}`} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl font-semibold">{g.title}</h2>
            <A href={g.url} o={o} className="text-sm text-brand-primary hover:underline">{t("website.widgets.seasonPage")}</A>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {g.editions.map((e) => (
              <li key={e.id} className={cn(card, "flex flex-col gap-2")}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{e.name}</h3>
                  <StatusBadge status={e.status} t={t} />
                </div>
                <p className="flex items-center gap-1.5 text-sm text-text-muted"><CalendarDays className="h-4 w-4" aria-hidden />{e.dates.formatted}</p>
                {(e.venue.name || e.venue.city) && <p className="flex items-center gap-1.5 text-sm text-text-muted"><MapPin className="h-4 w-4" aria-hidden />{[e.venue.name, e.venue.city].filter(Boolean).join(", ")}</p>}
                {e.ages && <p className="text-sm text-text-muted">{e.ages.label}</p>}
                {e.price_options.length > 0 && (
                  <ul className="space-y-0.5 text-sm">
                    {e.price_options.map((p) => (
                      <li key={p.id} className="flex justify-between gap-2">
                        <span>{p.label}</span>
                        <span className="font-medium">{p.price?.formatted}{p.member_price ? ` · ${t("website.widgets.members", { price: p.member_price.formatted })}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {e.places_left !== null && e.status === "open" && <p className="text-xs text-text-muted">{t("website.widgets.placesLeft", { count: e.places_left })}</p>}
                {e.action_url && e.status === "open" && (
                  <A href={e.action_url} o={o} className={cn(buttonVariants({ variant: "primary", size: "sm" }), "mt-auto self-start")}>{t("website.widgets.register")}</A>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ProgramsWidget({ data, t, o }: { data: Programs; t: Translator; o: LinkOpts }) {
  if (!data.length) return <Empty t={t} />;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {data.map((p) => (
        <li key={p.id} className={cn(card, "flex flex-col gap-2")}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold">{p.name}</h3>
            <StatusBadge status={p.status} t={t} />
          </div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{t.dynamic(`website.kinds.${p.kind}`, {}, p.kind)}{p.age_range ? ` · ${p.age_range.label}` : ""}</p>
          {p.dates_formatted && <p className="flex items-center gap-1.5 text-sm text-text-muted"><CalendarDays className="h-4 w-4" aria-hidden />{p.dates_formatted}</p>}
          {p.location && <p className="flex items-center gap-1.5 text-sm text-text-muted"><MapPin className="h-4 w-4" aria-hidden />{p.location}</p>}
          {p.price_from && <p className="text-sm font-medium">{t("website.widgets.priceFrom", { price: p.price_from.formatted })}</p>}
          {p.status === "open" && <A href={p.action_url} o={o} className={cn(buttonVariants({ variant: "primary", size: "sm" }), "mt-auto self-start")}>{t("website.widgets.register")}</A>}
        </li>
      ))}
    </ul>
  );
}

export function EventsWidget({ data, t, o, results = false }: { data: Events; t: Translator; o: LinkOpts; results?: boolean }) {
  if (!data.length) return <Empty t={t} />;
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-surface">
      {data.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-text-muted">
              {e.starts_at_formatted}{e.team ? ` · ${e.team.name}` : ""}
            </p>
            <p className="font-medium">{e.title}</p>
            {e.venue?.name && (
              <p className="flex items-center gap-1 text-sm text-text-muted">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {e.venue.maps_url ? <A href={e.venue.maps_url} o={{ newTab: true, returnTo: null }} className="hover:underline">{e.venue.name}</A> : e.venue.name}
              </p>
            )}
          </div>
          <div className="text-right text-sm">
            {e.result ? (
              <span className="inline-flex items-center gap-1 font-semibold">
                <Trophy className="h-4 w-4 text-brand-accent" aria-hidden />
                {e.result.our_score}:{e.result.their_score}
                <span className="ml-1 text-xs font-normal text-text-muted">{t.dynamic(`website.outcome.${e.result.outcome}`, {}, e.result.outcome)}</span>
              </span>
            ) : e.status !== "scheduled" ? (
              <span className="rounded bg-warning-soft px-2 py-0.5 text-xs text-warning">{t.dynamic(`website.eventStatus.${e.status}`, {}, e.status)}</span>
            ) : results ? null : (
              <span className="text-text-muted">{e.time_formatted}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TeamsWidget({ data, t }: { data: Teams; t: Translator }) {
  if (!data.length) return <Empty t={t} />;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {data.map((raw) => {
        const team = raw as {
          slug: string; name: string; age_group: string | null; league: string | null;
          coaches: { name: string; role_label: string }[]; training_times: { weekday_label: string; start: string; end: string; venue: string | null }[];
          roster?: { name: string; number: number | null }[];
        };
        return (
          <li key={team.slug} className={cn(card, "space-y-2")}>
            <h3 className="font-display text-lg font-semibold">{team.name}</h3>
            {(team.age_group || team.league) && <p className="text-sm text-text-muted">{[team.age_group, team.league].filter(Boolean).join(" · ")}</p>}
            {team.coaches.length > 0 && (
              <p className="flex items-center gap-1.5 text-sm"><Users className="h-4 w-4 text-text-muted" aria-hidden />{team.coaches.map((c) => `${c.name} (${c.role_label})`).join(", ")}</p>
            )}
            {team.training_times.length > 0 && (
              <ul className="text-sm text-text-muted">
                {team.training_times.map((s, i) => <li key={i}>{s.weekday_label} {s.start}–{s.end}{s.venue ? ` · ${s.venue}` : ""}</li>)}
              </ul>
            )}
            {team.roster && team.roster.length > 0 && (
              <p className="text-sm text-text-muted">{team.roster.map((r) => (r.number !== null ? `#${r.number} ${r.name}` : r.name)).join(", ")}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function TrainingWidget({ data, t, o }: { data: Training; t: Translator; o: LinkOpts }) {
  if (!data.length) return <Empty t={t} />;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {data.map((s) => (
        <li key={s.id} className={cn(card, "flex flex-col gap-2")}>
          <h3 className="font-semibold">{s.name}</h3>
          {s.description && <p className="line-clamp-3 text-sm text-text-muted">{s.description}</p>}
          <p className="text-sm text-text-muted">{t("website.widgets.duration", { minutes: s.duration })}</p>
          {s.price && <p className="text-sm font-medium">{t("website.widgets.perSession", { price: s.price.formatted })}</p>}
          {s.packages.length > 0 && <ul className="text-sm text-text-muted">{s.packages.map((p) => <li key={p.id}>{t("website.widgets.package", { sessions: p.sessions, price: p.price?.formatted ?? "" })}</li>)}</ul>}
          <A href={s.action_url} o={o} className={cn(buttonVariants({ variant: "primary", size: "sm" }), "mt-auto self-start")}>{t("website.widgets.book")}</A>
        </li>
      ))}
    </ul>
  );
}

export function ShopWidget({ data, t, o }: { data: Shop; t: Translator; o: LinkOpts }) {
  if (!data.length) return <Empty t={t} />;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {data.map((p) => (
        <li key={p.id} className={cn(card, "flex flex-col gap-2 p-3")}>
          {p.images[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.images[0]} alt="" className="aspect-square w-full rounded object-cover" loading="lazy" />
          )}
          <h3 className="text-sm font-semibold">{p.name}</h3>
          <p className="text-sm">{p.price?.formatted}</p>
          {!p.in_stock && <p className="text-xs text-text-muted">{t("website.widgets.soldOut")}</p>}
          <A href={p.action_url} o={o} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-auto")}>{t("website.widgets.buy")}</A>
        </li>
      ))}
    </ul>
  );
}

export function DonateWidget({ data, t, o }: { data: Campaigns; t: Translator; o: LinkOpts }) {
  if (!data.length) return <Empty t={t} />;
  return (
    <ul className="space-y-3">
      {data.map((c) => (
        <li key={c.slug} className={cn(card, "space-y-2")}>
          <h3 className="font-semibold">{c.title}</h3>
          {c.description && <p className="line-clamp-3 text-sm text-text-muted">{c.description}</p>}
          <div className="h-2 overflow-hidden rounded-full bg-surface-elevated" role="progressbar" aria-valuenow={c.progress_pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-brand-primary" style={{ width: `${c.progress_pct}%` }} />
          </div>
          <p className="text-sm text-text-muted">{t("website.widgets.raised", { raised: c.raised?.formatted ?? "", goal: c.goal?.formatted ?? "" })}</p>
          <A href={c.url} o={o} className={buttonVariants({ variant: "primary", size: "sm" })}>{t("website.widgets.donate")}</A>
        </li>
      ))}
    </ul>
  );
}

export function NewsList({ data, t, o }: { data: News; t: Translator; o: LinkOpts }) {
  if (!data.length) return <Empty t={t} />;
  return (
    <ul className="space-y-3">
      {data.map((n) => (
        <li key={n.id} className={card}>
          <p className="text-xs uppercase tracking-wide text-text-muted">{n.published_at_formatted}</p>
          <A href={n.url} o={o} className="font-semibold hover:underline">{n.title}</A>
          {n.excerpt && <p className="mt-1 line-clamp-3 text-sm text-text-muted">{n.excerpt}</p>}
        </li>
      ))}
    </ul>
  );
}

export function ActionCard({ title, body, href, cta, o }: { title: string; body: string; href: string; cta: string; o: LinkOpts }) {
  return (
    <div className={cn(card, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-text-muted">{body}</p>
      </div>
      <A href={href} o={o} className={cn(buttonVariants({ variant: "primary", size: "md" }), "shrink-0")}>
        {cta}
        <ExternalLink className="h-4 w-4" aria-hidden />
      </A>
    </div>
  );
}
