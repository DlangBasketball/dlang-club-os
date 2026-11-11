"use client";

import * as React from "react";
import { completeOnboarding } from "@/lib/auth/onboarding";
import { Card, CardBody, Button, Input, Label } from "@/components/ui";
import { CheckCircle2 } from "lucide-react";

export function OnboardingForm({
  defaultName,
  email,
}: {
  defaultName: string;
  email: string;
}) {
  const [fullName, setFullName] = React.useState(defaultName);
  const [phone, setPhone] = React.useState("");
  const [accept, setAccept] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    // Server action redirects to /parent/home on success.
    await completeOnboarding({ fullName, phone, locale: "en", acceptConsents: accept });
    setPending(false);
  }

  return (
    <Card>
      <CardBody className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Welcome to DLang Basketball</h1>
          <p className="mt-1 text-sm text-ink-2">
            You&apos;ve been invited as a parent. Confirm your details to finish
            setting up your account.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} disabled className="opacity-60" />
          </div>
          <div>
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+41 …" />
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface-elevated p-3 text-sm">
            <input
              type="checkbox"
              checked={accept}
              onChange={(e) => setAccept(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]"
            />
            <span className="text-ink-2">
              I accept the required club consents (media, transport, health
              declaration, terms) for my child(ren).
            </span>
          </label>

          <Button type="submit" className="w-full" disabled={!accept || pending}>
            {pending ? "Finishing…" : (<><CheckCircle2 className="h-4 w-4" /> Complete setup</>)}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
