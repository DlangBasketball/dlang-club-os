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
import { useT } from "@/lib/i18n/client";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";

/**
 * Optional email + password sign-in, for staging/demo deployments whose demo
 * accounts use reserved (undeliverable) addresses. OFF unless the deployment
 * sets NEXT_PUBLIC_AUTH_PASSWORD_LOGIN=true; production keeps magic links only.
 */
const PASSWORD_LOGIN = process.env.NEXT_PUBLIC_AUTH_PASSWORD_LOGIN === "true";

/** Same-origin relative path only (blocks //host and /\\host open redirects). */
function safeRedirect(path: string | null): string {
  return path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
}

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
  const t = useT();
  const redirect = params.get("redirect");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const usePassword = PASSWORD_LOGIN && password.trim().length > 0;
  const [status, setStatus] = React.useState<"idle" | "loading" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError(null);
    const supabase = createClient();
    if (usePassword) {
      const { error: pwError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        // Pasted passwords often carry stray whitespace (phones, docs).
        password: password.trim(),
      });
      if (pwError) {
        setError(t("auth.passwordError"));
        setStatus("error");
        return;
      }
      // Full navigation so the server sees the new session cookies.
      window.location.assign(safeRedirect(redirect));
      return;
    }
    const emailRedirectTo = `${SITE_URL}/auth/callback${
      redirect ? `?redirect=${encodeURIComponent(redirect)}` : ""
    }`;
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo },
    });
    if (error) {
      setError(error.message || t("auth.errorGeneric"));
      setStatus("error");
    } else {
      setStatus("sent");
    }
  }

  const [heroPre, heroPost] = t("auth.heroLine2", { em: "\u0001" }).split("\u0001");
  let country = tenant.country;
  try {
    country = new Intl.DisplayNames([tenant.defaultLocale], { type: "region" }).of(tenant.country) ?? tenant.country;
  } catch {
    /* unknown region code: show it as-is */
  }

  return (
    <div className="grain relative grid min-h-dvh bg-bg lg:grid-cols-[1.05fr_1fr]">
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher />
      </div>
      {/* Brand panel (prototype .login-left) — desktop only */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-border px-14 py-10 lg:flex bg-brand-banner">
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-48 -left-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--brand-primary)_18%,transparent),transparent_65%)]"
        />
        <BrandMark className="relative" />
        <div className="relative">
          <p className="max-w-[480px] font-display text-[38px] font-normal leading-[1.15] tracking-[-0.025em] text-text">
            {t("auth.heroLine1")}
            <br />
            {heroPre}
            <em className="not-italic text-brand-primary">{t("auth.heroLine2Em")}</em>
            {heroPost}
            <br />
            {t("auth.heroLine3")}
          </p>
          <p className="mt-6 max-w-[420px] text-[13px] leading-relaxed tracking-[0.02em] text-text-muted">
            {t("auth.heroBody")}
          </p>
        </div>
        <div className="relative flex gap-8 border-t border-border pt-5 text-[11px] uppercase tracking-[0.14em] text-text-muted">
          <span>
            <strong className="font-medium text-text-secondary">{tenant.name}</strong> · {country}
          </span>
          <span>
            {t("auth.statusLabel")}: <strong className="font-medium text-text-secondary">{t("auth.statusOperational")}</strong>
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
                <h1 className="font-display text-2xl font-medium">{t("auth.checkInbox")}</h1>
                <p className="mt-2 text-sm text-text-muted">{t("auth.linkSent", { email })}</p>
                <button
                  type="button"
                  onClick={() => setStatus("idle")}
                  className="mt-4 text-xs text-text-muted underline-offset-4 hover:text-text hover:underline"
                >
                  {t("auth.useDifferentEmail")}
                </button>
              </div>
            ) : (
              <>
                <h1 className="font-display text-[32px] font-medium leading-tight tracking-[-0.02em]">{t("auth.signInTitle")}</h1>
                <p className="mt-1.5 text-sm text-text-muted">{t("auth.signInSubtitle")}</p>
                <form onSubmit={onSubmit} className="mt-8 space-y-4">
                  <div>
                    <Label htmlFor="email">{t("auth.emailLabel")}</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                      placeholder={t("auth.emailPlaceholder")}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      aria-invalid={status === "error" || undefined}
                      aria-describedby={error ? "email-error" : undefined}
                    />
                  </div>
                  {PASSWORD_LOGIN && (
                    <div>
                      <Label htmlFor="password">{t("auth.passwordLabel")}</Label>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        aria-describedby="password-hint"
                      />
                      <p id="password-hint" className="mt-1 text-xs text-text-muted">
                        {t("auth.passwordHint")}
                      </p>
                    </div>
                  )}
                  {error && (
                    <p id="email-error" role="alert" className="text-xs text-danger">
                      {error}
                    </p>
                  )}
                  <Button type="submit" size="lg" className="w-full" loading={status === "loading"}>
                    {usePassword
                      ? status === "loading"
                        ? t("auth.signingIn")
                        : t("auth.signIn")
                      : status === "loading"
                        ? t("auth.sending")
                        : t("auth.sendLink")}
                  </Button>
                </form>
              </>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-text-muted">
            {tenant.appName} · {t("auth.footer")}
          </p>
        </div>
      </main>
    </div>
  );
}
