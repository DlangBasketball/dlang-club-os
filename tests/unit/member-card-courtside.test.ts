import { describe, expect, it } from "vitest";
import {
  PREVIEW_NAMES, brandInitials, cardLayout, fitName, resolveCardBrands, type BrandInputs,
} from "@/lib/member-cards/courtside";
import {
  CROP_RATIO, centredOffset, clampOffset, cropRect, frameSize, outputSize, scaleFor, zoomAround,
} from "@/lib/people/crop";

// Synthetic ids / names only.
const CLUB = "00000000-0000-0000-0000-0000000000c1";
const ACADEMY = "00000000-0000-0000-0000-0000000000a1";
const TODAY = "2026-11-23";
const NOW = Date.parse("2026-11-23T12:00:00Z");

function inputs(over: Partial<BrandInputs> = {}): BrandInputs {
  return {
    today: TODAY,
    now: NOW,
    defaultEntityId: CLUB,
    routes: { selection: ACADEMY, training: ACADEMY },
    entities: { [CLUB]: { name: "Synthetic Club", isActive: true }, [ACADEMY]: { name: "Synthetic Academy", isActive: true } },
    memberships: [],
    selections: [],
    packages: [],
    ...over,
  };
}
const membership = { status: "active", validFrom: "2026-08-01", validUntil: "2027-07-31" };
const enrolled = { status: "enrolled", programActive: true, programEndsOn: null };
const pkg = { status: "active", expiresAt: null, sessions: 10, sessionsUsed: 2 };

describe("card layout", () => {
  it("uses the photo layout only with a photo URL", () => {
    expect(cardLayout("https://storage.example.test/signed")).toBe("photo");
    expect(cardLayout(null)).toBe("noPhoto");
    expect(cardLayout("  ")).toBe("noPhoto");
    expect(cardLayout(undefined)).toBe("noPhoto");
  });
});

describe("name fitting", () => {
  it("keeps short names on one large line", () => {
    expect(fitName("Alex Martin", "noPhoto")).toEqual({ lines: ["Alex Martin"], size: "xl" });
    expect(fitName("Alex Martin", "photo")).toEqual({ lines: ["Alex Martin"], size: "xl" });
  });

  it("collapses whitespace", () => {
    expect(fitName("  Alex   Martin ", "photo").lines).toEqual(["Alex Martin"]);
  });

  it("wraps long names to two balanced lines and shrinks", () => {
    const f = fitName("Maximilian Alexander von Hohenberg-Castellanos", "photo");
    expect(f.lines).toHaveLength(2);
    expect(f.lines.join(" ")).toBe("Maximilian Alexander von Hohenberg-Castellanos");
    expect(["md", "sm", "xs"]).toContain(f.size);
  });

  it("never returns more than two lines, clipping as a last resort", () => {
    const f = fitName("Abcdefghijklmnopqrstuvwxyzabcdefghijklmnop Q", "photo");
    expect(f.lines.length).toBeLessThanOrEqual(2);
    expect(f.size).toBe("xs");
    for (const l of f.lines) expect(l.length).toBeLessThanOrEqual(29);
    expect(f.lines[0].endsWith("…")).toBe(true);
  });

  it("gives the name more room without a photo", () => {
    const name = "Noa Keller-Dubois Martin";
    const order = ["xl", "lg", "md", "sm", "xs"];
    expect(order.indexOf(fitName(name, "noPhoto").size)).toBeLessThanOrEqual(order.indexOf(fitName(name, "photo").size));
  });

  it("fits every preview name", () => {
    for (const n of PREVIEW_NAMES) for (const l of ["photo", "noPhoto"] as const) {
      const f = fitName(n, l);
      expect(f.lines.length).toBeGreaterThan(0);
      expect(f.lines.length).toBeLessThanOrEqual(2);
    }
  });
});

