"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/get-user";

export type OnboardingInput = {
  fullName: string;
  phone?: string;
  locale?: string;
  acceptConsents: boolean;
};

/**
 * Completes a freshly-invited parent's onboarding:
 *  - updates their profile (name/phone/locale) and stamps onboarding_completed_at
 *  - records acceptance of every required, active consent form for each of
 *    their children (RLS lets a guardian insert consents for their own athletes)
 * Then redirects to the parent home.
 */
export async function completeOnboarding(input: OnboardingInput) {
  const me = await requireAuth();
  const supabase = await createClient();

  await supabase
    .from("profiles")
    .update({
      full_name: input.fullName,
      phone: input.phone ?? null,
      locale: input.locale ?? "en",
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq("id", me.id);

  if (input.acceptConsents && me.orgId) {
    // Children visible to this guardian (RLS scopes to their family).
    const { data: kids } = await supabase.from("athletes").select("id");
    const { data: forms } = await supabase
      .from("consent_forms")
      .select("id, version")
      .eq("is_required", true)
      .eq("is_active", true);

    if (kids?.length && forms?.length) {
      const rows = kids.flatMap((k: { id: string }) =>
        forms.map((f: { id: string; version: number }) => ({
          org_id: me.orgId,
          athlete_id: k.id,
          consent_form_id: f.id,
          accepted_version: f.version,
          accepted_by: me.id,
        })),
      );
      await supabase.from("consent_acceptances").insert(rows);
    }
  }

  redirect("/parent/home");
}
