"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/layout/brand-mark";
import { Button, Input, Label } from "@/components/ui";
import { SITE_URL } from "@/lib/constants";
import { MailCheck } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

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
  const t = useT();
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
      setError(error.message || t("auth.errorGeneric"));
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="grain relative flex min-h-dvh items-center justify-center bg-bg bg-radial-maroon px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
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
              <h1 className="text-xl font-semibold">{t("auth.checkInbox")}</h1>
              <p className="mt-2 text-sm text-ink-2">{t("auth.linkSent", { email })}</p>
              <button
                type="button"
                onClick={() => setStatus("idle")}
                className="mt-4 text-xs text-ink-3 underline-offset-4 hover:text-ink hover:underline"
              >
                {t("auth.useDifferentEmail")}
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-semibold">{t("auth.signInTitle")}</h1>
              <p className="mt-1 text-sm text-ink-2">{t("auth.signInSubtitle")}</p>
              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                <div>
                  <Label htmlFor="email">{t("auth.emailLabel")}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder={t("auth.emailPlaceholder")}
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
                  {status === "loading" ? t("auth.sending") : t("auth.sendLink")}
                </Button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-ink-3">
          DLang Basketball · {t("auth.footer")}
        </p>
      </div>
    </div>
  );
}
