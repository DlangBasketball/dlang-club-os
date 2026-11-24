import { Badge } from "@/components/ui";
import { PROPOSAL_SPORTS_FIELDS, type ClubRequestProfile } from "@/lib/approvals/types";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";

type Field = (typeof PROPOSAL_SPORTS_FIELDS)[number] | "dob" | "gender";

function value(field: Field, v: unknown, t: Translator, f: Formatter): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "dob" && typeof v === "string") return f.date(v);
  if (field === "gender" && typeof v === "string") return t.dynamic(`participants.sex.${v.toLowerCase()}`, undefined, v);
  if (field === "height_cm") return t("myAthletes.units.cm", { value: f.number(Number(v)) });
  if (field === "weight_kg") return t("myAthletes.units.kg", { value: f.number(Number(v)) });
  if (field === "preferred_jersey_number") return f.number(Number(v));
  if (field === "position_pref" && typeof v === "string") return t.dynamic(`participants.positions.${v}`, undefined, v);
  return String(v);
}

/**
 * Current vs proposed profile details of a club request (reviewer + family).
 * The RPC already removed DOB / sex for coaches. After a decision: what was
 * applied, the roster number outcome, the DOB / sex review.
 */
export function ProposedProfile({ profile, t, f }: { profile: ClubRequestProfile | null | undefined; t: Translator; f: Formatter }) {
  if (!profile) return null;
  const sports = profile.proposed.sports ?? {};
  const elig = profile.proposed.eligibility ?? {};
  const rows: { field: Field; current: unknown; proposed: unknown }[] = [
    ...PROPOSAL_SPORTS_FIELDS.filter((k) => k in sports).map((k) => ({ field: k as Field, current: profile.current[k], proposed: sports[k] })),
    ...(["dob", "gender"] as const).filter((k) => k in elig).map((k) => ({ field: k as Field, current: profile.current[k], proposed: elig[k] })),
  ];
  if (!rows.length) return null;
  const o = profile.outcome;
  const jersey = o?.jersey ?? null;
  return (
    <section className="space-y-2 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t("myAthletes.proposal.title")}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs text-text-muted">
              <th scope="col" className="py-1 pe-3 font-medium">{t("myAthletes.proposal.field")}</th>
              <th scope="col" className="py-1 pe-3 font-medium">{t("myAthletes.proposal.current")}</th>
              <th scope="col" className="py-1 font-medium">{t("myAthletes.proposal.proposed")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.field} className="border-t border-border-soft">
                <th scope="row" className="py-1 pe-3 font-normal text-text-secondary">{t(`myAthletes.fields.${r.field}`)}</th>
                <td className="py-1 pe-3 text-text-muted">{value(r.field, r.current, t, f)}</td>
                <td className="py-1 font-medium text-text">{value(r.field, r.proposed, t, f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!o && <p className="text-xs text-text-muted">{t("myAthletes.proposal.pendingNote")}</p>}
      {o?.status === "declined" && <Badge tone="neutral">{t("myAthletes.proposal.notApplied")}</Badge>}
      {o?.status === "approved" && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge tone="success">{t("myAthletes.proposal.appliedBadge")}</Badge>
          {jersey?.status === "taken" && <Badge tone="warning">{t("myAthletes.proposal.jerseyTaken", { number: jersey.number })}</Badge>}
          {jersey?.status === "assigned" && <Badge tone="success">{t("myAthletes.proposal.jerseyAssigned", { number: jersey.number })}</Badge>}
          {jersey?.status === "reserved" && <Badge tone="info">{t("myAthletes.proposal.jerseyReserved", { number: jersey.number })}</Badge>}
          {o.eligibility?.status === "review_pending" && <Badge tone="info">{t("myAthletes.proposal.eligibilityReview")}</Badge>}
        </div>
      )}
    </section>
  );
}
