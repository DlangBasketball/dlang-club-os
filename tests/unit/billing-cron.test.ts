import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- service-role client mock: scripted RPCs + thenable query chains -------
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
let rpcResponses: Record<string, unknown[]> = {};
let tables: Record<string, unknown[]> = {};
function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "limit", "order", "not"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
  c.then = (res: (v: unknown) => unknown) => res({ data: tables[table] ?? [], error: null });
  return c;
}
vi.mock("@/lib/plans/db", () => ({
  plansAdminDb: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const q = rpcResponses[fn];
      const data = q && q.length ? q.shift() : null;
      return { data, error: null };
    },
    from: (table: string) => chain(table),
  }),
}));

// ---- Stripe mock ------------------------------------------------------------
const created: { params: Record<string, unknown>; opts: Record<string, unknown> }[] = [];
let stripeBehaviour: () => unknown = () => ({ id: "pi_ok", status: "succeeded" });
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    paymentIntents: {
      create: async (params: Record<string, unknown>, opts: Record<string, unknown>) => {
        created.push({ params, opts });
        const r = stripeBehaviour();
        if (r instanceof Error) throw r;
        return r;
      },
    },
  }),
}));
vi.mock("@/lib/stripe-connect", () => ({
  applicationFee: async () => 300,
  connectOptions: (p: { stripeAccountId: string | null }, key?: string) => ({ stripeAccount: p.stripeAccountId, ...(key ? { idempotencyKey: key } : {}) }),
}));
vi.mock("@/lib/tenant/return-origin", () => ({ orgReturnOrigin: async () => "https://club.example" }));
vi.mock("@/lib/payments/settings", () => ({
  getOrgPaymentProfile: async (orgId: string) => ({ orgId, name: "Club", stripeAccountId: "acct_club", stripeReady: true, currency: "CHF" }),
}));
vi.mock("@/lib/plans/settings", () => ({ orgTimeZone: async () => "Europe/Zurich" }));
const notices: { kind: string; familyId: string; vars: Record<string, unknown> }[] = [];
vi.mock("@/lib/plans/notify", () => ({
  notifyFamily: async (_o: string, familyId: string, kind: string, vars: Record<string, unknown>) => { notices.push({ kind, familyId, vars }); return 1; },
}));
vi.mock("@/lib/log", () => ({ logError: () => "x" }));
// The club holds every billing module (gating itself: tests/unit/upgrades-gating.test.ts).
vi.mock("@/lib/upgrades/server", () => ({ hasFeature: async () => true }));

const { runOrgBilling } = await import("@/lib/plans/cron");

const TODAY = "2026-12-01";
const workRow = { installment_id: "inst-1", plan_id: "plan-1", invoice_id: "inv-1", family_id: "fam-1", seq: 2, kind: "installments", installment_count: 4, due_date: TODAY, currency: "CHF", outstanding: 250, invoice_number: "INV-1" };
const begin = { charge_id: "chg-1", attempt: 1, idempotency_key: "autopay:inst-1:1", amount: 250, currency: "CHF", family_id: "fam-1", installment_id: "inst-1", invoice_id: "inv-1", invoice_number: "INV-1", seq: 2, plan_kind: "installments", installment_count: 4, customer_id: "cus_1", payment_method_id: "pm_1" };
const cardError = (code: string, decline?: string, status = "requires_payment_method") =>
  Object.assign(new Error(code), { type: "StripeCardError", code, decline_code: decline, raw: { payment_intent: { id: "pi_x", status } } });

