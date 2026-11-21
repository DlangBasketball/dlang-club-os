import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, postLoginDestination } from "@/lib/auth/get-user";
import { isSafeNextPath } from "@/lib/auth/safe-next";
import type { FamilyClient } from "@/lib/family/db";
import { revalidatePersonEverywhere } from "@/lib/people/revalidate";

/**
 * Single callback for every email auth flow:
 *  - PKCE / magic link / OAuth -> ?code=...        -> exchangeCodeForSession
 *  - OTP / invite / recovery   -> ?token_hash=&type -> verifyOtp
 * Honors an optional ?next=, otherwise routes to the role/onboarding home.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? searchParams.get("redirect");

  const supabase = await createClient();

  if (tokenHash && type) {
    await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  } else if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Open invitations to further clubs (guest checkout, second guardian,
  // staff invite) become memberships; the current club does not change.
  try {
    const { data: claimed } = await (supabase as unknown as FamilyClient).rpc("claim_my_invitations");
    // A guardian / staff member joined: family pages, rosters and recipients change in every portal.
    if (claimed) revalidatePersonEverywhere((await getSessionUser())?.orgId ?? null);
  } catch {
    // Signed out or nothing to claim.
  }

  if (next && isSafeNextPath(next)) return NextResponse.redirect(`${origin}${next}`);

  const user = await getSessionUser();
  const dest = user ? postLoginDestination(user) : "/login";
  return NextResponse.redirect(`${origin}${dest}`);
}
