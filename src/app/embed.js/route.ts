import { EMBED_SCRIPT } from "@/lib/website/embed-script";

/** GET /embed.js — helper script for club websites (see src/lib/website/embed-script.ts). */
export const dynamic = "force-static";

export function GET() {
  return new Response(EMBED_SCRIPT, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
