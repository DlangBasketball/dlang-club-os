import {
  Activity, Bike, CircleDot, Dumbbell, Footprints, Goal, Medal, Mountain, Sailboat, Snowflake, Swords, Target, Trophy, Volleyball, Waves,
  type LucideIcon,
} from "lucide-react";

/** Icon keys a club can pick for a sport (stored in sports.icon). */
export const SPORT_ICONS: Record<string, LucideIcon> = {
  ball: CircleDot,
  volleyball: Volleyball,
  goal: Goal,
  trophy: Trophy,
  dumbbell: Dumbbell,
  bike: Bike,
  swim: Waves,
  run: Footprints,
  target: Target,
  medal: Medal,
  mountain: Mountain,
  snow: Snowflake,
  sail: Sailboat,
  fencing: Swords,
  activity: Activity,
};

export const SPORT_ICON_KEYS = Object.keys(SPORT_ICONS);

export function sportIcon(key: string | null | undefined): LucideIcon {
  return (key && SPORT_ICONS[key]) || Trophy;
}

/** Terminology a sport can override (keys of organizations.terminology). */
export const SPORT_TERMS = ["athlete", "team", "program", "coach", "session"] as const;
export type SportTerm = (typeof SPORT_TERMS)[number];