describe("billing cron: autopay off-session charges", () => {
  beforeEach(() => {
    rpcCalls.length = 0; created.length = 0; notices.length = 0; tables = {};
    rpcResponses = { recurring_generate: [[]], plans_cron_work: [{ remind_before: [], overdue: [], charges: [workRow], expiring: [] }] };
    stripeBehaviour = () => ({ id: "pi_ok", status: "succeeded" });
  });

  it("charges the saved card on the club's account with the fee and a per-attempt idempotency key", async () => {
    rpcResponses.autopay_begin_charge = [begin];
    rpcResponses.autopay_charge_result = [{ transitioned: true }];
    const sum = await runOrgBilling("org-1", { today: TODAY });
    expect(created).toHaveLength(1);
    expect(created[0].params).toMatchObject({
      amount: 25000, currency: "chf", customer: "cus_1", payment_method: "pm_1", off_session: true, confirm: true,
      payment_method_types: ["card"], application_fee_amount: 300,
      metadata: { purpose: "autopay", invoice_id: "inv-1", org_id: "org-1", installment_id: "inst-1", autopay_charge_id: "chg-1" },
    });
    expect(created[0].opts).toEqual({ stripeAccount: "acct_club", idempotencyKey: "autopay:inst-1:1" });
    expect(rpcCalls.find((c) => c.fn === "autopay_charge_result")?.args).toMatchObject({ p_charge: "chg-1", p_payment_intent: "pi_ok", p_status: "succeeded", p_account: "acct_club", p_today: TODAY });
    expect(notices.map((x) => x.kind)).toEqual(["autopayCharged"]);
    expect(notices[0].vars).toMatchObject({ seq: 2, count: 4, amount: 250 });
    expect(sum).toMatchObject({ charges: 1, failed: 0, errors: 0 });
  });

  it("authentication_required -> requires_action: the parent gets a pay link, no retry", async () => {
    rpcResponses.autopay_begin_charge = [begin];
    rpcResponses.autopay_charge_result = [{ transitioned: true }];
    stripeBehaviour = () => cardError("authentication_required");
    await runOrgBilling("org-1", { today: TODAY });
    expect(rpcCalls.find((c) => c.fn === "autopay_charge_result")?.args).toMatchObject({ p_status: "requires_action", p_payment_intent: "pi_x", p_code: "authentication_required" });
    expect(notices).toEqual([expect.objectContaining({ kind: "authRequired", vars: expect.objectContaining({ installmentId: "inst-1", invoiceId: "inv-1" }) })]);
  });

  it("card_declined -> failed with the retry date from SQL", async () => {
    rpcResponses.autopay_begin_charge = [begin];
    rpcResponses.autopay_charge_result = [{ transitioned: true, fallback: false, next_retry_on: "2026-12-04" }];
    stripeBehaviour = () => cardError("card_declined", "insufficient_funds");
    const sum = await runOrgBilling("org-1", { today: TODAY });
    expect(rpcCalls.find((c) => c.fn === "autopay_charge_result")?.args).toMatchObject({ p_status: "failed", p_code: "card_declined", p_decline: "insufficient_funds" });
    expect(notices).toEqual([expect.objectContaining({ kind: "chargeFailed", vars: expect.objectContaining({ retryDate: "2026-12-04" }) })]);
    expect(sum.failed).toBe(1);
  });

  it("last retry declined -> fallback notice (QR-bill / online)", async () => {
    rpcResponses.autopay_begin_charge = [{ ...begin, attempt: 3, idempotency_key: "autopay:inst-1:3" }];
    rpcResponses.autopay_charge_result = [{ transitioned: true, fallback: true }];
    stripeBehaviour = () => cardError("card_declined");
    await runOrgBilling("org-1", { today: TODAY });
    expect(created[0].opts).toMatchObject({ idempotencyKey: "autopay:inst-1:3" });
    expect(notices.map((x) => x.kind)).toEqual(["fallback"]);
  });

  it("a network error records a failure (next attempt gets a new key) instead of leaving it processing", async () => {
    rpcResponses.autopay_begin_charge = [begin];
    rpcResponses.autopay_charge_result = [{ transitioned: true, next_retry_on: "2026-12-04" }];
    stripeBehaviour = () => Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
    await runOrgBilling("org-1", { today: TODAY });
    expect(rpcCalls.find((c) => c.fn === "autopay_charge_result")?.args).toMatchObject({ p_status: "failed", p_code: "api_error" });
  });

  it("nothing is charged when SQL refuses to claim the attempt (already processing / paid / no card)", async () => {
    rpcResponses.autopay_begin_charge = [null];
    await runOrgBilling("org-1", { today: TODAY });
    expect(created).toHaveLength(0);
    expect(notices).toHaveLength(0);
  });

  it("an async (processing) charge is left for the webhook", async () => {
    rpcResponses.autopay_begin_charge = [begin];
    stripeBehaviour = () => ({ id: "pi_p", status: "processing" });
    await runOrgBilling("org-1", { today: TODAY });
    expect(rpcCalls.some((c) => c.fn === "autopay_charge_result")).toBe(false);
    expect(notices).toHaveLength(0);
  });
});

