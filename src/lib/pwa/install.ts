/**
 * "Install app" helpers. Pure (no React, no DOM globals) so they are unit
 * tested; the client component passes in navigator/window/localStorage.
 *
 *  - Android / desktop Chromium: the browser fires `beforeinstallprompt`;
 *    we keep the event and show our own "Install app" button.
 *  - iOS / iPadOS: no prompt API exists; we show Share -> Add to Home Screen
 *    instructions instead.
 *  - Already running as an installed app, or dismissed recently: show nothing.
 */

export type InstallPlatform = "ios" | "android" | "desktop" | "other";
export type InstallUiMode = "hidden" | "prompt" | "ios-instructions";

/** Re-offer the install card this long after "Not now". */
export const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DISMISS_KEY_PREFIX = "pwa-install-dismissed";

/** The non-standard event Chromium fires before showing its own install UI. */
export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

export function detectPlatform(userAgent: string | null | undefined, maxTouchPoints = 0): InstallPlatform {
  const ua = userAgent ?? "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ reports itself as desktop Safari ("Macintosh") with touch.
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return "desktop";
  return "other";
}

/** In-app browsers (Instagram, Facebook, ...) cannot add to the home screen. */
export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  return /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|TikTok/i.test(userAgent ?? "");
}

/** True when the page already runs as an installed app. */
export function isStandalone(opts: { displayModeStandalone?: boolean; navigatorStandalone?: boolean }): boolean {
  return Boolean(opts.displayModeStandalone || opts.navigatorStandalone);
}

export function installUiMode(state: {
  platform: InstallPlatform;
  standalone: boolean;
  hasPrompt: boolean;
  dismissed: boolean;
  inAppBrowser?: boolean;
}): InstallUiMode {
  if (state.standalone || state.dismissed) return "hidden";
  if (state.hasPrompt) return "prompt";
  if (state.platform === "ios" && !state.inAppBrowser) return "ios-instructions";
  return "hidden";
}

/** localStorage key, per club so one club's "Not now" doesn't hide another's. */
export function dismissKey(tenantSlug: string): string {
  return `${DISMISS_KEY_PREFIX}:${tenantSlug || "default"}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** True when dismissed within the TTL. Storage may be missing or throw (private mode). */
export function readDismissed(storage: StorageLike | null | undefined, key: string, now = Date.now()): boolean {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && now - at < DISMISS_TTL_MS && at <= now;
  } catch {
    return false;
  }
}

export function writeDismissed(storage: StorageLike | null | undefined, key: string, now = Date.now()): void {
  try {
    storage?.setItem(key, String(now));
  } catch {
    // Storage blocked: the card simply shows again next visit.
  }
}

/** Narrow an Event to the Chromium install event. */
export function isBeforeInstallPromptEvent(e: unknown): e is BeforeInstallPromptEvent {
  return Boolean(e && typeof (e as { prompt?: unknown }).prompt === "function");
}
