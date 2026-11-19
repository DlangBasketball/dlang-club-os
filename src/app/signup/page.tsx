import Link from "next/link";
import { getSessionUser } from "@/lib/auth/get-user";
import { homeForRoles } from "@/lib/auth/roles";
import { PLATFORM_NAME, TRIAL_DAYS } from "@/lib/platform/catalog";
import { SALES_EMAIL, getSignupPlans } from "@/lib/platform/signup-data";
import { SignupForm } from "./signup-form";

export const dynamic = "force-dynamic";

/**
 * Public club self-signup. Signed-out visitors confirm their email with a
 * magic link first (then finish on /signup/complete); a signed-in account that
 * doesn't belong to any club yet can create its organization right away.
 */
export default async function SignupPage() {
  const [user, plans] = await Promise.all([getSessionUser(), getSignupPlans()]);
  const isMember = Boolean(user && user.roles.length > 0);

  return (
    <div className="animate-fade-up space-y-8 pt-4">
      <div>
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">Run your whole club in one place.</h1>
        <p className="mt-3 max-w-xl text-ink-2">
          Registrations, invoices and payments, attendance, bookings and family communication — for clubs, teams,
          schools and federations in any sport. Free for {TRIAL_DAYS} days.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-surface p-6 shadow-lg sm:p-8">
        {isMember ? (
          <div className="space-y-3 text-sm text-ink-2">
            <p>
              You&apos;re signed in as <span className="text-ink">{user!.email}</span>, which already belongs to an
              organization on {PLATFORM_NAME}.
            </p>
            <p>To create another organization, sign out and start again with a different email address.</p>
            <div className="flex gap-3 pt-2">
              <Link
                href={homeForRoles(user!.roles) as never}
                className="rounded border border-line px-4 py-2 text-ink hover:border-maroon/60"
              >
                Go to my club
              </Link>
              <form action="/auth/signout" method="post">
                <button type="submit" className="rounded px-4 py-2 text-ink-3 hover:text-danger">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        ) : (
          <SignupForm
            mode={user ? "direct" : "email"}
            plans={plans}
            email={user?.email}
            initial={{ fullName: user?.fullName && user.fullName !== user.email ? user.fullName : "" }}
            salesEmail={SALES_EMAIL}
          />
        )}
      </div>

      <p className="text-center text-xs text-ink-3">
        Prices exclude VAT where applicable. Data hosted in the EU. Already have an account?{" "}
        <Link href="/login" className="text-ink-2 underline-offset-2 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
