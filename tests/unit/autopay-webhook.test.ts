import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// Service-role client: records every RPC; responses are scripted per test.
const calls: { fn: string; args: Record<string, unknown> }[] = [];
const inserts: { table: string; row: unknown }[] = [];
let responses: Record<string, { data: unknown; error: { message: string } | null }> = {};
let claimFresh = true;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "claim_stripe_event") return { data: claimFresh, error: null };
      return responses[fn] ?? { data: null, error: null };
    },
    from: (table: string) => ({ insert: async (row: unknown) => { inserts.push({ table, row }); return { error: null }; } }),
  }),
}));
vi.mock("@/lib/stripe-connect", () => ({ syncAccount: async () => null }));
const notices: { orgId: string; familyId: string; kind: string; vars: Record<string, unknown> }[] = [];
vi.mock("@/lib/plans/notify", () => ({
  notifyFamily: async (orgId: string, familyId: string, kind: string, vars: Record<string, unknown>) => { notices.push({ orgId, familyId, kind, vars }); return 1; },
}));

const { handleStripeEvent } = await import("@/lib/payments/stripe-webhook");

let n = 0;
const evt = (type: string, object: unknown, account: string | null = "acct_club"): Stripe.Event =>
  ({ id: `evt_${type}_${++n}`, type, account, livemode: false, data: { object } }) as unknown as Stripe.Event;

const business = () => calls.filter((c) => c.fn !== "claim_stripe_event" && c.fn !== "finish_stripe_event");

const card = { id: "pm_new", type: "card", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2031 } };
const detached: string[] = [];
const retrieved: { id: string; params: unknown; opts: unknown }[] = [];
const stripe = {
  setupIntents: {
    retrieve: async (id: string, params: unknown, opts: unknown) => {
      retrieved.push({ id, params, opts });
      return { id, status: "succeeded", customer: "cus_1", payment_method: card, metadata: { purpose: "autopay_setup", mandate_id: "m-1" } };
    },
  },
  paymentMethods: {
    retrieve: async () => card,
    detach: async (id: string) => { detached.push(id); return { id }; },
  },
  charges: { retrieve: async () => ({ id: "ch_1", payment_method_details: { type: "card", card: { brand: "visa" } } }) },
} as unknown as Stripe;

const pi = (over: Record<string, unknown> = {}) => ({
  id: "pi_auto_1", status: "succeeded", amount: 30600, amount_received: 30600, currency: "chf", latest_charge: "ch_1",
  application_fee_amount: 300,
  metadata: { purpose: "autopay", invoice_id: "inv-1", org_id: "org-1", installment_id: "inst-1", autopay_charge_id: "chg-1" },
  ...over,
});