describe("brand resolution (mirror of member_card_brand_sources)", () => {
  it("falls back to the default entity without eligibility", () => {
    expect(resolveCardBrands(inputs())).toEqual([{ entityId: CLUB, sources: [], isFallback: true }]);
  });

  it("club membership -> the routed club_membership entity (default)", () => {
    expect(resolveCardBrands(inputs({ memberships: [membership] }))).toEqual([{ entityId: CLUB, sources: ["club_membership"], isFallback: false }]);
  });

  it("club membership -> its invoice entity, unless that was a migration default", () => {
    const m = { ...membership, invoiceEntityId: ACADEMY, invoiceEntitySource: "route", invoiceStatus: "pending" };
    expect(resolveCardBrands(inputs({ memberships: [m] }))[0].entityId).toBe(ACADEMY);
    expect(resolveCardBrands(inputs({ memberships: [{ ...m, invoiceEntitySource: "migration_default" }] }))[0].entityId).toBe(CLUB);
    expect(resolveCardBrands(inputs({ memberships: [{ ...m, invoiceStatus: "void" }] }))[0].entityId).toBe(CLUB);
  });

  it("expired or cancelled memberships do not count", () => {
    expect(resolveCardBrands(inputs({ memberships: [{ ...membership, validUntil: "2026-11-22" }] }))[0].isFallback).toBe(true);
    expect(resolveCardBrands(inputs({ memberships: [{ ...membership, status: "cancelled" }] }))[0].isFallback).toBe(true);
  });

  it("selection enrolment and training package -> the routed entity", () => {
    expect(resolveCardBrands(inputs({ selections: [enrolled] }))).toEqual([{ entityId: ACADEMY, sources: ["selection"], isFallback: false }]);
    expect(resolveCardBrands(inputs({ packages: [pkg] }))).toEqual([{ entityId: ACADEMY, sources: ["training"], isFallback: false }]);
    expect(resolveCardBrands(inputs({ selections: [enrolled], packages: [pkg] })))
      .toEqual([{ entityId: ACADEMY, sources: ["selection", "training"], isFallback: false }]);
  });

  it("dual brand: membership + selection -> club first, then academy", () => {
    expect(resolveCardBrands(inputs({ memberships: [membership], selections: [enrolled] })).map((b) => b.entityId)).toEqual([CLUB, ACADEMY]);
  });

  it("ignores applications, ended programmes, used-up or expired packages", () => {
    expect(resolveCardBrands(inputs({ selections: [{ ...enrolled, status: "applied" }] }))[0].isFallback).toBe(true);
    expect(resolveCardBrands(inputs({ selections: [{ ...enrolled, programEndsOn: "2026-11-01" }] }))[0].isFallback).toBe(true);
    expect(resolveCardBrands(inputs({ packages: [{ ...pkg, sessionsUsed: 10 }] }))[0].isFallback).toBe(true);
    expect(resolveCardBrands(inputs({ packages: [{ ...pkg, expiresAt: "2026-11-01T00:00:00Z" }] }))[0].isFallback).toBe(true);
  });

  it("an unrouted activity uses the default entity; inactive entities never appear", () => {
    expect(resolveCardBrands(inputs({ routes: {}, packages: [pkg] }))[0]).toEqual({ entityId: CLUB, sources: ["training"], isFallback: false });
    const off = inputs({ selections: [enrolled], memberships: [membership],
      entities: { [CLUB]: { name: "Synthetic Club", isActive: true }, [ACADEMY]: { name: "Synthetic Academy", isActive: false } } });
    // routed entity inactive -> default entity (as billing_entity_resolve does)
    expect(resolveCardBrands(off).map((b) => b.entityId)).toEqual([CLUB]);
  });

  it("no entity at all -> no brand (text-only club name is added by the loader)", () => {
    expect(resolveCardBrands(inputs({ defaultEntityId: null, routes: {} }))).toEqual([]);
  });
});

describe("brand initials", () => {
  it("builds a text-only monogram", () => {
    expect(brandInitials("Synthetic Sports Club")).toBe("SSC");
    expect(brandInitials("École de Basket · Genève")).toBe("ÉDB");
    expect(brandInitials("")).toBe("");
  });
});

describe("photo crop maths", () => {
  const image = { width: 1200, height: 800 };
  const frame = frameSize(CROP_RATIO.portrait, 300, 340);

  it("portrait frame is 4:5 inside the box", () => {
    expect(frame).toEqual({ width: 272, height: 340 });
    expect(frameSize(CROP_RATIO.square, 300, 340)).toEqual({ width: 300, height: 300 });
  });

  it("zoom 1 covers the frame; the centred crop is centred", () => {
    const s = scaleFor(image, frame, 1);
    expect(image.height * s).toBeCloseTo(frame.height);
    const r = cropRect(image, frame, 1, centredOffset(image, frame, 1));
    expect(r.sh).toBeCloseTo(800);
    expect(r.sw / r.sh).toBeCloseTo(0.8);
    expect(r.sx + r.sw / 2).toBeCloseTo(600);
  });

  it("panning is clamped so the image always covers the frame", () => {
    const o = clampOffset({ x: 500, y: 500 }, image, frame, 1);
    expect(o).toEqual({ x: 0, y: 0 });
    const far = clampOffset({ x: -99999, y: -99999 }, image, frame, 1);
    const r = cropRect(image, frame, 1, far);
    expect(r.sx + r.sw).toBeCloseTo(1200);
    expect(r.sy + r.sh).toBeCloseTo(800);
  });

  it("zooming keeps the centre point and shrinks the crop", () => {
    const o1 = centredOffset(image, frame, 1);
    const o2 = zoomAround(o1, image, frame, 1, 2);
    const r1 = cropRect(image, frame, 1, o1);
    const r2 = cropRect(image, frame, 2, o2);
    expect(r2.sw).toBeCloseTo(r1.sw / 2);
    expect(r2.sx + r2.sw / 2).toBeCloseTo(r1.sx + r1.sw / 2);
    expect(r2.sy + r2.sh / 2).toBeCloseTo(r1.sy + r1.sh / 2);
  });

  it("caps the output size on the long side", () => {
    expect(outputSize({ sx: 0, sy: 0, sw: 3200, sh: 4000 }, 1600)).toEqual({ width: 1280, height: 1600 });
    expect(outputSize({ sx: 0, sy: 0, sw: 400, sh: 500 }, 1600)).toEqual({ width: 400, height: 500 });
  });
});
