import { describe, expect, it } from "vitest";
import {
  deliverAlert, runDispatcher, type AlertOutcome, type AlertStore, type AlertTransport, type ClaimedAlert, type Wanted,
} from "@/lib/attendance/dispatcher";
import { ALERT_MAX_ATTEMPTS, attendanceErrorCode } from "@/lib/attendance/types";
import { planWeeklySeries } from "@/lib/attendance/schedule";

// Synthetic data only.
function alert(over: Partial<ClaimedAlert> = {}): ClaimedAlert {
  return {
    alertId: "a1", orgId: "org-a", kind: "initial", markStatus: "unexcused", attempts: 1, channelResults: {}, notificationId: null,
    guardianProfileId: "g1", guardianEmail: "g1@example.test", guardianName: "Synthetic Guardian", guardianLocale: null,
    receivesEmails: true, eventId: "e1", athleteId: "p1", athleteFirstName: "Synth", athleteLastName: "Player",
    teamName: "Synthetic U14", eventType: "training", startsAt: "2026-11-20T17:00:00Z", endsAt: "2026-11-20T18:30:00Z",
    timeZone: "Europe/Zurich", ...over,
  };
}

/** Fake transport: counts sends, fails a channel on demand. */
function fakeTransport(opts: { wanted?: Wanted; failEmail?: number; failInApp?: boolean; pushCount?: number } = {}) {
  const sent = { inApp: 0, email: 0, push: 0 };
  let emailFailures = opts.failEmail ?? 0;
  const t: AlertTransport = {
    async wanted() { return opts.wanted ?? { inApp: true, email: true, push: true }; },
    async inApp() {
      if (opts.failInApp) return { ok: false, error: "db down" };
      sent.inApp += 1;
      return { ok: true, notificationId: `n${sent.inApp}` };
    },
    async email() {
      if (emailFailures > 0) { emailFailures -= 1; return { ok: false, error: "smtp 503" }; }
      sent.email += 1;
      return { ok: true };
    },
    async push() { sent.push += 1; return { ok: true, count: opts.pushCount ?? 1 }; },
    now: () => new Date("2026-11-21T08:00:00Z"),
  };
  return { t, sent };
}

/**
 * Fake store mirroring the SQL claim rules: pending, or failed below the
 * attempt cap; a claim bumps attempts; the outcome is written back.
 */
function fakeStore(rows: (ClaimedAlert & { status: string })[], due: (ClaimedAlert & { status: string })[] = []) {
  const recorded: { id: string; o: AlertOutcome }[] = [];
  const store: AlertStore = {
    async createDue() {
      let n = 0;
      for (const d of due.splice(0)) {
        // unique (event, athlete, guardian, kind): no duplicate rows
        if (!rows.some((r) => r.eventId === d.eventId && r.athleteId === d.athleteId && r.guardianProfileId === d.guardianProfileId && r.kind === d.kind)) {
          rows.push(d);
          n += 1;
        }
      }
      return n;
    },
    async claim(limit) {
      const picked = rows.filter((r) => (r.status === "pending" || r.status === "failed") && r.attempts < ALERT_MAX_ATTEMPTS).slice(0, limit);
      for (const r of picked) r.attempts += 1;
      return picked.map((r) => ({ ...r }));
    },
    async record(id, o) {
      recorded.push({ id, o });
      const r = rows.find((x) => x.alertId === id)!;
      r.status = o.status;
      r.channelResults = o.channels;
      r.notificationId = o.notificationId;
    },
  };
  return { store, recorded, rows };
}

