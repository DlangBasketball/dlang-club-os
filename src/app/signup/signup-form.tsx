"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MailCheck, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";
import { cn } from "@/lib/utils";
import { COUNTRIES, LOCALES, SPORTS, TRIAL_DAYS, defaultsForCountry, formatMoney } from "@/lib/platform/catalog";
import { slugProblem, slugify, tenantSignupSchema } from "@/lib/platform/validation";
import { checkSlugAvailability, provisionTenantAction } from "@/lib/platform/signup-actions";
import type { Currency, SignupPlan, SignupValues } from "@/lib/platform/types";

export type { SignupPlan, SignupValues };


const STORAGE_KEY = "clubos.pendingTenant";
const select =
  "h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink focus-visible:border-maroon/60 focus-visible:outline-none";

export function SignupForm({
  mode,
  plans,
  initial,
  email: signedInEmail,
  salesEmail,
}: {
  /** "email": not signed in -> magic link first. "direct": signed in -> provision now. */
  mode: "email" | "direct";
  plans: SignupPlan[];
  initial?: Partial<SignupValues>;
  email?: string | null;
  salesEmail: string;
}) {
  const router = useRouter();
  const [v, setV] = React.useState<SignupValues>(() => ({
    name: initial?.name ?? "",
    slug: initial?.slug ?? "",
    sport: initial?.sport ?? "basketball",
    country: initial?.country ?? "CH",
    currency: initial?.currency ?? "CHF",
    locale: initial?.locale ?? "en",
    fullName: initial?.fullName ?? "",
    plan: initial?.plan ?? "club",
  }));
  const [slugTouched, setSlugTouched] = React.useState(Boolean(initial?.slug));
  const [slugState, setSlugState] = React.useState<{ checking: boolean; ok: boolean | null; msg?: string }>({
    checking: false,
    ok: null,
  });
  const [email, setEmail] = React.useState("");
  const [agree, setAgree] = React.useState(mode === "direct" && Boolean(initial?.name));
  const [error, setError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<"idle" | "working" | "sent">("idle");

  // Restore a pending signup stashed before the magic-link round trip.
  React.useEffect(() => {
    if (mode !== "direct" || initial?.name) return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SignupValues>;
        setV((x) => ({ ...x, ...saved }));
        if (saved.slug) setSlugTouched(true);
      }
    } catch {
      /* storage unavailable */
    }
  }, [mode, initial?.name]);

  const set = <K extends keyof SignupValues>(k: K, val: SignupValues[K]) => setV((x) => ({ ...x, [k]: val }));

  // Debounced slug availability check.
  React.useEffect(() => {
    const slug = v.slug;
    if (!slug) {
      setSlugState({ checking: false, ok: null });
      return;
    }
    const local = slugProblem(slug);
    if (local) {
      setSlugState({ checking: false, ok: false, msg: local });
      return;
    }
    setSlugState({ checking: true, ok: null });
    const t = setTimeout(async () => {
      const r = await checkSlugAvailability(slug);
      setSlugState({ checking: false, ok: r.available, msg: r.message });
    }, 350);
    return () => clearTimeout(t);
  }, [v.slug]);

  function onName(name: string) {
    set("name", name);
    if (!slugTouched) set("slug", slugify(name));
  }

  function onCountry(code: string) {
    const d = defaultsForCountry(code);
    setV((x) => ({ ...x, country: code, currency: d.currency, locale: d.locale }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = tenantSignupSchema.safeParse(v);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (!agree) {
      setError("Please accept the terms and the data-processing agreement.");
      return;
    }
    if (slugState.ok === false) {
      setError(slugState.msg ?? "Please choose another web address.");
      return;
    }
    setStatus("working");

    if (mode === "direct") {
      const r = await provisionTenantAction(v);
      if (!r.ok) {
        setError(r.error);
        setStatus("idle");
        return;
      }
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      router.push("/signup/plan?welcome=1");
      router.refresh();
      return;
    }

    // Not signed in: verify the email first (magic link). The club details
    // travel in auth metadata (new accounts) and localStorage (fallback).
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      /* ignore */
    }
    const supabase = createClient();
    const origin = window.location.origin;
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/signup/complete")}`,
        data: { full_name: v.fullName, locale: v.locale, pending_tenant: v },
      },
    });
    if (otpError) {
      setError(otpError.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success">
          <MailCheck className="h-6 w-6" />
        </div>
        <h2 className="text-xl font-semibold">Confirm your email</h2>
        <p className="mt-2 max-w-sm text-sm text-ink-2">
          We sent a secure link to <span className="text-ink">{email}</span>. Open it on this device to finish creating{" "}
          <span className="text-ink">{v.name}</span>.
        </p>
      </div>
    );
  }

  const selectedPlan = plans.find((p) => p.code === v.plan);
  const priceOf = (p: SignupPlan) =>
    p.prices.find((x) => x.currency === v.currency && x.interval === "month")?.amount ?? null;

  return (
    <form onSubmit={onSubmit} className="space-y-8">
      {/* Organization */}
      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold">Your organization</h2>
        <div>
          <Label htmlFor="name">Club, team, school or organization name</Label>
          <Input
            id="name"
            value={v.name}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. Lakeside Volleyball Club"
            maxLength={120}
            required
          />
        </div>
        <div>
          <Label htmlFor="slug">Web address</Label>
          <div className="flex items-center rounded border border-line bg-surface-input focus-within:border-maroon/60">
            <span className="pl-3 text-sm text-ink-3">…/</span>
            <input
              id="slug"
              value={v.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              }}
              maxLength={48}
              required
              className="h-10 flex-1 bg-transparent px-1 text-sm text-ink focus:outline-none"
            />
            <span className="pr-3">
              {slugState.checking ? (
                <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
              ) : slugState.ok === true ? (
                <Check className="h-4 w-4 text-success" />
              ) : slugState.ok === false ? (
                <X className="h-4 w-4 text-danger" />
              ) : null}
            </span>
          </div>
          {slugState.ok === false && slugState.msg && <p className="mt-1 text-xs text-danger">{slugState.msg}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="sport">Sport</Label>
            <select id="sport" className={select} value={v.sport} onChange={(e) => set("sport", e.target.value)}>
              {SPORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="country">Country</Label>
            <select id="country" className={select} value={v.country} onChange={(e) => onCountry(e.target.value)}>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="currency">Currency</Label>
            <select
              id="currency"
              className={select}
              value={v.currency}
              onChange={(e) => set("currency", e.target.value as Currency)}
            >
              {(["CHF", "EUR", "USD"] as const).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="locale">Language</Label>
            <select id="locale" className={select} value={v.locale} onChange={(e) => set("locale", e.target.value)}>
              {LOCALES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Plan */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold">Plan</h2>
          <span className="text-xs text-ink-3">{TRIAL_DAYS}-day free trial · no card needed</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => {
            const price = priceOf(p);
            const active = v.plan === p.code;
            if (p.isCustom) {
              return (
                <a
                  key={p.code}
                  href={`mailto:${salesEmail}?subject=${encodeURIComponent(`${p.name} enquiry`)}`}
                  className="rounded-md border border-line p-4 text-left transition-colors hover:border-[#C19A45]/60"
                >
                  <div className="font-semibold">{p.name}</div>
                  <div className="mt-1 text-xs text-ink-3">{p.tagline}</div>
                  <div className="mt-3 text-sm text-[#C19A45]">Contact sales →</div>
                </a>
              );
            }
            return (
              <button
                type="button"
                key={p.code}
                onClick={() => set("plan", p.code)}
                className={cn(
                  "rounded-md border p-4 text-left transition-colors",
                  active ? "border-maroon bg-maroon-soft" : "border-line hover:border-maroon/50",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{p.name}</span>
                  {active && <Check className="h-4 w-4 text-maroon" />}
                </div>
                <div className="mt-1 text-xs text-ink-3">{p.tagline}</div>
                <div className="mt-3 text-sm">
                  {price !== null ? (
                    <>
                      <span className="tnum text-lg font-semibold">{formatMoney(price, v.currency)}</span>
                      <span className="text-ink-3"> / month</span>
                    </>
                  ) : (
                    <span className="text-ink-3">Not available in {v.currency}</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-ink-3">
                  {p.maxAthletes === null ? "Unlimited athletes" : `Up to ${p.maxAthletes} athletes`}
                </div>
              </button>
            );
          })}
        </div>
        {selectedPlan && (
          <p className="text-xs text-ink-3">
            You start on a free {TRIAL_DAYS}-day trial of {selectedPlan.name}. Pick monthly or yearly billing any time.
          </p>
        )}
      </section>

      {/* You */}
      <section className="space-y-4">
        <h2 className="font-display text-lg font-semibold">You (first administrator)</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="fullName">Your name</Label>
            <Input
              id="fullName"
              value={v.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              autoComplete="name"
              maxLength={120}
              required
            />
          </div>
          <div>
            <Label htmlFor="email">Work email</Label>
            {mode === "email" ? (
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@yourclub.org"
                required
              />
            ) : (
              <Input id="email" value={signedInEmail ?? ""} disabled />
            )}
          </div>
        </div>
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="mt-0.5 accent-[#DA2627]"
          />
          <span>
            I accept the terms of service and the data-processing agreement on behalf of my organization (GDPR / Swiss
            FADP).
          </span>
        </label>
      </section>

      {error && <p className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <Button type="submit" size="lg" className="w-full" disabled={status === "working"}>
        {status === "working"
          ? mode === "email"
            ? "Sending link…"
            : "Creating your workspace…"
          : mode === "email"
            ? "Start free trial"
            : `Create ${v.name || "organization"}`}
      </Button>
    </form>
  );
}
