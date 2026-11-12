/**
 * Where an event happens, for display: a club venue (and court/field), or an
 * away game / other location (optional name + free-text address).
 * Pure: shared by server pages, client components and unit tests.
 */
export type EventPlaceInput = {
  venueName: string | null;
  spaceName?: string | null;
  venueAddress?: string | null;
  locationName?: string | null;
  locationText?: string | null;
};

export type EventPlace = {
  /** Main line ("Belvedere · Court A", "Away: Gym X"); null when unknown (TBC). */
  label: string | null;
  /** Street address, when one is known. */
  address: string | null;
  /** Whether this is a club venue (vs. away/other location). */
  isVenue: boolean;
};

export function eventPlace(e: EventPlaceInput): EventPlace {
  if (e.venueName) {
    return { label: e.spaceName ? `${e.venueName} · ${e.spaceName}` : e.venueName, address: e.venueAddress?.trim() || null, isVenue: true };
  }
  const name = e.locationName?.trim() || null;
  const address = e.locationText?.trim() || null;
  return { label: name ?? address, address, isVenue: false };
}

/** One-line text for compact lists: "Name, address" without repeating. */
export function eventPlaceLine(p: EventPlace): string | null {
  if (!p.label) return null;
  if (p.address && p.address !== p.label) return `${p.label}, ${p.address}`;
  return p.label;
}

/** A maps search link for an address/place (opens the user's maps app on phones). */
export function mapsUrl(query: string | null | undefined): string | null {
  const q = query?.trim();
  if (!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
