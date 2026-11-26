import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getTranslations } from "@/lib/i18n/server";
import { shopDb } from "@/lib/shop/db";
import { normalizeBranding } from "@/lib/tenant/normalize";
import { buildMemberCardPdf } from "./pdf";

/**
 * PDF of an athlete's member card. The token RPC checks club + role
 * (admin, or the athlete's guardian); the athlete row is read through RLS.
 */
export async function renderMemberCardPdf(athleteId: string): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("parent")) || !(await tenantMatchesOrg(me.orgId))) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(athleteId)) return new NextResponse("Not found", { status: 404 });
  const db = await shopDb();
  const { data: token, error } = await db.rpc("member_card_token", { p_athlete: athleteId });
  if (error || typeof token !== "string") return new NextResponse("Not found", { status: 404 });
  const [{ data: athlete }, { data: org }, t] = await Promise.all([
    db.from("athletes").select("first_name,last_name").eq("id", athleteId).eq("org_id", me.orgId).maybeSingle(),
    db.from("organizations").select("name,branding").eq("id", me.orgId).maybeSingle(),
    getTranslations(me.orgId),
  ]);
  if (!athlete) return new NextResponse("Not found", { status: 404 });
  const a = athlete as { first_name: string; last_name: string };
  const o = org as { name?: string; branding?: unknown } | null;
  const bytes = await buildMemberCardPdf({
    clubName: o?.name ?? "",
    athleteName: `${a.first_name} ${a.last_name}`,
    token,
    brandColor: normalizeBranding(o?.branding).colors.primary,
    labels: { title: t("sports.cards.pdfTitle"), hint: t("sports.cards.pdfHint") },
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="member-card.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
