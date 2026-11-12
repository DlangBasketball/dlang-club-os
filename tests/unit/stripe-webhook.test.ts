import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// Records every RPC the webhook makes through the service-role client.
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "claim_stripe_event") return { data: true, error: null };
      return { data: null, error: null };
    },
    from: () => ({ insert: async () => ({ error: null }) }),
  }),
}));
vi.mock("@/lib/stripe-connect", () => ({ syncAccount: async () => null }));

const { handleStripeEvent } = await import("@/lib/payments/stripe-webhook");

const evt = (type: string, object: unknown): Stripe.Event =>
  ({ id: `evt_${type}`, type, account: "acct_club", livemode: false, data: { object } }) as unknown as Stripe.Event;

const refund = (status: string, id = "re_1") =>
  ({ id, status, amount: 50000, currency: "eur", payment_intent: "pi_1" }) as unknown as Stripe.Refund;

const stripeWith = (refunds: Stripe.Refund[]) =>
  ({ refunds: { list: async () => ({ data: refunds }) } }) as unknown as Stripe;

const business = () => calls.filter((c) => c.fn !== "claim_stripe_event" && c.fn !== "finish_stripe_event");

describe("Stripe webhook: refunds and disputes", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("does not record a pending SEPA/ACH refund on charge.refunded", async () => {
    const out = await handleStripeEvent(stripeWith([refund("pending")]), evt("charge.refunded", { id: "ch_1", payment_intent: "pi_1" }));
    expect(out.status).toBe("ignored");
    expect(business()).toHaveLength(0);
  });

  it("records the refund when charge.refund.updated reports it succeeded", async () => {
    const out = await handleStripeEvent(stripeWith([]), evt("charge.refund.updated", refund("succeeded")));
    expect(out.status).toBe("processed");
    expect(business()).toEqual([
      { fn: "apply_stripe_refund", args: { p_payment_intent: "pi_1", p_refund_id: "re_1", p_amount: 500, p_currency: "EUR", p_account: "acct_club" } },
    ]);
  });

  it("handles refund.updated the same way and ignores non-final statuses", async () => {
    expect((await handleStripeEvent(stripeWith([]), evt("refund.updated", refund("pending")))).status).toBe("ignored");
    expect(business()).toHaveLength(0);
    expect((await handleStripeEvent(stripeWith([]), evt("refund.updated", refund("succeeded", "re_2")))).status).toBe("processed");
    expect(business().map((c) => c.fn)).toEqual(["apply_stripe_refund"]);
  });

  it("records a lost dispute as a negative adjustment", async () => {
    const dispute = { id: "dp_1", status: "lost", amount: 149000, currency: "chf", payment_intent: "pi_9" };
    const out = await handleStripeEvent(stripeWith([]), evt("charge.dispute.closed", dispute));
    expect(out.status).toBe("processed");
    expect(business()).toEqual([
      { fn: "apply_stripe_dispute_loss", args: { p_payment_intent: "pi_9", p_dispute_id: "dp_1", p_amount: 1490, p_currency: "CHF", p_account: "acct_club" } },
    ]);
  });

  it("ignores a won dispute", async () => {
    const dispute = { id: "dp_2", status: "won", amount: 100, currency: "chf", payment_intent: "pi_9" };
    expect((await handleStripeEvent(stripeWith([]), evt("charge.dispute.closed", dispute))).status).toBe("ignored");
    expect(business()).toHaveLength(0);
  });
});
