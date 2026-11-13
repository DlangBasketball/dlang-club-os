import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { homeForRoles } from "@/lib/auth/roles";
import { SALES_EMAIL, getSignupPlans, pendingFromMetadata } from "@/lib/platform/signup-data";
import { SignupForm } from "../signup-form";

export const dynamic = "force-dynamic";

/**
 * Landing page after the signup magic link. The club details entered before
 * the email round trip are restored (auth metadata, else localStorage) and the
 * user confirms — provision_tenant() then creates the organization.
 */
export default async function SignupCompletePage() {
  const user = await getSessionUser();
  if (!user) redirect("/signup");
  if (user.roles.length > 0) {
    redirect(user.roles.includes("admin") ? "/signup/plan" : homeForRoles(user.roles));
  }

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  const initial = pendingFromMetadata(authUser?.user_metadata);
  const plans = await getSignupPlans();

  return (
    <div className="animate-fade-up space-y-6 pt-4">
      <div>
        <h1 className="font-display text-3xl font-semibold">Email confirmed — one last step</h1>
        <p className="mt-2 text-ink-2">Check your details and create your organization.</p>
      </div>
      <div className="rounded-lg border border-line bg-surface p-6 shadow-lg sm:p-8">
        <SignupForm
          mode="direct"
          plans={plans}
          email={user.email}
          initial={{ ...initial, fullName: initial?.fullName ?? user.fullName ?? "" }}
          salesEmail={SALES_EMAIL}
        />
      </div>
    </div>
  );
}
