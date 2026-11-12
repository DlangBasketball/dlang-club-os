"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/layout/brand-mark";
import { Button, Input, Label } from "@/components/ui";
import { SITE_URL } from "@/lib/constants";
import { MailCheck } from "lucide-react";

export default function LoginPage() {
  // useSearchParams must be inside a Suspense boundary in Next 15.
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const params = useSearchParams();
  const redirect = params.get("redirect");
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);
    const supabase = createClient();
    const emailRedirectTo = `${SITE_URL}/auth/callback${
      redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""
    }`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo },
    });
    if (error) {
      setError(error.message);
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="grain relative grid min-h-dvh bg-bg lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel (prototype .login-left) — desktop only */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border px-14 py-10 lg:flex bg-brand-banner">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 -left-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--brand-primary)_18%,transparent),transparent_65%)]"
        />
        <BrandMark className="relative" />
        <div className="relative">
          <p className="max-w-[480px] font-display text-[38px] font-normal leading-[1.15] tracking-[-0.025em] text-text">
            Run the club.
            <br />
            Develop the <em className="not-italic text-brand-primary">players</em>.
            <br />
            Grow the business.
          </p>
          <p className="mt-6 max-w-[420px] text-[13px] leading-relaxed tracking-[0.02em] text-text-muted">
            One operating system for registrations, payments, training, coach
            workflow and parent communication.
          </p>
        </div>
        <div className="relative flex gap-8 border-t border-border pt-5 text-[11px] uppercase tracking-[0.14em] text-text-muted">
          <span>
            <strong className="font-medium text-text-secondary">Lausanne</strong> · Switzerland
          </span>
          <span>
            Status: <strong className="font-medium text-text-secondary">Operational</strong>
          </span>
        </div>
      </aside>

      {/* Sign-in panel (prototype .login-right / .login-card) */}
      <main className="flex items-center justify-center bg-bg-secondary px-4 py-10 sm:px-10">
        <div className="w-full max-w-[400px] animate-fade-up">
          <div className="mb-8 flex justify-center lg:hidden">
            <BrandMark />
          </div>

          <div className="rounded-lg border border-border bg-surface p-6 shadow-lg sm:p-8">
            {status === "sent" ? (
              <div className="flex flex-col items-center py-6 text-center" role="status">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-success/30 bg-success-soft text-success">
                  <MailCheck className="h-6 w-6" aria-hidden />
                </div>
                <h1 className="font-display text-2xl font-medium">Check your inbox</h1>
                <p className="mt-2 text-sm text-text-muted">
                  We sent a secure sign-in link to{" "}
                  <span className="text-text">{email}</span>. Open it on this
                  device to continue.
                </p>
              </div>
            ) : (
              <>
                <h1 className="font-display text-[32px] font-medium leading-tight tracking-[-0.02em]">Sign in</h1>
                <p className="mt-1.5 text-sm text-text-muted">
                  Use your email to receive a one-time secure link.
                </p>
                <form onSubmit={onSubmit} className="mt-8 space-y-4">
                  <div>
                    <Label htmlFor="email">Email address</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={status === "error" || undefined}
                      aria-describedby={error ? "email-error" : undefined}
                    />
                  </div>
                  {error && (
                    <p id="email-error" role="alert" className="text-xs text-danger">
                      {error}
                    </p>
                  )}
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    loading={status === "loading"}
                  >
                    {status === "loading" ? "Sending link…" : "Send magic link"}
                  </Button>
                </form>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-text-muted">
            Protected by row-level security
          </p>
        </div>
      </main>
    </div>
  );
}
