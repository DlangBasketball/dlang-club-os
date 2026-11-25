import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, UserRound } from "lucide-react";
import { BrandMark } from "@/components/layout/brand-mark";
import { Badge, Button, Card, CardBody } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTenant } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { participantsAdminDb } from "@/lib/participants/db";
import { isInviteToken } from "@/lib/participants/validation";
import { hashConsentToken } from "@/lib/public-entry/token";
import { AcceptInvite } from "./accept-invite";

// The link is a credential: never indexed, never sent on as a referrer.
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

type View = {
  found: boolean; status?: "pending" | "accepted" | "revoked" | "expired"; expires_at?: string;
  club?: { name: string; slug: string }; child_first_name?: string; relation?: string; inviter_name?: string | null;
  permissions?: Record<string, boolean>; email_hint?: string; accepted_by_me?: boolean;
};

const PERMS: [string, string][] = [
  ["can_register", "canRegister"], ["can_pay", "canPay"], ["receives_emails", "receivesEmails"],
  ["can_see_medical", "canSeeMedical"], ["can_edit_profile", "canEditProfile"], ["can_consent", "canConsent"],
];

/**
 * Invitation of a relative / friend for ONE child. The holder of the e-mailed
 * link sees the club, the child's first name, the relation, who invited them
 * and what they would be allowed to do; they accept signed in with the e-mail
 * the link was sent to (new visitors create an account through /join and come
 * back here). Never shows the child's last name, DOB, family or medical data.
 */
export default async function LinkInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [tenant, me] = await Promise.all([getTenant(), getSessionUser()]);
  const { t, f } = await getI18n(tenant.id);
  let view: View = { found: false };
  if (isInviteToken(token)) {
    // The server hashes the link token and reads the whitelisted view with the service role.
    const { data } = await participantsAdminDb().rpc("athlete_link_invite_view", { p_token_hash: hashConsentToken(token) });
    view = (data ?? { found: false }) as View;
  }
  const self = `/link-invite/${encodeURIComponent(token)}`;
  const child = view.child_first_name ?? "";
  const granted = PERMS.filter(([k]) => view.permissions?.[k]);

  return (
    <div className="grain min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-2xl items-center px-4 py-6"><BrandMark /></header>
      <main className="mx-auto max-w-2xl space-y-5 px-4 pb-12">
        {!view.found ? (
          <Card><CardBody className="py-6 text-sm text-text">{t("participants.invite.page.notFound")}</CardBody></Card>
        ) : (
          <>
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-brand-primary">{view.club?.name}</div>
              <h1 className="mt-1 font-display text-3xl font-semibold text-text">{t("participants.invite.page.title", { child })}</h1>
              <p className="mt-2 text-sm text-text-muted">
                {t("participants.invite.page.intro", {
                  inviter: view.inviter_name || t("consentRequest.email.someone"),
                  child,
                  relation: t.dynamic(`participants.childLinks.relations.${view.relation ?? "other_carer"}`, undefined, ""),
                })}
              </p>
            </div>

            <Card><CardBody className="space-y-3 py-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
                <UserRound className="h-4 w-4 text-brand-primary" aria-hidden /> {t("participants.invite.page.permissions", { child })}
              </h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-text">
                {granted.length
                  ? granted.map(([k, key]) => <li key={k}>{t.dynamic(`participants.childLinks.perm.${key}`, undefined, key)}</li>)
                  : <li>{t("participants.childLinks.viewOnly")}</li>}
              </ul>
              <p className="text-xs text-text-muted">{t("participants.invite.page.scope", { child })}</p>
              {view.status === "pending" && view.expires_at && (
                <p className="text-xs text-text-muted">{t("participants.invite.page.expires", { when: f.dateTime(view.expires_at) })}</p>
              )}
            </CardBody></Card>

            {view.status !== "pending" ? (
              <Card><CardBody className="flex flex-wrap items-center gap-2 py-5 text-sm text-text">
                <Badge tone={view.status === "accepted" ? "success" : "neutral"}>
                  {t.dynamic(`participants.invite.status.${view.status}`, undefined, view.status ?? "")}
                </Badge>
                {t.dynamic(`participants.invite.page.done.${view.status}`, undefined, "")}
                {view.status === "accepted" && view.accepted_by_me && (
                  <Link href="/parent/athletes" className="ml-auto"><Button size="sm" variant="secondary">{t("participants.invite.page.openApp")}</Button></Link>
                )}
              </CardBody></Card>
            ) : (
              <Card><CardBody className="space-y-4 py-5">
                <div className="flex items-start gap-2 text-sm text-text">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
                  <p>{t("participants.invite.page.verifyEmail", { email: view.email_hint ?? "" })}</p>
                </div>
                {me ? (
                  <AcceptInvite token={token} signedInAs={me.email ?? ""} />
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/join?next=${encodeURIComponent(self)}${view.club?.slug ? `&club=${encodeURIComponent(view.club.slug)}` : ""}`}>
                        <Button>{t("participants.invite.page.createAccount")}</Button>
                      </Link>
                      <Link href={`/login?redirect=${encodeURIComponent(self)}`}>
                        <Button variant="secondary">{t("participants.invite.page.signIn")}</Button>
                      </Link>
                    </div>
                    <p className="text-xs text-text-muted">{t("participants.invite.page.signInHint")}</p>
                  </div>
                )}
              </CardBody></Card>
            )}
            <p className="text-xs text-text-muted">{t("participants.invite.page.privacy")}</p>
          </>
        )}
      </main>
    </div>
  );
}
