"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from "./config";

export type SetLocaleResult = { ok: true } | { ok: false; error: string };

/**
 * Persist an explicit language choice:
 *  - always in the `locale` cookie (works for signed-out visitors), and
 *  - on the signed-in user's profile (profiles.locale + locale_set_at), so
 *    the choice follows them across devices and into emails.
 * RLS: profiles_update_self allows a user to update their own row only.
 */
export async function setLocale(locale: string): Promise<SetLocaleResult> {
  if (!isLocale(locale)) return { ok: false, error: "Unsupported language" };

  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
  });

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from("profiles")
        .update({ locale, locale_set_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) {
        // Before the i18n migration is applied locale_set_at doesn't exist yet:
        // still store the language; the cookie carries the explicit choice.
        await supabase.from("profiles").update({ locale }).eq("id", user.id);
      }
    }
  } catch {
    // Cookie is already set; the profile write is best-effort.
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
