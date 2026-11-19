import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolvePublicClub } from "@/lib/website/server";
import { contextFor } from "@/lib/website/public-api";
import {
  buildCampaigns, buildCamps, buildPrograms, buildShop, buildTeams, buildTraining, loadPublicEvents,
} from "@/lib/website/public-data";
import { embedParentOrigin, safeReturnTo } from "@/lib/website/origins";
import { embedThemeVars, parseThemeParam } from "@/lib/website/theme";
import { isEmbedWidget } from "@/lib/website/embed-code";
import { EmbedResize } from "@/components/website/embed-resize";
import {
  ActionCard, CampsWidget, DonateWidget, EventsWidget, ProgramsWidget, ShopWidget, TeamsWidget, TrainingWidget, type LinkOpts,
} from "@/components/website/widgets";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ widget: string[] }>; searchParams: Promise<SP> };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const token = (v: string | undefined) => (v && /^[A-Za-z0-9_.-]{1,80}$/.test(v) ? v : undefined);

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Chrome-less widget for the club's website (iframe). Same data as the
 * public API. Frameable only by the club's allowed origins (CSP set in
 * middleware); actions open the app in a new top-level tab.
 */
export default async function EmbedPage({ params, searchParams }: Props) {
  const [{ widget: parts }, sp] = await Promise.all([params, searchParams]);
  const widget = parts[0];
  if (!isEmbedWidget(widget) || parts.length > 2 || (parts.length === 2 && widget !== "register")) notFound();
  const club = await resolvePublicClub(one(sp.club));
  if (!club) notFound();
  const ctx = contextFor(club, one(sp.lang), (await headers()).get("host"));
  const { t } = ctx;
  const allowed = club.settings.allowedOrigins;
  const parentOrigin = embedParentOrigin(one(sp.origin), allowed);
  const o: LinkOpts = { newTab: true, returnTo: safeReturnTo(one(sp.return_to), allowed) ?? parentOrigin };
  const theme = parseThemeParam(one(sp.theme), club.settings.embedTheme);
  const vars = embedThemeVars(club.tenant.branding, theme) as React.CSSProperties;
  const sections = club.settings.sections;

  let body: React.ReactNode;
  switch (widget) {
    case "camps": {
      const year = Number(token(one(sp.year)));
      body = sections.camps ? <CampsWidget data={await buildCamps(ctx, { season: token(one(sp.season)) ?? null, year: Number.isInteger(year) ? year : null })} t={t} o={o} /> : null;
      break;
    }
    case "programs": {
      const kind = token(one(sp.kind));
      body = sections.programs ? <ProgramsWidget data={await buildPrograms(ctx, { kind: kind ? [kind] : undefined })} t={t} o={o} /> : null;
      break;
    }
    case "schedule": {
      const type = token(one(sp.type));
      body = sections.events ? <EventsWidget data={await loadPublicEvents(ctx, { team: token(one(sp.team)) ?? null, type: type ? [type] : undefined })} t={t} o={o} /> : null;
      break;
    }
    case "results":
      body = sections.results ? <EventsWidget results data={await loadPublicEvents(ctx, { team: token(one(sp.team)) ?? null, pastOnly: true })} t={t} o={o} /> : null;
      break;
    case "teams":
      body = sections.teams ? <TeamsWidget data={await buildTeams(ctx)} t={t} /> : null;
      break;
    case "book":
      body = sections.training ? <TrainingWidget data={await buildTraining(ctx)} t={t} o={o} /> : null;
      break;
    case "shop":
      body = sections.shop ? <ShopWidget data={await buildShop(ctx, { category: token(one(sp.category)) ?? null })} t={t} o={o} /> : null;
      break;
    case "donate": {
      const slug = token(one(sp.campaign));
      body = sections.campaigns ? <DonateWidget data={(await buildCampaigns(ctx)).filter((c) => !slug || c.slug === slug)} t={t} o={o} /> : null;
      break;
    }
    case "register": {
      const slug = parts[1] ?? token(one(sp.program));
      if (!slug || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) notFound();
      const program = (await buildPrograms(ctx, {})).find((p) => p.slug === slug);
      if (!program) notFound();
      body = (
        <ActionCard title={program.name} body={[program.dates_formatted, program.location, program.price_from ? t("website.widgets.priceFrom", { price: program.price_from.formatted }) : null].filter(Boolean).join(" · ")}
          href={program.action_url} cta={t("website.widgets.register")} o={o} />
      );
      break;
    }
    case "login":
      body = <ActionCard title={t("website.widgets.loginTitle", { club: club.tenant.name })} body={t("website.widgets.loginBody")} href={`${ctx.appUrl}/login`} cta={t("website.widgets.login")} o={o} />;
      break;
  }

  return (
    <div style={{ ...vars, colorScheme: theme === "light" ? "light" : theme === "dark" ? "dark" : undefined }} className="min-h-0 bg-bg p-3 font-sans text-text sm:p-4" data-embed={widget}>
      {body ?? <p className="text-sm text-text-muted">{t("website.widgets.unavailable")}</p>}
      <EmbedResize parentOrigin={parentOrigin} />
    </div>
  );
}
