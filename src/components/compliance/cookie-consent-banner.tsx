"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CATEGORY_INFO,
  CONSENT_CHANGED_EVENT,
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  NECESSARY_ONLY,
  OPEN_CONSENT_EVENT,
  parseConsent,
  serializeConsent,
  type ConsentCategory,
  type CookieConsent,
} from "@/lib/compliance/cookies";

function readConsentCookie(): CookieConsent | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  return parseConsent(m ? m.slice(CONSENT_COOKIE.length + 1) : null);
}

function writeConsentCookie(c: CookieConsent) {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(c)}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: c }));
}

function gpcEnabled(): boolean {
  return typeof navigator !== "undefined" && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** Current consent (null until the visitor decides). Re-renders on change. */
export function useCookieConsent(): CookieConsent | null {
  const [c, setC] = useState<CookieConsent | null>(null);
  useEffect(() => {
    setC(readConsentCookie());
    const on = (e: Event) => setC((e as CustomEvent<CookieConsent>).detail);
    window.addEventListener(CONSENT_CHANGED_EVENT, on);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, on);
  }, []);
  return c;
}

/** Renders children (e.g. an analytics <Script>) ONLY after opt-in. */
export function ConsentGate({ category, children }: { category: Exclude<ConsentCategory, "necessary">; children: React.ReactNode }) {
  const c = useCookieConsent();
  return c && c[category] ? <>{children}</> : null;
}

/** Footer link / button that reopens the preferences dialog. */
export function CookieSettingsButton({ className, label = "Cookie settings" }: { className?: string; label?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
      {label}
    </button>
  );
}

const OPTIONAL: Exclude<ConsentCategory, "necessary">[] = ["functional", "analytics", "marketing"];

/**
 * Cookie/consent banner. Strictly-necessary only by default: nothing optional
 * is enabled until the visitor actively opts in. "Reject" is as prominent as
 * "Accept" (EDPB guidelines 03/2022 on deceptive design). GPC = no marketing.
 */
export function CookieConsentBanner({ policyHref = "/legal" }: { policyHref?: string }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [gpc, setGpc] = useState(false);
  const [choice, setChoice] = useState<Record<(typeof OPTIONAL)[number], boolean>>({ functional: false, analytics: false, marketing: false });

  useEffect(() => {
    const g = gpcEnabled();
    setGpc(g);
    const existing = readConsentCookie();
    if (existing) {
      setChoice({ functional: existing.functional, analytics: existing.analytics, marketing: existing.marketing });
    } else {
      setOpen(true);
    }
    const reopen = () => { setDetails(true); setOpen(true); };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  const save = useCallback((c: CookieConsent) => { writeConsentCookie(c); setOpen(false); setDetails(false); }, []);
  const rejectAll = () => save(NECESSARY_ONLY(gpc));
  const acceptAll = () => save({ ...NECESSARY_ONLY(gpc), functional: true, analytics: true, marketing: !gpc });
  const saveChoice = () => save({ ...NECESSARY_ONLY(gpc), ...choice, marketing: choice.marketing && !gpc });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-[100] p-3 sm:p-4"
    >
      <div className="mx-auto max-w-3xl rounded-lg border border-line bg-surface-elevated p-4 text-sm text-ink shadow-lg sm:p-5">
        <h2 id="cookie-consent-title" className="font-display text-base font-semibold">Your privacy choices</h2>
        <p className="mt-1.5 text-ink-2">
          We only use strictly necessary cookies to sign you in and keep the service secure. Optional cookies stay off
          unless you switch them on.{" "}
          <a href={policyHref} className="text-maroon underline underline-offset-2">Cookie &amp; privacy information</a>
        </p>
        {gpc && (
          <p className="mt-2 text-xs text-ink-3">Your browser sends a Global Privacy Control signal — marketing cookies are disabled.</p>
        )}

        {details && (
          <ul className="mt-3 space-y-2">
            <li className="flex items-start justify-between gap-4 rounded-md border border-line-soft p-3">
              <div>
                <div className="font-medium">{CATEGORY_INFO.necessary.label}</div>
                <div className="text-xs text-ink-3">{CATEGORY_INFO.necessary.description}</div>
              </div>
              <span className="shrink-0 text-xs text-ink-3">Always on</span>
            </li>
            {OPTIONAL.map((cat) => (
              <li key={cat} className="flex items-start justify-between gap-4 rounded-md border border-line-soft p-3">
                <label htmlFor={`consent-${cat}`} className="cursor-pointer">
                  <div className="font-medium">{CATEGORY_INFO[cat].label}</div>
                  <div className="text-xs text-ink-3">{CATEGORY_INFO[cat].description}</div>
                </label>
                <input
                  id={`consent-${cat}`}
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--red-primary)]"
                  checked={choice[cat]}
                  disabled={cat === "marketing" && gpc}
                  onChange={(e) => setChoice((p) => ({ ...p, [cat]: e.target.checked }))}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {details ? (
            <button type="button" onClick={saveChoice} className="rounded-md border border-line px-4 py-2 font-medium text-ink hover:bg-surface">
              Save choices
            </button>
          ) : (
            <button type="button" onClick={() => setDetails(true)} className="rounded-md border border-line px-4 py-2 font-medium text-ink hover:bg-surface">
              Customise
            </button>
          )}
          <button type="button" onClick={rejectAll} className="rounded-md border border-line px-4 py-2 font-medium text-ink hover:bg-surface">
            Necessary only
          </button>
          <button type="button" onClick={acceptAll} className="rounded-md bg-maroon px-4 py-2 font-medium text-inverse hover:bg-maroon-dark">
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
