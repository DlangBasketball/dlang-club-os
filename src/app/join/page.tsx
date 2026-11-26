import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/layout/brand-mark";
import { Card, CardBody } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTenant } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { parseIntent, safeNext, safeSlug } from "@/lib/public-entry/shared";
import { ContinueAsMember, JoinForm } from "./join-form";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const { t } = await getI18n(tenant.id);
  return { title: t("entry.join.metaTitle") };
}

/**
 * Club customer sign-up (NOT the SaaS club sign-up at /signup): "Book a camp
 * / training" or "Join the club". Works without an invitation, team or
 * membership payment: the account gets a guest family in this club
 * (family_bootstrap) and returns to the chosen activity. The club comes from
 * the host (or, on the platform host, the public slug of the page the visitor
 * came from).
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ intent?: string; next?: string; club?: string }> }) {
  const [sp, tenant, me] = await Promise.all([searchParams, getTenant(), getSessionUser()]);
  const { t } = await getI18n(tenant.id);
  const intent = parseIntent(sp.intent);
  const next = safeNext(sp.next ?? null);
  const club = tenant.id ? tenant.slug : safeSlug(sp.club ?? null);

  return (
    <div className="grain min-h-dvh bg-bg">
      <header className="mx-auto flex max-w-xl items-center px-4 py-6"><BrandMark /></header>
      <main className="mx-auto max-w-xl space-y-5 px-4 pb-12">
        <div>
          {tenant.id && <div className="text-xs uppercase tracking-[0.18em] text-brand-primary">{tenant.name}</div>}
          <h1 className="mt-1 font-display text-3xl font-semibold text-text">{t("entry.join.title")}</h1>
          <p className="mt-2 text-sm text-text-muted">{t("entry.join.intro")}</p>
        </div>
        {!club ? (
          <Card><CardBody className="space-y-2 py-5">
            <p className="text-sm text-text">{t("entry.join.noClub")}</p>
            {me && <Link href="/auth/signout" className="text-sm text-brand-primary hover:underline">{t("entry.join.signOut")}</Link>}
          </CardBody></Card>
        ) : me ? (
          <ContinueAsMember email={me.email ?? ""} intent={intent} next={next} club={club} />
        ) : (
          <JoinForm intent={intent} next={next} club={club} />
        )}
        <p className="text-xs text-text-muted">{t("entry.join.privacy")}</p>
      </main>
    </div>
  );
}
