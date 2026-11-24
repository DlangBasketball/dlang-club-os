import { Avatar } from "@/components/ui";
import { CoverImage } from "@/components/media/cover-image";
import { createClient } from "@/lib/supabase/server";
import { getI18n } from "@/lib/i18n/server";
import { photoUrlsForAthletes } from "@/lib/people/server";
import { getAthleteCover } from "@/lib/media/server";
import { getPlayerTeams } from "@/lib/data/player-profile";

/**
 * Coach view of a player: the cover banner with photo, number and team chips
 * (read-only). Everything is read through RLS, so a coach only gets this for
 * athletes they may access (coach_can_access_athlete); otherwise nothing renders.
 */
export async function CoachPlayerBanner({ athleteId }: { athleteId: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(athleteId)) return null;
  const supabase = await createClient();
  const { data: a } = await supabase.from("athletes").select("id,first_name,last_name,position_pref").eq("id", athleteId).maybeSingle();
  if (!a) return null;
  const [{ t }, photos, cover, teams] = await Promise.all([
    getI18n(),
    photoUrlsForAthletes([a.id]),
    getAthleteCover(a.id),
    getPlayerTeams(a.id),
  ]);
  const name = `${a.first_name} ${a.last_name}`;
  const primary = teams.find((x) => x.jerseyNumber !== null) ?? teams[0] ?? null;
  const rawPosition = primary?.position || a.position_pref || null;
  const position = rawPosition ? t.dynamic(`participants.positions.${rawPosition}`, undefined, rawPosition) : null;
  return (
    <CoverImage cover={cover} variant="compact" className="max-w-5xl">
      <div className="flex items-center gap-3">
        <Avatar name={name} src={photos[a.id] ?? null} alt={t("athletePhoto.alt", { name })} size="xl" className="border-2 border-cover-chip-border" />
        <div className="min-w-0 text-cover-text">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {primary?.jerseyNumber !== null && primary?.jerseyNumber !== undefined && <span className="tnum font-semibold">#{primary.jerseyNumber}</span>}
            {position && <span className="text-cover-text-muted">{position}</span>}
          </div>
          {teams.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={t("media.roster.teamsTitle")}>
              {teams.map((tm) => (
                <li key={tm.membershipId} className="rounded-full border border-cover-chip-border bg-cover-chip px-2 py-0.5 text-xs text-cover-text">{tm.teamName}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </CoverImage>
  );
}
