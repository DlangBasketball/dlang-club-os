import { nextStep, type NextStep } from "@/lib/status/next-step";

/** Shape of my_athletes() rows needed here (kept structural so tests need no server module). */
type AthleteActivity = {
  programmes: { name: string; status: string; balance: number | null }[];
  memberships: { name: string; status: string; balance: number | null }[];
  requests: { name: string | null; status: "pending" | "info_requested" }[];
};

export type AthleteStep = { step: NextStep; label: string };

/**
 * Open next steps of one athlete for the My Athletes list: club requests
 * (pending / information requested), programme registrations (camp approval,
 * waitlist, awaiting payment / confirmation) and memberships awaiting payment.
 * Confirmed items are not listed. Derived on read with nextStep(); one entry
 * per (step, activity), the most urgent first.
 */
export function athleteNextSteps(a: AthleteActivity): AthleteStep[] {
  const out: AthleteStep[] = [];
  for (const q of a.requests) out.push({ step: nextStep({ clubApproval: q.status }), label: q.name ?? "" });
  for (const p of a.programmes) out.push({ step: nextStep({ status: p.status, balance: p.balance }), label: p.name });
  for (const m of a.memberships) out.push({ step: nextStep({ status: m.status, balance: m.balance }), label: m.name });
  const seen = new Set<string>();
  const order = (s: NextStep) => ["declined", "cancelled", "awaiting_guardian_consent", "information_requested", "pending_club_approval",
    "pending_camp_approval", "awaiting_confirmation", "waitlisted", "awaiting_payment", "confirmed"].indexOf(s);
  return out
    .filter((s) => s.step !== "confirmed" && s.step !== "cancelled")
    .filter((s) => { const k = `${s.step}|${s.label}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => order(x.step) - order(y.step));
}
