import { redirect } from "next/navigation";
import { getSessionUser, postLoginDestination } from "@/lib/auth/get-user";
import { homeForRoles } from "@/lib/auth/roles";
import { BrandMark } from "@/components/layout/brand-mark";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Already done, or not a parent -> go where they belong.
  if (user.onboardingCompleted) redirect(homeForRoles(user.roles));
  if (!user.roles.includes("parent")) redirect(postLoginDestination(user));

  return (
    <div className="grain min-h-dvh bg-bg bg-radial-maroon">
      <header className="mx-auto flex max-w-xl items-center px-4 py-6">
        <BrandMark />
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">
        <OnboardingForm
          defaultName={user.fullName ?? ""}
          email={user.email ?? ""}
        />
      </main>
    </div>
  );
}
