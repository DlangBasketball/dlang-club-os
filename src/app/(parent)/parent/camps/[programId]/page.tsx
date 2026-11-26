import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShoppingBasket } from "lucide-react";
import { Button } from "@/components/ui";
import { CampRegister } from "@/components/camps/camp-register";
import { getActiveAthleteState } from "@/lib/participants/my-athletes";
import { preselectAthlete } from "@/lib/participants/active-athlete";
import { CampHero } from "@/components/camps/camp-hero";
import { BasketAdder } from "@/components/camps/basket/basket-adder";
import { getSessionUser } from "@/lib/auth/get-user";
import { getMemberCamp } from "@/lib/camps/data";
import { guardianKids } from "@/lib/camps/parent-kids";
import { getI18n } from "@/lib/i18n/server";
import { getRegistrationConfig } from "@/lib/registration-form/server";
import { getCheckoutPlanOffer } from "@/lib/plans/data";
import { getParticipantChoices } from "@/lib/participants/server";

export default async function ParentCampPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const me = await getSessionUser();
  if (!me?.orgId) redirect("/login");
  if (!/^[0-9a-f-]{36}$/i.test(programId)) notFound();
  const camp = await getMemberCamp(me.orgId, programId);
  if (!camp) notFound();
  const { t } = await getI18n();
  const [kids, choices, state] = await Promise.all([
    guardianKids(me.id, me.orgId), getParticipantChoices({ id: me.id, orgId: me.orgId, fullName: me.fullName }), getActiveAthleteState(),
  ]);
  // The active athlete of the switcher, when it is one of the family's children here.
  const preset = preselectAthlete(state.active, kids.map((k) => k.id));
  const season = camp.program.season;
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <CampHero coverUrl={camp.program.coverUrl} focalX={camp.program.coverFocalX} focalY={camp.program.coverFocalY}
        kicker={season ? t("camps.seasons.label", { season: t(`camps.seasons.names.${season.season}`), year: season.year }) : t("programKind.camp")}
        title={camp.program.name}>
        <p className="text-sm text-ink-2">{t("camps.parent.registerDescription")}</p>
      </CampHero>
      {camp.program.description && <p className="whitespace-pre-wrap text-sm text-ink-2">{camp.program.description}</p>}
      <div className="flex flex-wrap gap-2">
        <Link href="/parent/camps/basket"><Button variant="secondary" size="sm"><ShoppingBasket className="h-4 w-4" /> {t("camps.basket.title")}</Button></Link>
        <Link href="/parent/camps"><Button variant="ghost" size="sm">{t("camps.basket.otherCamps")}</Button></Link>
      </div>
      <BasketAdder mode="parent" scope={`parent:${me.orgId}`} camps={[camp]} kids={kids} basketHref="/parent/camps/basket"
        choices={{ participants: choices.participants.filter((p) => p.kind === "child"), self: choices.self }} presetAthleteId={preset}
        title={t("camps.basket.adder.titleSeveral")} />
      <CampRegister mode="parent" camp={camp} config={await getRegistrationConfig(me.orgId, camp.program.id)}
        planRules={await getCheckoutPlanOffer(me.orgId, "camp", camp.program.currency)} kids={kids}
        participants={choices.participants} self={choices.self} initialAthleteIds={preset ? [preset] : []} />
    </div>
  );
}
