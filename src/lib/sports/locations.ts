import { z } from "zod";

/** Location (venue) form validation; error messages are i18n keys under sports.locations.errors. */
const E = (k: string) => `sports.locations.errors.${k}`;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const optText = (max: number) => z.string().trim().max(max, E("tooLong")).optional().default("");
const optNum = (min: number, max: number) =>
  z.union([z.literal(""), z.null(), z.coerce.number().min(min, E("number")).max(max, E("number"))]).optional()
    .transform((v) => (v === "" || v === null || v === undefined ? null : v));

export const locationSchema = z.object({
  name: z.string().trim().min(1, E("nameRequired")).max(120, E("tooLong")),
  address: optText(200),
  city: optText(100),
  postalCode: optText(20),
  country: optText(2),
  capacity: optNum(0, 200000),
  notes: optText(2000),
  mapUrl: z.string().trim().max(500, E("tooLong")).refine((v) => v === "" || /^https:\/\/\S+$/.test(v), E("mapUrl")).optional().default(""),
  latitude: optNum(-90, 90),
  longitude: optNum(-180, 180),
  geofenceRadiusM: z.coerce.number().int().min(25, E("number")).max(5000, E("number")).default(300),
  openingHours: z.record(z.enum(["1", "2", "3", "4", "5", "6", "7"]),
    z.array(z.tuple([z.string().regex(HHMM, E("hours")), z.string().regex(HHMM, E("hours"))])
      .refine(([a, b]) => a < b, E("hours"))).max(4)).nullable().default(null),
  isActive: z.boolean().default(true),
}).refine((v) => (v.latitude === null) === (v.longitude === null), { message: E("coordinates"), path: ["latitude"] });
export type LocationInput = z.input<typeof locationSchema>;

export const WEEKDAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

/** "08:00-12:00, 14:00-22:00" -> [["08:00","12:00"],["14:00","22:00"]]; null when malformed. */
export function parseHoursLine(line: string): [string, string][] | null {
  const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
  const out: [string, string][] = [];
  for (const p of parts) {
    const m = /^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/.exec(p);
    if (!m) return null;
    const a = `${m[1].padStart(2, "0")}:${m[2]}`;
    const b = `${m[3].padStart(2, "0")}:${m[4]}`;
    if (!(HHMM.test(a) && HHMM.test(b) && a < b)) return null;
    out.push([a, b]);
  }
  return out;
}

export function formatHoursLine(ranges: [string, string][] | undefined | null): string {
  return (ranges ?? []).map(([a, b]) => `${a}-${b}`).join(", ");
}

/** OpenStreetMap link from coordinates or the address (used when no map link is set). */
export function mapLinkFor(v: { mapUrl?: string | null; latitude?: number | null; longitude?: number | null; address?: string | null; city?: string | null; postalCode?: string | null }): string | null {
  if (v.mapUrl) return v.mapUrl;
  if (v.latitude != null && v.longitude != null) {
    return `https://www.openstreetmap.org/?mlat=${v.latitude}&mlon=${v.longitude}#map=17/${v.latitude}/${v.longitude}`;
  }
  const q = [v.address, v.postalCode, v.city].filter(Boolean).join(", ");
  return q ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}` : null;
}
