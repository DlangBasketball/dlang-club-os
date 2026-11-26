/** Report filters from the query string (ids validated; anything else ignored). Pure. */
export type ReportFilters = { programId?: string | null; season?: number | null; divisionId?: string | null; packageId?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReportFilters(q: Record<string, string | string[] | undefined | null>): ReportFilters {
  const one = (k: string) => {
    const v = q[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const id = (k: string) => (UUID.test(one(k)) ? one(k) : null);
  const season = /^\d{4}$/.test(one("season")) ? Number(one("season")) : null;
  const programId = id("program");
  return { programId, season, divisionId: programId ? id("division") : null, packageId: programId ? id("package") : null };
}

export function reportQuery(f: ReportFilters): string {
  const p = new URLSearchParams();
  if (f.programId) p.set("program", f.programId);
  if (f.season) p.set("season", String(f.season));
  if (f.divisionId) p.set("division", f.divisionId);
  if (f.packageId) p.set("package", f.packageId);
  return p.toString();
}
