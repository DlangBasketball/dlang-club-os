import type { Metadata } from "next";
import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/platform/catalog";

export const metadata: Metadata = {
  title: `Start your club on ${PLATFORM_NAME}`,
  description: "Registration, payments, attendance and communication for sports clubs, teams, schools and federations.",
};

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain min-h-dvh bg-bg bg-radial-maroon">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-maroon shadow-glow-red">
            <span className="font-display text-lg font-bold text-inverse">{PLATFORM_NAME.charAt(0)}</span>
          </div>
          <span className="font-display text-sm font-semibold text-ink">{PLATFORM_NAME}</span>
        </div>
        <Link href="/login" className="text-sm text-ink-2 hover:text-ink">
          Sign in
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16">{children}</main>
    </div>
  );
}
