import { handlePublicApi, handlePublicApiOptions } from "@/lib/website/public-api";

/**
 * Public website API v1 (docs/website/PUBLIC_API_CONTRACT.md):
 * GET /api/public/v1/{club,programs,camps,events,results,teams,coaches,training,shop,campaigns,news,calendar.ics}
 * Read-only, per-club, public data only; CORS per the club's allowed origins.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ resource: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { resource } = await ctx.params;
  return handlePublicApi(req, resource);
}

export async function OPTIONS(req: Request, ctx: Ctx) {
  const { resource } = await ctx.params;
  return handlePublicApiOptions(req, resource);
}