describe("no-show alert dispatcher", () => {
  it("sends in-app, e-mail and push once and records sent", async () => {
    const { t, sent } = fakeTransport();
    const o = await deliverAlert(alert(), t);
    expect(o.status).toBe("sent");
    expect(sent).toEqual({ inApp: 1, email: 1, push: 1 });
    expect(o.notificationId).toBe("n1");
    expect(o.channels.email?.ok).toBe(true);
  });

  it("is idempotent across runs: a sent alert is never claimed or sent again", async () => {
    const { t, sent } = fakeTransport();
    const { store } = fakeStore([{ ...alert(), attempts: 0, status: "pending" }]);
    const first = await runDispatcher(store, t);
    const second = await runDispatcher(store, t);
    expect(first.sent).toBe(1);
    expect(second.claimed).toBe(0);
    expect(sent).toEqual({ inApp: 1, email: 1, push: 1 });
  });

  it("due alerts are created once (double finalize / overlapping runs)", async () => {
    const { t } = fakeTransport();
    const due = { ...alert({ alertId: "a2" }), attempts: 0, status: "pending" };
    const { store, rows } = fakeStore([], [due, { ...due }]);
    const s = await runDispatcher(store, t);
    expect(s.created).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it("retries a failed e-mail without repeating the in-app notification", async () => {
    const { t, sent } = fakeTransport({ failEmail: 1 });
    const { store, rows } = fakeStore([{ ...alert(), attempts: 0, status: "pending" }]);
    const first = await runDispatcher(store, t);
    expect(first.failed).toBe(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].channelResults.in_app?.ok).toBe(true);
    const second = await runDispatcher(store, t);
    expect(second.sent).toBe(1);
    expect(sent.inApp).toBe(1); // reused notification_id, not inserted twice
    expect(sent.email).toBe(1);
    expect(sent.push).toBe(1);
  });

  it("stops retrying after the maximum attempts (staff follow-up)", async () => {
    const { t } = fakeTransport({ failEmail: 99 });
    const { store, rows } = fakeStore([{ ...alert(), attempts: 0, status: "pending" }]);
    for (let i = 0; i < ALERT_MAX_ATTEMPTS + 2; i++) await runDispatcher(store, t);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].attempts).toBe(ALERT_MAX_ATTEMPTS);
  });

  it("no channel at all -> no_contact", async () => {
    const { t, sent } = fakeTransport({ wanted: { inApp: false, email: false, push: false } });
    const o = await deliverAlert(alert(), t);
    expect(o.status).toBe("no_contact");
    expect(sent).toEqual({ inApp: 0, email: 0, push: 0 });
  });

  it("only push wanted and no registered device -> no_contact", async () => {
    const { t } = fakeTransport({ wanted: { inApp: false, email: false, push: true }, pushCount: 0 });
    expect((await deliverAlert(alert(), t)).status).toBe("no_contact");
  });

  it("e-mail not wanted (guardian flag / preference): in-app only is a success", async () => {
    const { t, sent } = fakeTransport({ wanted: { inApp: true, email: false, push: false } });
    const o = await deliverAlert(alert(), t);
    expect(o.status).toBe("sent");
    expect(sent.email).toBe(0);
  });

  it("an in-app failure is a failure with the error kept", async () => {
    const { t } = fakeTransport({ failInApp: true, wanted: { inApp: true, email: false, push: false } });
    const o = await deliverAlert(alert(), t);
    expect(o.status).toBe("failed");
    expect(o.error).toContain("db down");
  });

  it("a transport that throws never breaks the run", async () => {
    const t: AlertTransport = {
      async wanted() { throw new Error("prefs unavailable"); },
      async inApp() { return { ok: true }; }, async email() { return { ok: true }; }, async push() { return { ok: true, count: 0 }; },
    };
    const { store } = fakeStore([{ ...alert(), attempts: 0, status: "pending" }]);
    const s = await runDispatcher(store, t);
    expect(s.failed).toBe(1);
  });
});

describe("attendance error codes", () => {
  it("reads the code out of a database message", () => {
    expect(attendanceErrorCode("ERROR: UNMARKED_PLAYERS")).toBe("UNMARKED_PLAYERS");
    expect(attendanceErrorCode("permission denied")).toBeNull();
  });
});

describe("weekly training series", () => {
  const base = { startsAt: "2026-12-07T17:00:00Z", endsAt: "2026-12-07T18:30:00Z", timeZone: "Europe/Zurich" };

  it("skips weeks inside a club break and stops at the training window end", () => {
    const plan = planWeeklySeries({
      ...base, repeatWeeks: 0, repeatUntil: "2027-01-31", applyRules: true,
      window: { startsOn: "2026-08-17", endsOn: "2027-01-18" },
      breaks: [{ startsOn: "2026-12-21", endsOn: "2027-01-08" }],
    });
    const days = plan.occurrences.map((o) => o.startsAt.slice(0, 10));
    expect(days).toEqual(["2026-12-07", "2026-12-14", "2027-01-11", "2027-01-18"]);
    expect(plan.skipped.filter((s) => s.reason === "break").map((s) => s.date)).toEqual(["2026-12-21", "2026-12-28", "2027-01-04"]);
    expect(plan.skipped.at(-1)).toEqual({ date: "2027-01-25", reason: "outside_window" });
  });

  it("a game series ignores window and breaks", () => {
    const plan = planWeeklySeries({ ...base, repeatWeeks: 3, applyRules: false, breaks: [{ startsOn: "2026-12-14", endsOn: "2026-12-14" }] });
    expect(plan.occurrences).toHaveLength(4);
  });

  it("starts before the window are skipped, not shifted", () => {
    const plan = planWeeklySeries({ ...base, startsAt: "2026-08-03T16:00:00Z", endsAt: "2026-08-03T17:30:00Z", repeatWeeks: 3, applyRules: true,
      window: { startsOn: "2026-08-17", endsOn: null } });
    expect(plan.occurrences.map((o) => o.startsAt.slice(0, 10))).toEqual(["2026-08-17", "2026-08-24"]);
  });
});
