import Link from "next/link";
import { ChevronRight, UserCircle } from "lucide-react";
import { Avatar, Badge, Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { NextStepBadge } from "@/components/approvals/next-step-badge";
import { AddParticipantButton } from "@/components/participants/add-participant-dialog";
import { AddMyselfButton } from "@/components/participants/add-myself-button";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { isCustomTerm, myAthletesLabel, term } from "@/lib/tenant/terms";
import { photoUrlsForAthletes } from "@/lib/people/server";
import { getParticipantChoices } from "@/lib/participants/server";
import { getActiveAthleteState, type MyAthlete } from "@/lib/participants/my-athletes";
import { athleteNextSteps } from "@/lib/participants/next-steps";
import { isAdultOn } from "@/lib/participants/validation";
import { todayIn } from "@/lib/payments/plans";

export async function generateMetadata() {
  const [{ t }, tenant] = await Promise.all([getI18n(), getTenant()]);
  return { title: myAthletesLabel(tenant.terminology, t("myAthletes.title"), (term) => t("myAthletes.titleTerm", { term })) };
}

/**
 * My Athletes (parent app): the adult's own self profile and every child they
 * are guardian of in this club, with age, active teams / programmes, the next
 * step of anything pending, and "Add athlete" (a child, or "Myself" for an
 * adult). Data: my_athletes() — the caller's own athletes only.
 */
export default async function MyAthletesPage() {
  const [me, { t, f }, tenant, state] = await Promise.all([getSessionUser(), getI18n(), getTenant(), getActiveAthleteState()]);
  const title = myAthletesLabel(tenant.terminology, t("myAthletes.title"), (term) => t("myAthletes.titleTerm", { term }));
  const athletes = state.athletes;
  const today = todayIn(f.timeZone);
  const [photos, choices] = await Promise.all([
    photoUrlsForAthletes(athletes.map((a) => a.id)),
    me?.orgId ? getParticipantChoices({ id: me.id, orgId: me.orgId, fullName: me.fullName ?? null }) : Promise.resolve(null),
  ]);
  const hasSelf = athletes.some((a) => a.kind === "self");
  // "Add myself" for adults only (18+ today); without a known DOB the form asks and the database checks.
  const canAddSelf = !!choices && !hasSelf && (!choices.self.dob || isAdultOn(choices.self.dob, today));

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader title={title} description={t("myAthletes.description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <AddParticipantButton variant="primary" label={isCustomTerm(tenant.terminology, "athlete") ? t("myAthletes.addChildTerm", { term: term(tenant.terminology, "athlete") }) : t("myAthletes.addChild")} />
            {canAddSelf && choices && <AddMyselfButton self={choices.self} today={today} />}
          </div>
        } />
      {athletes.length === 0 ? (
        <EmptyState icon={<UserCircle className="h-5 w-5" />} title={t("myAthletes.emptyTitle")} description={t("myAthletes.emptyHint")} />
      ) : (
        <ul className="space-y-2">
          {athletes.map((a) => <AthleteRow key={a.id} a={a} photo={photos[a.id] ?? null} active={state.active === a.id} t={t} f={f} />)}
        </ul>
      )}
    </div>
  );
}

function AthleteRow({ a, photo, active, t, f }: {
  a: MyAthlete; photo: string | null; active: boolean;
  t: Awaited<ReturnType<typeof getI18n>>["t"]; f: Awaited<ReturnType<typeof getI18n>>["f"];
}) {
  const steps = athleteNextSteps(a);
  return (
    <li>
      <Link href={`/parent/children/${a.id}`} aria-current={active ? "true" : undefined}>
        <Card className={active ? "border-brand-primary/50 transition hover:border-maroon/40" : "transition active:scale-[0.99] hover:border-maroon/40"}>
          <CardBody className="flex items-start gap-3">
            <Avatar name={a.name} src={photo} size="lg" className="h-11 w-11" />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{a.name}</span>
                {a.kind === "self" && <Badge tone="accent">{t("myAthletes.myself")}</Badge>}
                {a.kind === "linked" && <Badge tone="info">{t("myAthletes.linkedBadge", { relation: t.dynamic(`participants.childLinks.relations.${a.link?.relation ?? "other_carer"}`, undefined, a.link?.relation ?? "") })}</Badge>}
                {active && <Badge tone="info">{t("myAthletes.activeBadge")}</Badge>}
                {a.status === "inactive" && <Badge tone="neutral">{t("status.inactive")}</Badge>}
              </div>
              <div className="text-xs text-ink-3">
                {a.age !== null ? t("participants.children.age", { age: f.number(a.age) }) : "—"}
                {a.teams.length > 0 && <> · {a.teams.map((tm) => tm.jerseyNumber != null ? t("myAthletes.teamWithNumber", { team: tm.name, number: tm.jerseyNumber }) : tm.name).join(", ")}</>}
              </div>
              {a.programmes.length > 0 && (
                <div className="text-xs text-ink-3">{t("myAthletes.programmes", { names: Array.from(new Set(a.programmes.map((p) => p.name))).join(", ") })}</div>
              )}
              {a.teams.length === 0 && a.programmes.length === 0 && <div className="text-xs text-ink-4">{t("myAthletes.noActivity")}</div>}
              {(steps.length > 0 || a.pendingCorrections > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {steps.map((s) => (
                    <span key={`${s.step}-${s.label}`} className="inline-flex items-center gap-1 text-xs text-ink-3">
                      <NextStepBadge step={s.step} t={t} /> {s.label}
                    </span>
                  ))}
                  {a.pendingCorrections > 0 && <Badge tone="info">{t("myAthletes.correctionPending")}</Badge>}
                </div>
              )}
            </div>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-4" aria-hidden />
          </CardBody>
        </Card>
      </Link>
    </li>
  );
}
