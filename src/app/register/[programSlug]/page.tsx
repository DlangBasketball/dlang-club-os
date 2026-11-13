import { notFound } from "next/navigation";
import { CalendarDays, MapPin, Tag } from "lucide-react";
import { getPublicProgram } from "@/lib/data/public-registration";
import { RegisterStepper } from "./register-client";
import { getI18n } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { getPublicCamp } from "@/lib/camps/data";
import { CampRegister } from "@/components/camps/camp-register";
import { getTenant, orgMatchesTenant } from "@/lib/tenant/server";
import { getRegistrationConfig } from "@/lib/registration-form/server";

export default async function PublicProgramPage({ params }: { params: Promise<{ programSlug: string }> }) {
  const { programSlug } = await params;
  // Camps with editions: editions, age groups, price options, guest sign-up.
  const camp = await getPublicCamp(programSlug);
  if (camp && camp.editions.length + camp.options.length > 0) {
    if (!orgMatchesTenant(camp.program.orgId, await getTenant())) notFound();
    const i18n = await getI18n(camp.program.orgId);
    return (
      <div className="animate-fade-up space-y-8">
        <section>
          <div className="text-xs uppercase tracking-[0.18em] text-maroon">{i18n.t("programKind.camp")}</div>
          <h1 className="mt-1 font-display text-3xl font-semibold">{camp.program.name}</h1>
          {camp.program.description && <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{camp.program.description}</p>}
        </section>
        <I18nProvider ctx={i18n.ctx} messages={i18n.messages}>
          <CampRegister mode="public" camp={camp} slug={programSlug} config={await getRegistrationConfig(camp.program.orgId, camp.program.id)} />
        </I18nProvider>
      </div>
    );
  }
  const data = await getPublicProgram(programSlug);
  if (!data) notFound();
  const { program, consents, siblingDiscountPct } = data;
  // Public page: no user, so localise with the club's own defaults (language, currency, time zone).
  const [{ t, f, ctx, messages }, config] = await Promise.all([getI18n(program.orgId), getRegistrationConfig(program.orgId, program.id)]);

  return (
    <div className="animate-fade-up space-y-8">
      <section>
        <div className="text-xs uppercase tracking-[0.18em] text-maroon">{t.dynamic(`programKind.${program.kind}`, undefined, program.kind.replace("_", " "))}</div>
        <h1 className="mt-1 font-display text-3xl font-semibold">{program.name}</h1>
        {program.description && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">{program.description}</p>}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-3">
          <span className="flex items-center gap-1.5"><Tag className="h-4 w-4" />{t("common.perParticipant", { price: f.money(program.priceChf) })}</span>
          {(program.startsOn || program.endsOn) && (
            <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{program.endsOn ? f.dateRange(program.startsOn ?? program.endsOn, program.endsOn) : f.date(program.startsOn)}</span>
          )}
          {program.location && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{program.location}</span>}
          {siblingDiscountPct > 0 && <span className="text-success">{t("registration.siblingDiscount", { pct: siblingDiscountPct })}</span>}
        </div>
      </section>

      <I18nProvider ctx={ctx} messages={messages}>
        <RegisterStepper
          programSlug={program.slug}
          programName={program.name}
          priceChf={program.priceChf}
          siblingDiscountPct={siblingDiscountPct}
          consents={consents}
          config={config}
        />
      </I18nProvider>
    </div>
  );
}
