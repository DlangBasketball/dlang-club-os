"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  invalidInput,
  moneyFail,
  moneyT,
  notPermitted,
  requireMoneyStaff,
  revalidateMoney,
  type MoneyResult,
} from "@/lib/money/action-helpers";

/*
 * Training credits: grant, adjust (set a new total) or revoke, always with a
 * reason. Goes through public.adjust_training_credits (admin + finance of the
 * caller's org), which keeps an append-only ledger
 * (training_credit_adjustments), never lets the total drop below the credits
 * already used, and writes a before/after audit row.
 */
const schema = z
  .object({
    athleteId: z.string().uuid(),
    category: z.enum(["personal", "nutrition", "mental"]),
    delta: z.coerce.number().int().min(-1000).max(1000).optional(),
    newTotal: z.coerce.number().int().min(0).max(10000).optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine((v) => (v.delta == null) !== (v.newTotal == null), { path: ["delta"] });
export type CreditAdjustInput = z.input<typeof schema>;

export async function adjustTrainingCredits(input: CreditAdjustInput): Promise<MoneyResult> {
  const t = await moneyT();
  if (!(await requireMoneyStaff())) return notPermitted(t);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "reason") return moneyFail(t, "REASON_REQUIRED");
    if (field === "delta" || field === "newTotal") return moneyFail(t, "INVALID_CREDITS");
    return invalidInput(t);
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("adjust_training_credits", {
    p_athlete: parsed.data.athleteId,
    p_category: parsed.data.category,
    p_delta: parsed.data.delta ?? null,
    p_new_total: parsed.data.newTotal ?? null,
    p_reason: parsed.data.reason,
  });
  if (error) return moneyFail(t, error);
  revalidateMoney();
  return { ok: true, message: t("editMoney.training.saved") };
}
