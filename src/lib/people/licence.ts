/**
 * Federation licence + postal address helpers (pure; shared by pages, the
 * import and unit tests).
 */

export type Licence = {
  number: string | null;
  category: string | null;
  federation: string | null;
  issuedOn: string | null;
  fee: number | null;
};

type LicenceRow = {
  licence_number?: string | null;
  licence_category?: string | null;
  licence_federation?: string | null;
  licence_issued_on?: string | null;
  licence_fee?: number | string | null;
};

export function licenceFromRow(r: LicenceRow): Licence {
  const fee = r.licence_fee === null || r.licence_fee === undefined ? null : Number(r.licence_fee);
  return {
    number: r.licence_number ?? null,
    category: r.licence_category ?? null,
    federation: r.licence_federation ?? null,
    issuedOn: r.licence_issued_on ?? null,
    fee: fee !== null && Number.isFinite(fee) ? fee : null,
  };
}

export function hasLicence(l: Pick<Licence, "number"> | null | undefined): boolean {
  return !!l?.number?.trim();
}

/** Players list filter (`?licence=has|missing`); anything else = all. */
export type LicenceFilter = "has" | "missing" | null;
export function parseLicenceFilter(v: string | string[] | undefined): LicenceFilter {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "has" || s === "missing" ? s : null;
}

/**
 * One-line postal address: street, postal code + city ("Avenue 1, 1000 City").
 * Missing parts are skipped; null when nothing is set.
 */
export function formatPostalAddress(a: { address?: string | null; postalCode?: string | null; city?: string | null }): string | null {
  const locality = [a.postalCode?.trim(), a.city?.trim()].filter(Boolean).join(" ");
  const out = [a.address?.trim(), locality].filter(Boolean).join(", ");
  return out || null;
}
