import { notFound } from "next/navigation";
import { CalendarDays, MapPin, Tag } from "lucide-react";
import { getPublicProgram } from "@/lib/data/public-registration";
import { RegisterStepper } from "./register-client";
import { formatCHF, formatDate } from "@/lib/utils";

export default async function PublicProgramPage({ params }: { params: Promise<{ programSlug: string }> }) {
  const { programSlug } = await params;
  const data = await getPublicProgram(programSlug);
  if (!data) notFound();
  const { program, consents, siblingDiscountPct } = data;

  return (
    <div className="animate-fade-up space-y-8">
      <section>
        <div className="text-xs uppercase tracking-[0.18em] text-maroon">{program.kind.replace("_", " ")}</div>
        <h1 className="mt-1 font-display text-3xl font-semibold">{program.name}</h1>
        {program.description && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">{program.description}</p>}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-3">
          <span className="flex items-center gap-1.5"><Tag className="h-4 w-4" />{formatCHF(program.priceChf)} / participant</span>
          {(program.startsOn || program.endsOn) && (
            <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{formatDate(program.startsOn)}{program.endsOn ? ` – ${formatDate(program.endsOn)}` : ""}</span>
          )}
          {program.location && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{program.location}</span>}
          {siblingDiscountPct > 0 && <span className="text-success">{siblingDiscountPct}% sibling discount</span>}
        </div>
      </section>

      <RegisterStepper
        programSlug={program.slug}
        programName={program.name}
        priceChf={program.priceChf}
        siblingDiscountPct={siblingDiscountPct}
        consents={consents}
      />
    </div>
  );
}
