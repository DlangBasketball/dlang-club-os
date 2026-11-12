"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Download, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { useTenant } from "@/lib/tenant/context";
import {
  detectPlatform,
  dismissKey,
  installUiMode,
  isInAppBrowser,
  isStandalone,
  readDismissed,
  writeDismissed,
  type InstallUiMode,
} from "@/lib/pwa/install";
import { clearDeferredPrompt, getDeferredPrompt, subscribeInstallPrompt } from "./install-store";

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * "Install app" card. Android / desktop Chromium: an Install button wired to
 * the captured `beforeinstallprompt`. iOS Safari: Share -> Add to Home Screen
 * steps. Hidden once installed or after "Not now" (remembered per club).
 */
export function InstallAppPrompt({ className, variant = "card" }: { className?: string; variant?: "card" | "banner" }) {
  const t = useT();
  const tenant = useTenant();
  const key = dismissKey(tenant.slug);
  // Server render and first client render: hidden (no hydration mismatch).
  const [mode, setMode] = useState<InstallUiMode>("hidden");

  const compute = useCallback(() => {
    const ua = navigator.userAgent;
    setMode(
      installUiMode({
        platform: detectPlatform(ua, navigator.maxTouchPoints ?? 0),
        standalone: isStandalone({
          displayModeStandalone: window.matchMedia?.("(display-mode: standalone)").matches,
          navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
        }),
        hasPrompt: getDeferredPrompt() !== null,
        dismissed: readDismissed(safeLocalStorage(), key),
        inAppBrowser: isInAppBrowser(ua),
      }),
    );
  }, [key]);

  useEffect(() => {
    compute();
    return subscribeInstallPrompt(compute);
  }, [compute]);

  const dismiss = () => {
    writeDismissed(safeLocalStorage(), key);
    setMode("hidden");
  };

  const install = async () => {
    const prompt = getDeferredPrompt();
    if (!prompt) return;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // Prompt already used or blocked by the browser.
    }
    clearDeferredPrompt();
  };

  if (mode === "hidden") return null;

  return (
    <section
      aria-labelledby="install-app-title"
      className={cn(
        "relative rounded-md border border-border bg-surface p-4 text-text shadow-sm",
        variant === "banner" && "border-brand-primary/40 bg-brand-primary-soft",
        className,
      )}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("pwa.install.close")}
        className="touch-target absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded text-text-muted hover:text-text"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <div aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-primary text-on-brand">
          <Download className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="install-app-title" className="font-display text-base font-semibold">
            {t("pwa.install.title", { app: tenant.appName })}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{t("pwa.install.body")}</p>

          {mode === "prompt" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={install}>
                <Download className="h-4 w-4" aria-hidden />
                {t("pwa.install.button")}
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                {t("pwa.install.dismiss")}
              </Button>
            </div>
          ) : (
            <div className="mt-3">
              <p className="text-sm font-medium">{t("pwa.install.iosTitle")}</p>
              <ol className="mt-2 space-y-2 text-sm text-text-muted">
                <li className="flex items-center gap-2">
                  <Share className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
                  <span>{t("pwa.install.iosStep1")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <SquarePlus className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
                  <span>{t("pwa.install.iosStep2")}</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
                  <span>{t("pwa.install.iosStep3")}</span>
                </li>
              </ol>
              <Button size="sm" variant="ghost" className="mt-2" onClick={dismiss}>
                {t("pwa.install.dismiss")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