describe("Stripe webhook: autopay", () => {
  beforeEach(() => {
    calls.length = 0; inserts.length = 0; notices.length = 0; detached.length = 0; retrieved.length = 0;
    responses = {}; claimFresh = true;
  });

  it("activates a mandate when a setup-mode Checkout completes on the club's account", async () => {
    responses.autopay_activate = { data: { mandate_id: "m-1", replaced: [{ mandate_id: "m-0", payment_method: "pm_old" }] }, error: null };
    const session = { id: "cs_1", mode: "setup", setup_intent: "seti_1", metadata: { purpose: "autopay_setup", mandate_id: "m-1", org_id: "org-1" } };
    const out = await handleStripeEvent(stripe, evt("checkout.session.completed", session));
    expect(out.status).toBe("processed");
    expect(retrieved[0]).toEqual({ id: "seti_1", params: { expand: ["payment_method"] }, opts: { stripeAccount: "acct_club" } });
    expect(business()).toEqual([{ fn: "autopay_activate", args: {
      p_mandate: "m-1", p_account: "acct_club", p_customer: "cus_1", p_payment_method: "pm_new",
      p_brand: "visa", p_last4: "4242", p_exp_month: 4, p_exp_year: 2031,
    } }]);
    // the card it replaced is removed from Stripe
    expect(detached).toEqual(["pm_old"]);
  });

  it("handles setup_intent.succeeded the same way, and ignores setup sessions that are not autopay", async () => {
    const si = { id: "seti_2", status: "succeeded", customer: "cus_1", payment_method: "pm_new", metadata: { purpose: "autopay_setup", mandate_id: "m-2" } };
    expect((await handleStripeEvent(stripe, evt("setup_intent.succeeded", si))).status).toBe("processed");
    expect(business().map((c) => c.fn)).toEqual(["autopay_activate"]);
    calls.length = 0;
    const saas = { id: "cs_2", mode: "setup", setup_intent: "seti_3", metadata: {} };
    expect((await handleStripeEvent(stripe, evt("checkout.session.completed", saas))).status).toBe("ignored");
    expect(business()).toHaveLength(0);
  });

  it("an account mismatch is recorded and acknowledged, not retried", async () => {
    responses.autopay_activate = { data: null, error: { message: "ACCOUNT_MISMATCH" } };
    const si = { id: "seti_4", status: "succeeded", customer: "cus_1", payment_method: "pm_new", metadata: { purpose: "autopay_setup", mandate_id: "m-3" } };
    const out = await handleStripeEvent(stripe, evt("setup_intent.succeeded", si, "acct_other"));
    expect(out).toMatchObject({ status: "failed", retry: false });
  });

  it("a succeeded off-session charge records the payment and closes the attempt (no email)", async () => {
    responses.autopay_charge_result = { data: { transitioned: true, org_id: "org-1", family_id: "fam-1" }, error: null };
    const out = await handleStripeEvent(stripe, evt("payment_intent.succeeded", pi()));
    expect(out.status).toBe("processed");
    expect(business().map((c) => c.fn)).toEqual(["apply_stripe_payment", "autopay_charge_result"]);
    expect(business()[0].args).toMatchObject({ p_invoice: "inv-1", p_amount: 306, p_payment_intent: "pi_auto_1", p_currency: "CHF", p_account: "acct_club", p_fee: 3 });
    expect(business()[1].args).toMatchObject({ p_charge: "chg-1", p_payment_intent: "pi_auto_1", p_status: "succeeded", p_account: "acct_club" });
    expect(notices).toHaveLength(0);
  });

  it("a declined off-session charge schedules a retry and tells the family", async () => {
    responses.autopay_charge_result = { data: { transitioned: true, fallback: false, next_retry_on: "2026-12-04", org_id: "org-1", family_id: "fam-1", invoice_id: "inv-1", installment_id: "inst-1", amount: 306, currency: "CHF" }, error: null };
    const failed = pi({ status: "requires_payment_method", last_payment_error: { code: "card_declined", decline_code: "insufficient_funds", payment_method: { type: "card" } } });
    const out = await handleStripeEvent(stripe, evt("payment_intent.payment_failed", failed));
    expect(out.status).toBe("processed");
    expect(business()).toEqual([{ fn: "autopay_charge_result", args: {
      p_charge: "chg-1", p_payment_intent: "pi_auto_1", p_status: "failed", p_code: "card_declined", p_decline: "insufficient_funds", p_account: "acct_club",
    } }]);
    // the generic failure audit row is still written, without card data
    expect(inserts[0]).toMatchObject({ table: "audit_logs", row: { action: "STRIPE_PAYMENT_FAILED", new_data: { code: "card_declined", decline_code: "insufficient_funds" } } });
    expect(JSON.stringify(inserts)).not.toMatch(/4242|exp_month/);
    expect(notices).toEqual([{ orgId: "org-1", familyId: "fam-1", kind: "chargeFailed", vars: expect.objectContaining({ retryDate: "2026-12-04", amount: 306 }) }]);
  });

  it("falls back to QR-bill after the last retry", async () => {
    responses.autopay_charge_result = { data: { transitioned: true, fallback: true, org_id: "org-1", family_id: "fam-1", invoice_id: "inv-1", amount: 306, currency: "CHF" }, error: null };
    await handleStripeEvent(stripe, evt("payment_intent.payment_failed", pi({ status: "requires_payment_method", last_payment_error: { code: "card_declined" } })));
    expect(notices.map((x) => x.kind)).toEqual(["fallback"]);
  });

  it("3-D Secure: requires_action emails the parent a link, once", async () => {
    responses.autopay_charge_result = { data: { transitioned: true, org_id: "org-1", family_id: "fam-1", invoice_id: "inv-1", installment_id: "inst-1", amount: 306, currency: "CHF" }, error: null };
    await handleStripeEvent(stripe, evt("payment_intent.requires_action", pi({ status: "requires_action" })));
    expect(notices.map((x) => x.kind)).toEqual(["authRequired"]);
    expect(notices[0].vars).toMatchObject({ invoiceId: "inv-1", installmentId: "inst-1" });
    // already recorded by the cron: no second email
    responses.autopay_charge_result = { data: { transitioned: false }, error: null };
    await handleStripeEvent(stripe, evt("payment_intent.requires_action", pi({ status: "requires_action" })));
    expect(notices).toHaveLength(1);
  });

  it("ignores ordinary (non-autopay) failures for the autopay ledger", async () => {
    const plain = pi({ status: "requires_payment_method", metadata: { invoice_id: "inv-9", org_id: "org-1" } });
    await handleStripeEvent(stripe, evt("payment_intent.payment_failed", plain));
    expect(business()).toHaveLength(0);
    expect(inserts).toHaveLength(1);
  });

  it("payment_method.detached / automatically_updated keep the mandate in sync", async () => {
    responses.autopay_payment_method_event = { data: 1, error: null };
    expect((await handleStripeEvent(stripe, evt("payment_method.detached", { id: "pm_new", type: "card", card: card.card }))).status).toBe("processed");
    expect((await handleStripeEvent(stripe, evt("payment_method.automatically_updated", { id: "pm_new", type: "card", card: { ...card.card, exp_year: 2033 } }))).status).toBe("processed");
    expect(business()).toEqual([
      { fn: "autopay_payment_method_event", args: { p_account: "acct_club", p_payment_method: "pm_new", p_detached: true, p_brand: "visa", p_last4: "4242", p_exp_month: 4, p_exp_year: 2031 } },
      { fn: "autopay_payment_method_event", args: { p_account: "acct_club", p_payment_method: "pm_new", p_detached: false, p_brand: "visa", p_last4: "4242", p_exp_month: 4, p_exp_year: 2033 } },
    ]);
  });

  it("is idempotent on the event id: a redelivered event does nothing", async () => {
    claimFresh = false;
    const out = await handleStripeEvent(stripe, evt("payment_intent.succeeded", pi()));
    expect(out.status).toBe("duplicate");
    expect(business()).toHaveLength(0);
  });
});
