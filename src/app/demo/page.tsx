import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, Minus, RotateCcw, ShieldCheck } from "lucide-react";
import { PLATFORM_NAME } from "@/lib/brand";
import { getFormatter, getTranslations } from "@/lib/i18n/server";
import { DEMO_PERSONAS, DEMO_ROLES, demoEnabled, demoWalkthroughUrl } from "@/lib/demo/config";
import { currentDemoSession } from "@/lib/demo/sandbox";
import { DEMO_PLAN_FEATURES, getDemoPlans } from "@/lib/demo/plans";
import { Button, Card } from "@/components/ui";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  if (!demoEnabled()) return {};
  const t = await getTranslations();
  return { title: t("demo.meta.title"), robots: { index: false, follow: false } };
}

const ERRORS = ["busy", "failed", "expired", "role"] as const;

/**
 * Prospect demo page (staging only, DEMO_SANDBOX_ENABLED=true). Five role
 * entry points into the prospect's own fictional club, a reset, the plan
 * comparison and the walkthrough booking link. docs/demo/PROSPECT_DEMO.md.
 */
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  if (!demoEnabled()) notFound();
  const sp = await searchParams;
  const [t, f, session, plans] = await Promise.all([getTranslations(), getFormatter(), currentDemoSession(), getDemoPlans()]);
  const walkthrough = demoWalkthroughUrl();
  const error = ERRORS.find((e) => e === sp.error);
  const product = PLATFORM_NAME;

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
        <header className="flex flex-col gap-4">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-brand-primary">{t("demo.hero.eyebrow")}</p>
          <h1 className="max-w-3xl font-display text-3xl leading-tight sm:text-5xl">{t("demo.hero.title", { product })}</h1>
          <p className="max-w-3xl text-base text-text-muted sm:text-lg">{t("demo.hero.lead")}</p>
        </header>

        {(error || sp.reset) && (
          <div
            role="status"
            className={
              error
                ? "rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm"
                : "rounded-md border border-success bg-success-soft px-4 py-3 text-sm"
            }
          >
            {error ? t(`demo.errors.${error}`) : t("demo.reset.done")}
          </div>
        )}

        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t("demo.path.title")}</p>
            <ol className="list-decimal space-y-0.5 pl-5 text-sm text-text-muted">
              <li>{t("demo.path.one")}</li>
              <li>{t("demo.path.two")}</li>
              <li>{t("demo.path.three")}</li>
            </ol>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <p className="text-sm text-text-muted">
              {session
                ? `${t("demo.session.active")} ${t("demo.session.expires", { time: f.dateTime(session.sandbox.expires_at, "short") })}`
                : t("demo.session.none")}
            </p>
            {session && (
              <form action="/demo/reset" method="post" className="flex flex-col gap-1 sm:items-end">
                <Button type="submit" variant="secondary" size="sm">
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  {t("demo.reset.button")}
                </Button>
                <span className="text-xs text-text-muted">{t("demo.reset.hint")}</span>
              </form>
            )}
          </div>
        </Card>

        <section aria-labelledby="demo-roles" className="flex flex-col gap-4">
          <h2 id="demo-roles" className="sr-only">{t("demo.startHere")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {DEMO_ROLES.map((role) => (
              <Card key={role} className="flex flex-col gap-3 p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-text-muted">{t(`demo.roles.${role}.title`)}</p>
                  <p className="font-display text-xl">{DEMO_PERSONAS[role] ?? t(`demo.roles.${role}.title`)}</p>
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-primary">{t("demo.startHere")}</p>
                  <p>{t(`demo.roles.${role}.start`)}</p>
                  <p className="text-text-muted">{t(`demo.roles.${role}.tasks`)}</p>
                </div>
                <form action="/demo/enter" method="post" className="mt-auto">
                  <input type="hidden" name="role" value={role} />
                  <Button type="submit" className="w-full" variant={role === "parent" ? "primary" : "secondary"}>
                    {t(`demo.roles.${role}.button`)}
                  </Button>
                </form>
              </Card>
            ))}
          </div>
        </section>

        <Card className="p-5">
          <p className="mb-2 flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
            {t("demo.safety.title")}
          </p>
          <ul className="grid gap-1 text-sm text-text-muted sm:grid-cols-2">
            <li>{t("demo.safety.people")}</li>
            <li>{t("demo.safety.messages")}</li>
            <li>{t("demo.safety.payments")}</li>
            <li>{t("demo.safety.isolation")}</li>
          </ul>
        </Card>

        <section aria-labelledby="demo-plans" className="flex flex-col gap-3">
          <div>
            <h2 id="demo-plans" className="font-display text-2xl">{t("demo.plans.title")}</h2>
            <p className="text-sm text-text-muted">{t("demo.plans.lead")}</p>
          </div>
          {plans.length === 0 ? (
            <p className="text-sm text-text-muted">{t("demo.plans.unavailable")}</p>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th scope="col" className="px-4 py-3 font-medium text-text-muted">{t("demo.plans.module")}</th>
                    {plans.map((p) => (
                      <th key={p.code} scope="col" className="px-4 py-3 font-semibold">{t(`demo.plans.names.${p.code}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border-soft">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">{t("demo.plans.athletes")}</th>
                    {plans.map((p) => (
                      <td key={p.code} className="px-4 py-2.5">{p.maxAthletes == null ? t("demo.plans.negotiated") : f.number(p.maxAthletes)}</td>
                    ))}
                  </tr>
                  <tr className="border-b border-border-soft">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">{t("demo.plans.staff")}</th>
                    {plans.map((p) => (
                      <td key={p.code} className="px-4 py-2.5">{p.maxStaff == null ? t("demo.plans.negotiated") : f.number(p.maxStaff)}</td>
                    ))}
                  </tr>
                  {DEMO_PLAN_FEATURES.map((key) => (
                    <tr key={key} className="border-b border-border-soft last:border-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal">{t(`upgrades.features.${key}.name`)}</th>
                      {plans.map((p) => (
                        <td key={p.code} className="px-4 py-2.5">
                          {p.features[key] ? (
                            <Check className="h-4 w-4 text-success" aria-label={t("demo.plans.included")} />
                          ) : (
                            <Minus className="h-4 w-4 text-text-muted" aria-label={t("demo.plans.notIncluded")} />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </section>

        <Card className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-2xl">{t("demo.cta.title")}</p>
            <p className="text-sm text-text-muted">{t("demo.cta.lead", { product })}</p>
          </div>
          {walkthrough ? (
            <a
              href={walkthrough}
              target="_blank"
              rel="noopener noreferrer"
              className="touch-target inline-flex h-12 items-center justify-center rounded border border-brand-primary bg-brand-primary px-6 text-[15px] font-medium text-on-brand hover:bg-brand-primary-dark"
            >
              {t("demo.cta.button")}
            </a>
          ) : (
            <p role="alert" className="max-w-sm rounded-md border border-warning bg-warning-soft px-3 py-2 text-xs">
              {t("demo.cta.missing")}
            </p>
          )}
        </Card>
      </div>
    </main>
  );
}
