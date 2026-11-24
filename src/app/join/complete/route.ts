import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenant } from "@/lib/tenant/server";
import { logError } from "@/lib/log";
import type { EntryClient } from "@/lib/public-entry/db";
import { intentDestination, parseIntent, safeNext, safeSlug } from "@/lib/public-entry/shared";

/**
 * GET /join/complete?intent=&next=&club= — the auth callback's destination
 * after a club entry point (sign-up or sign-in). Runs the idempotent
 * family_bootstrap for the club of the host (or the public slug on the
 * platform host) and returns to the chosen activity.
 *
 * It never switches an existing current club (a GET must not change state
 * beyond the benign, idempotent guest family): when the account already
 * belongs to another club, /join asks the person to confirm (POST server
 * action) before switching.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const intent = parseIntent(url.searchParams.get("intent"));
  const next = safeNext(url.searchParams.get("next"));
  const tenant = await getTenant();
  const slug = tenant.id ? tenant.slug : safeSlug(url.searchParams.get("club"));
  const back = new URL("/join", url.origin);
  back.searchParams.set("intent", intent);
  if (next) back.searchParams.set("next", next);
  if (slug && !tenant.id) back.searchParams.set("club", slug);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !slug) return NextResponse.redirect(back);

  const db = supabase as unknown as EntryClient;
  const { data, error } = await db.rpc("family_bootstrap", { p_org_slug: slug });
  if (error) {
    logError("publicEntry.complete", error);
    return NextResponse.redirect(back);
  }
  const r = (data ?? {}) as { is_current?: boolean; guest?: boolean };
  if (!r.is_current) return NextResponse.redirect(back); // confirm the switch on /join
  // A guest family has nothing to onboard (name given at sign-up); invited member families keep their onboarding.
  if (r.guest) await supabase.from("profiles").update({ onboarding_completed_at: new Date().toISOString() } as never)
    .eq("id", user.id).is("onboarding_completed_at", null);
  return NextResponse.redirect(new URL(next ?? intentDestination(intent), url.origin));
}
