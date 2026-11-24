"use client";

import * as React from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, CardBody, Input, Label } from "@/components/ui";
import { SITE_URL } from "@/lib/constants";
import { useLocale, useT } from "@/lib/i18n/client";
import { bootstrapAndContinue } from "@/lib/actions/public-entry";
import { completePath, type EntryIntent } from "@/lib/public-entry/shared";

/** Optional password sign-in for staging / demo (same switch as /login). */
const PASSWORD_LOGIN = process.env.NEXT_PUBLIC_AUTH_PASSWORD_LOGIN === "true";

type Choice = "book" | "join";

/**
 * New club customer: name, e-mail and what they want to do. A magic link
 * creates the account (or signs an existing one in); the club slug in the
 * sign-up metadata gives the new account a guest family in this club at
 * creation (handle_new_user), and /join/complete runs the same idempotent
 * bootstrap for existing accounts before returning to the chosen activity.
 */
export function JoinForm({ intent, next, club }: { intent: EntryIntent; next: string | null; club: string }) {
  const t = useT();
  const locale = useLocale();
  const [choice, setChoice] = React.useState<Choice>(intent === "join" ? "join" : "book");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "loading" | "sent">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const effective: EntryIntent = choice === "join" ? "join" : intent === "join" ? "camp" : intent;
  const done = completePath(effective, next, club);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError(t("entry.join.invalid"));
      return;
    }
    setStatus("loading");
    const supabase = createClient();
    if (PASSWORD_LOGIN && password.trim()) {
      const { error: pwError } = await supabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
      if (pwError) { setError(t("auth.passwordError")); setStatus("idle"); return; }
      window.location.assign(done);
      return;
    }
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent(done)}`,
        // Used only when the account is created (handle_new_user): guest family in this club.
        data: { full_name: name.trim(), club_slug: club, locale },
      },
    });
    if (otpError) { setError(t("auth.errorGeneric")); setStatus("idle"); return; }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <Card><CardBody className="flex flex-col items-center gap-3 py-8 text-center" >
        <MailCheck className="h-8 w-8 text-success" aria-hidden />
        <p role="status" className="text-sm text-text">{t("entry.join.sent", { email: email.trim() })}</p>
      </CardBody></Card>
    );
  }

  return (
    <Card><CardBody className="py-5">
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-text">{t("entry.join.choiceLabel")}</legend>
          {(["book", "join"] as const).map((c) => (
            <label key={c} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-3 text-sm text-text has-[:checked]:border-brand-primary">
              <input type="radio" name="join-choice" value={c} checked={choice === c} onChange={() => setChoice(c)}
                className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" />
              <span>
                <span className="block font-medium">{t(`entry.join.choice.${c}.title`)}</span>
                <span className="block text-text-muted">{t(`entry.join.choice.${c}.body`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <Label htmlFor="join-name">{t("entry.join.name")}</Label>
          <Input id="join-name" autoComplete="name" maxLength={140} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="join-email">{t("entry.join.email")}</Label>
          <Input id="join-email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {PASSWORD_LOGIN && (
          <div>
            <Label htmlFor="join-password">{t("entry.join.passwordOptional")}</Label>
            <Input id="join-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" loading={status === "loading"}>{t("entry.join.submit")}</Button>
        <p className="text-center text-sm text-text-muted">
          {t("entry.join.haveAccount")}{" "}
          <Link href={`/login?redirect=${encodeURIComponent(done)}`} className="font-medium text-brand-primary hover:underline">{t("entry.join.signIn")}</Link>
        </p>
      </form>
    </CardBody></Card>
  );
}

/** Already signed in: become a customer of this club and continue. */
export function ContinueAsMember({ email, intent, next, club }: { email: string; intent: EntryIntent; next: string | null; club: string }) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  async function go(choice: EntryIntent) {
    setBusy(true); setError(null);
    const res = await bootstrapAndContinue(choice, next, club);
    // Success redirects on the server; only failures come back.
    setBusy(false);
    if (res && !res.ok) setError(res.error);
  }
  return (
    <Card><CardBody className="space-y-4 py-5">
      <p className="text-sm text-text">{t("entry.join.signedInAs", { email })}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" loading={busy} onClick={() => void go(intent === "join" ? "camp" : intent)}>{t("entry.join.choice.book.title")}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => void go("join")}>{t("entry.join.choice.join.title")}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </CardBody></Card>
  );
}
