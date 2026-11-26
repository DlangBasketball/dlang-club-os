"use client";
import * as React from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight, MapPin, Tent } from "lucide-react";
import { Badge, Card, CardBody } from "@/components/ui";
import type { SeasonCampCard } from "@/lib/camps/data";
import { groupBySeason } from "@/lib/camps/seasons";
import { useFormat, useT } from "@/lib/i18n/client";

/**
 * Camps grouped by season (Spring 2027 / Summer 2027 / Fall 2027 …) as
 * cards: cover, weeks with dates / place / availability, price from. Links to
 * the camp page (parent app or public page). No personal data.
 */
export function SeasonCampList({ camps, linkTo }: { camps: SeasonCampCard[]; linkTo: "parent" | "public" }) {
  const t = useT();
  const f = useFormat();
  const groups = groupBySeason(camps, (c) => c.season);
  if (!camps.length) {
    return (
      <div className="rounded-md border border-dashed border-line p-8 text-center text-sm text-ink-3">
        <Tent className="mx-auto mb-2 h-5 w-5" />{t("camps.parent.empty")}
      </div>
    );
  }
  const href = (c: SeasonCampCard) => (linkTo === "parent" ? `/parent/camps/${c.id}` : c.slug ? `/register/${c.slug}` : "#");
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`season-${g.key}`} className="space-y-3">
          <h2 id={`season-${g.key}`} className="font-display text-xl font-semibold text-ink">
            {g.season ? t("camps.seasons.label", { season: t(`camps.seasons.names.${g.season}`), year: g.year ?? "" }) : t("camps.seasons.unscheduled")}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {g.items.map((c) => {
              const open = c.weeks.filter((w) => w.open).length;
              return (
                <Link key={c.id} href={href(c)} className="group block">
                  <Card className="h-full overflow-hidden transition group-hover:border-maroon/40">
                    {/* Camp card cover: programs.cover_path */}
                    {c.coverUrl && (
                      <div aria-hidden className="h-28 w-full bg-surface"
                        style={{ backgroundImage: `url("${c.coverUrl.replace(/"/g, "%22")}")`, backgroundSize: "cover", backgroundPosition: `${c.coverFocalX}% ${c.coverFocalY}%` }} />
                    )}
                    <CardBody className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-ink group-hover:text-maroon">{c.name}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" />
                      </div>
                      {c.description && <p className="line-clamp-2 text-xs text-ink-3">{c.description}</p>}
                      <ul className="space-y-1">
                        {c.weeks.map((w) => (
                          <li key={w.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-2">
                            <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3 text-ink-3" />{f.dateRange(w.startsOn, w.endsOn)}</span>
                            {(w.city || w.venueName) && <span className="flex items-center gap-1 text-ink-3"><MapPin className="h-3 w-3" />{w.city ?? w.venueName}</span>}
                            {!w.open ? <Badge tone="neutral">{w.spotsLeft === 0 ? t("camps.register.full") : t("camps.register.closed")}</Badge>
                              : w.spotsLeft !== null && w.spotsLeft <= 5 ? <Badge tone="warning">{t("camps.register.spotsLeft", { count: w.spotsLeft })}</Badge> : null}
                          </li>
                        ))}
                      </ul>
                      <div className="flex items-center justify-between pt-1 text-xs text-ink-3">
                        <span>{t("camps.seasons.openWeeks", { count: open })}</span>
                        {c.priceFrom !== null && <span className="tnum text-ink">{t("camps.seasons.priceFrom", { price: f.money(c.priceFrom, c.currency) })}</span>}
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
