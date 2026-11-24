import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { Badge, Button, Card, CardBody } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTenant } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { entryAdminDb } from "@/lib/public-entry/db";
import { hashConsentToken, isConsentToken } from "@/lib/public-entry/token";
import { ConsentDecision, DeclineOnly } from "./consent-decision";

// The link is a credential: never indexed, never sent on as a referrer.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

type View = {
  found: boolean; status?: "pending" | "accepted" | "declined" | "expired" | "revoked"; expires_at?: string | null;
  club?: { name: string; slug: string }; participant?: { first_name: string; last_name: string };
  booker_name?: string | null; relation?: string; guardian_name?: string;
  verification?: "email" | "family"; email_hint?: string | null;
  items?: { kind: "camp" | "training"; activity: string; edition?: string | null; starts_on?: string; ends_on?: string; starts_at?: string; ends_at?: string }[];
  forms?: { key: string; title: string; version: number; required: boolean; body: string | null }[];
};

/**
 * Guardian consent for a booking made by another adult (Workstream B). The
 * holder of the e-mailed link sees the club, the activity and dates, who
 * booked, and the consent forms; they accept (signed in with the e-mail the
 * link was sent to, or as the child's existing guardian) or decline (no
 * account needed). Never shows the child's DOB, medical data or the booker's
 * contact details.
 */
export default async function ConsentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [tenant, me] = await Promise.all([getTenant(), getSessionUser()]);
  const { t, f } = await getI18n(tenant.id);
  let view: View = { found: false };
  if (isConsentToken(token)) {
    // The link token is the credential: the server hashes it and reads the
    // whitelisted view with the service role (no anon EXECUTE on the RPC).
    const { data } = await entryAdminDb().rpc("guardian_consent_view", { p_token_hash: hashConsentToken(token) });
    view = ((data ?? { found: false }) as View);
  }
  const self = `/consent/${encodeURIComponent(token)}`;

  return (
    <div className="grain min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-2xl items-center px-4 py-6"><BrandMark /></header>
      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-12">
        {!view.found ? (
          <Card><CardBody className="py-6 text-sm text-text">{t("consentRequest.page.notFound")}</CardBody></Card>
        ) : (
          <>
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-brand-primary">{view.club?.name}</div>
              <h1 className="mt-1 font-display text-3xl font-semibold text-text">
                {t("consentRequest.page.title", { child: view.participant?.first_name ?? "" })}
              </h1>
              <p className="mt-2 text-sm text-text-muted">
                {t("consentRequest.page.intro", {
                  booker: view.booker_name || t("consentRequest.email.someone"),
                  child: `${view.participant?.first_name ?? ""} ${view.participant?.last_name ?? ""}`.trim(),
                  relation: t.dynamic(`participants.bookerRelations.${view.relation ?? "other"}`, undefined, ""),
                })}
              </p>
            </div>

            <Card><CardBody className="space-y-3 py-5">
              <h2 className="text-sm font-semibold text-text">{t("consentRequest.page.activities")}</h2>
              <ul className="space-y-2">
                {(view.items ?? []).map((it, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-text">
                    <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden />
                    <span>
                      <span className="font-medium">{it.activity}</span>
                      {it.edition ? ` · ${it.edition}` : ""}
                      <span className="block text-text-muted">
                        {it.starts_on && it.ends_on ? f.dateRange(it.starts_on, it.ends_on) : it.starts_at ? f.dateTime(it.starts_at) : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {view.status === "pending" && view.expires_at && (
                <p className="text-xs text-text-muted">{t("consentRequest.page.expires", { when: f.dateTime(view.expires_at) })}</p>
              )}
            </CardBody></Card>

            {view.status !== "pending" ? (
              <Card><CardBody className="flex items-center gap-2 py-5 text-sm text-text">
                <Badge tone={view.status === "accepted" ? "success" : "neutral"}>{t.dynamic(`consentRequest.status.${view.status}`, undefined, view.status ?? "")}</Badge>
                {t.dynamic(`consentRequest.page.done.${view.status}`, undefined, "")}
                {view.status === "accepted" && me && (
                  <Link href="/parent/children" className="ml-auto"><Button size="sm" variant="secondary">{t("consentRequest.page.openApp")}</Button></Link>
                )}
              </CardBody></Card>
            ) : (
              <Card><CardBody className="space-y-4 py-5">
                <div className="flex items-start gap-2 text-sm text-text">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
                  <p>{view.verification === "family"
                    ? t("consentRequest.page.verifyFamily", { child: view.participant?.first_name ?? "" })
                    : t("consentRequest.page.verifyEmail", { email: view.email_hint ?? "" })}</p>
                </div>
                {me ? (
                  <ConsentDecision token={token} forms={view.forms ?? []} signedInAs={me.email ?? ""} />
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/login?redirect=${encodeURIComponent(self)}`}><Button>{t("consentRequest.page.signInToAccept")}</Button></Link>
                    </div>
                    <p className="text-xs text-text-muted">{t("consentRequest.page.signInHint")}</p>
                    <DeclineOnly token={token} />
                  </div>
                )}
              </CardBody></Card>
            )}
            <p className="text-xs text-text-muted">{t("consentRequest.page.privacy")}</p>
          </>
        )}
      </main>
    </div>
  );
}
