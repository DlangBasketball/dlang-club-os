"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/layout/brand-mark";
import { Button, Input, Label } from "@/components/ui";
import { SITE_URL } from "@/lib/constants";
import { MailCheck } from "lucide-react";
import { useTenant } from "@/lib/tenant/context";

export default function LoginPage() {
  // useSearchParams must be inside a Suspense boundary in Next 15.
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const tenant = useTenant();
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
    <div className="grain relative flex min-h-dvh items-center justify-center bg-bg bg-radial-maroon px-4">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>

        <div className="rounded-lg border border-line bg-surface p-6 shadow-lg">
          {status === "sent" ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
                <MailCheck className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-semibold">Check your inbox</h1>
              <p className="mt-2 text-sm text-ink-2">
                We sent a secure sign-in link to{" "}
                <span className="text-ink">{email}</span>. Open it on this
                device to continue.
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold">Sign in</h1>
              <p className="mt-1 text-sm text-ink-2">
                Use your email to receive a one-time secure link.
              </p>
              <form onSubmit={onSubmit} className="mt-6 space-y-4">
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
                  />
                </div>
                {error && <p className="text-xs text-danger">{error}</p>}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={status === "loading"}
                >
                  {status === "loading" ? "Sending link…" : "Send magic link"}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-ink-3">
          {tenant.name} · Protected by row-level security
        </p>
      </div>
    </div>
  );
}