describe("billing cron: period invoices and reminders", () => {
  beforeEach(() => {
    rpcCalls.length = 0; created.length = 0; notices.length = 0; tables = {};
  });

  it("emails new period invoices to families without autopay, reminds once before due", async () => {
    rpcResponses = {
      recurring_generate: [[
        { plan_id: "p1", family_id: "fam-auto", athlete_id: "a1", period_start: TODAY, period_end: "2026-12-31", amount: 120, discount: 0, net: 120, action: "invoice", installment_id: "i1", invoice_id: "inv-a" },
        { plan_id: "p2", family_id: "fam-qr", athlete_id: "a2", period_start: TODAY, period_end: "2026-12-31", amount: 120, discount: 60, net: 60, action: "invoice", installment_id: "i2", invoice_id: "inv-b" },
        { plan_id: "p3", family_id: "fam-qr", athlete_id: "a3", period_start: TODAY, period_end: "2026-12-31", amount: 0, discount: 0, net: 0, action: "skip_pause", installment_id: "i3", invoice_id: null },
      ]],
      plans_cron_work: [{ remind_before: [{ ...workRow, installment_id: "inst-9", due_date: "2026-12-03" }, { ...workRow, installment_id: "inst-10" }], overdue: [], charges: [], expiring: [{ mandate_id: "m1", family_id: "fam-auto", exp_month: 1, exp_year: 2027 }] }],
      plan_mark_reminded: [true, false],
      autopay_mark_expiry_notified: [true],
    };
    tables = { autopay_mandates: [{ family_id: "fam-auto" }], invoices: [{ id: "inv-b", number: "INV-B", currency: "CHF", due_date: "2026-12-15" }] };
    const sum = await runOrgBilling("org-1", { today: TODAY });
    expect(notices.map((x) => `${x.kind}:${x.familyId}`)).toEqual(["periodInvoice:fam-qr", "reminderBefore:fam-1", "cardExpiring:fam-auto"]);
    expect(notices[0].vars).toMatchObject({ invoiceNumber: "INV-B", amount: 60, dueDate: "2026-12-15" });
    expect(notices[2].vars).toMatchObject({ card: "01/2027" });
    expect(sum).toMatchObject({ invoices: 2, reminders: 1, expiring: 1 });
    expect(rpcCalls.find((c) => c.fn === "recurring_generate")?.args).toEqual({ p_org: "org-1", p_as_of: TODAY, p_dry_run: false });
  });

  it("run now: generates up to a later date but charges only what is due today", async () => {
    rpcResponses = { recurring_generate: [[]], plans_cron_work: [{ remind_before: [], overdue: [], charges: [], expiring: [] }] };
    await runOrgBilling("org-1", { today: TODAY, generateUntil: "2026-12-20" });
    expect(rpcCalls.find((c) => c.fn === "recurring_generate")?.args).toMatchObject({ p_as_of: "2026-12-20" });
    expect(rpcCalls.find((c) => c.fn === "plans_cron_work")?.args).toMatchObject({ p_today: TODAY });
  });
});
