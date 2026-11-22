"use client";

import { useT } from "@/lib/i18n/client";
import { groupTeamsForPicker, teamOptionLabel, type PickerTeam, type TeamPickerGroup } from "@/lib/teams/programme-teams";

/** Label of a picker group: current season, selection programmes, a season name, no season. */
export function useTeamGroupLabel() {
  const t = useT();
  return (g: TeamPickerGroup) => {
    if (g.kind === "current") return t("media.roster.currentSeason");
    if (g.kind === "selection") return t("teamAdmin.picker.selection");
    if (g.kind === "season") return g.seasonName ?? t("media.roster.otherTeams");
    return t("teamAdmin.picker.noSeason");
  };
}

/**
 * <option>s of a team <select>: every active team of the club, grouped
 * (current season, selection programmes, other seasons, no season). Teams in
 * `excludeIds` and archived teams are left out.
 */
export function TeamOptionGroups({ teams, excludeIds = [] }: { teams: PickerTeam[]; excludeIds?: Iterable<string> }) {
  const label = useTeamGroupLabel();
  return (
    <>
      {groupTeamsForPicker(teams, excludeIds).map((g) => (
        <optgroup key={g.key} label={label(g)}>
          {g.options.map((o) => <option key={o.id} value={o.id}>{teamOptionLabel(o)}</option>)}
        </optgroup>
      ))}
    </>
  );
}
