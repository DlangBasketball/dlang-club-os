import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, postLoginDestination } from "@/lib/auth/get-user";

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

  if (next) return NextResponse.redirect(`${origin}${next}`);

  const user = await getSessionUser();
  const dest = user ? postLoginDestination(user) : "/login";
  return NextResponse.redirect(`${origin}${dest}`);
}
