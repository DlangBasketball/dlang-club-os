import Link from "next/link";
import { ChevronRight, Dumbbell, IdCard, LogIn, Tent, UserPlus } from "lucide-react";
import { buttonVariants } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Translator } from "@/lib/i18n/translator";
import { completePath, joinHref, MEMBERSHIP_REQUEST_PATH, type EntryIntent } from "@/lib/public-entry/shared";

/** Public booking path for personal training (the club hub's training CTA). */
const TRAINING_PATH = "/book";

/**
 * Welcome-screen entry points for new customers: Book a camp, Book personal
 * training, Join the club. Camps and training can be browsed publicly first;
 * "Join the club" creates an account and leads to the membership request.
 * Signed-in visitors go straight to the parent app.
 */
export function EntryPoints({ t, signedIn }: { t: Translator; signedIn: boolean }) {
  const items: { key: EntryIntent; icon: typeof Tent; href: string }[] = [
    { key: "camp", icon: Tent, href: signedIn ? "/parent/camps" : "/register/camps" },
    { key: "training", icon: Dumbbell, href: signedIn ? "/parent/bookings/request" : TRAINING_PATH },
    { key: "join", icon: IdCard, href: signedIn ? MEMBERSHIP_REQUEST_PATH : joinHref("join") },
  ];
  return (
    <section aria-labelledby="entry-title" className="space-y-4">
      <h2 id="entry-title" className="font-display text-xl font-semibold">{t("entry.hub.title")}</h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {items.map(({ key, icon: Icon, href }) => (
          <li key={key}>
            <Link href={href}
              className="group flex h-full flex-col rounded-md border border-border bg-surface p-5 shadow-sm transition hover:border-brand-primary/60 active:scale-[0.99]">
              <Icon className="h-6 w-6 text-brand-primary" aria-hidden />
              <span className="mt-3 font-display text-lg font-semibold">{t(`entry.hub.${key}.title`)}</span>
              <span className="mt-1 text-sm text-text-muted">{t(`entry.hub.${key}.body`)}</span>
              <span className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium text-brand-primary">
                {t(`entry.hub.${key}.cta`)}
                <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!signedIn && (
        <p className="text-sm text-text-muted">
          {t("entry.hub.newHere")}{" "}
          <Link href={joinHref("camp")} className="font-medium text-brand-primary hover:underline">{t("entry.hub.createAccount")}</Link>
        </p>
      )}
    </section>
  );
}

/**
 * On a public activity page: "Book in the app" — sign in or create a free
 * account and come back to this activity (safe same-origin `next`).
 */
export function AppBookingCallout({ t, intent, next, club }: { t: Translator; intent: EntryIntent; next: string; club: string | null }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium text-text">{t("entry.callout.title")}</p>
        <p className="text-sm text-text-muted">{t("entry.callout.body")}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Link href={joinHref(intent, next)} className={cn(buttonVariants({ variant: "primary", size: "sm" }))}>
          <UserPlus className="h-4 w-4" aria-hidden /> {t("entry.callout.create")}
        </Link>
        <Link href={`/login?redirect=${encodeURIComponent(completePath(intent, next, club))}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          <LogIn className="h-4 w-4" aria-hidden /> {t("entry.callout.signIn")}
        </Link>
      </div>
    </div>
  );
}
