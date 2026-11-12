import { ImageResponse } from "next/og";
import { getTenant } from "@/lib/tenant/server";
import { readableOn } from "@/lib/tenant/theme";
import { DEFAULT_BRANDING } from "@/lib/tenant/defaults";
import {
  PWA_ICON_VARIANTS,
  iconMonogram,
  isFetchableLogoUrl,
  isPwaIconVariant,
  monogramColors,
} from "@/lib/pwa/manifest";
import { isHexColor, normalizeHex } from "@/lib/tenant/theme";

/**
 * Per-tenant app icons: /pwa/icon/192, /512, /maskable-512, /apple-touch.
 * The club logo (when set and fetchable) on the club background, else a
 * monogram on the brand gradient. Tenant from the request host only.
 */
export const dynamic = "force-dynamic";

const LOGO_TIMEOUT_MS = 3_000;
const LOGO_MAX_BYTES = 1_000_000;
const LOGO_TYPES = new Set(["image/png", "image/jpeg"]);

/** Logo as a data URL, or null (not set, unsafe URL, wrong type, too big, slow). */
async function loadLogo(url: string | null): Promise<string | null> {
  if (!isFetchableLogoUrl(url)) return null;
  try {
    const res = await fetch(url!, { redirect: "error", signal: AbortSignal.timeout(LOGO_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!LOGO_TYPES.has(type)) return null;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > LOGO_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > LOGO_MAX_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ variant: string }> }) {
  const { variant } = await params;
  if (!isPwaIconVariant(variant)) return new Response("Not found", { status: 404 });
  const { size, maskable } = PWA_ICON_VARIANTS[variant];
  const tenant = await getTenant();
  const bg = isHexColor(tenant.branding.colors.background) ? normalizeHex(tenant.branding.colors.background) : DEFAULT_BRANDING.colors.background;
  const logo = await loadLogo(tenant.branding.logoUrl);

  // Maskable icons keep content inside the central 80% safe zone.
  const logoBox = Math.round(size * (maskable ? 0.56 : 0.76));

  let body: React.ReactElement;
  if (logo) {
    body = (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: bg }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by next/og, not the DOM */}
        <img src={logo} alt="" width={logoBox} height={logoBox} style={{ objectFit: "contain" }} />
      </div>
    );
  } else {
    const { from, to } = monogramColors(tenant);
    body = (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(135deg, ${from}, ${to})`,
          color: readableOn(from),
          fontSize: Math.round(size * (maskable ? 0.42 : 0.56)),
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {iconMonogram(tenant.appName)}
      </div>
    );
  }

  return new ImageResponse(body, {
    width: size,
    height: size,
    headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", Vary: "Host" },
  });
}
