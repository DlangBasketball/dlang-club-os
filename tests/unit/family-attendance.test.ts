import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@/lib/notifications/templates";
import { recipientKey, resolveAlertRecipients } from "@/lib/attendance/recipients";
import { deliverAlert, runDispatcher, type AlertOutcome, type AlertStore, type AlertTransport, type ClaimedAlert } from "@/lib/attendance/dispatcher";
import { filterHistory, historyOptions, summarize, uuidParam } from "@/lib/attendance/family";
import { ALERT_MAX_ATTEMPTS, attendancePortalPath } from "@/lib/attendance/types";
import { resendError, sendEmail, testRedirect } from "@/lib/email/resend";
import { deliveryOutcome, verifySvixSignature } from "@/lib/email/webhook";
import { createHmac } from "node:crypto";

// Synthetic data only.
const EVENT = "00000000-0000-4000-8000-00000000e001";
const ATHLETE = "00000000-0000-4000-8000-00000000a001";
const vars = {
  parent_name: "Synthetic Guardian", athlete_name: "Synth Player", team_name: "Synthetic U14",
  starts_at: "2026-11-20T17:00:00Z", event_id: EVENT, athlete_id: ATHLETE, attendance_status: "unexcused",
  club_name: "Synthetic Club",
};
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("no-show alert templates", () => {
  it("contains the player, team, date and time in the club time zone and the record link", () => {
    const zurich = render("attendance_no_show", vars, { timeZone: "Europe/Zurich", locale: "en-CH", baseUrl: "https://club.example.test" });
    expect(zurich.subject).toContain("Synth Player");
    expect(zurich.subject).toContain("Synthetic U14");
    expect(norm(zurich.body)).toMatch(/18:00/);
    expect(zurich.link).toBe(attendancePortalPath(EVENT, ATHLETE));
    expect(zurich.html).toContain(`https://club.example.test/parent/attendance/team/${EVENT}?athlete=${ATHLETE}`);
    // Same instant, another club time zone: the wall-clock time follows the club, not the server.
    const ny = render("attendance_no_show", vars, { timeZone: "America/New_York", locale: "en-US" });
    expect(norm(ny.body)).toMatch(/12:00\s?PM/);
    expect(norm(ny.body)).not.toMatch(/18:00/);
  });

  it("names only the recipient's own child (no other family's data)", () => {
    const r = render("attendance_no_show", vars, { timeZone: "Europe/Zurich" });
    const all = `${r.title} ${r.body} ${r.subject} ${r.html}`;
    expect(all).not.toMatch(/Other Child|other-family/i);
    // Only the one athlete id appears in the link; nothing else identifies people.
    expect(all.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)?.every((id) => id === EVENT || id === ATHLETE)).toBe(true);
  });

  it("escapes names in the HTML", () => {
    const r = render("attendance_no_show", { ...vars, athlete_name: "<script>x</script>" }, {});
    expect(r.html).not.toContain("<script>");
  });

  it("an e-mail-only recipient (no login) is asked to contact the club, without a portal link", () => {
    const r = render("attendance_no_show", { ...vars, has_account: false }, { timeZone: "Europe/Zurich" });
    expect(r.html).toContain("Synthetic Club");
    expect(r.html).not.toContain("/parent/attendance/team/");
  });

  it("is translated in the guardian's language (en, fr, de, es, it)", () => {
    const subjects = ["en", "fr", "de", "es", "it"].map((language) => render("attendance_no_show", vars, { language, timeZone: "Europe/Zurich" }).subject);
    expect(new Set(subjects).size).toBe(5);
    expect(render("attendance_no_show", vars, { language: "fr" }).html).toContain('lang="fr"');
  });

  it("a correction says it corrects the earlier message, the new status and why it matters", () => {
    const r = render("attendance_no_show_correction", { ...vars, attendance_status: "late" }, { timeZone: "Europe/Zurich" });
    expect(r.subject).toMatch(/^Correction/);
    expect(r.subject).toContain("late");
    expect(r.html).toContain("corrects our earlier message");
    expect(r.html).toContain("no longer counts as an unexcused absence");
    const back = render("attendance_no_show_correction", { ...vars, attendance_status: "unexcused" }, {});
    expect(back.html).toContain("now counts as an unexcused absence");
    const de = render("attendance_no_show_correction", { ...vars, attendance_status: "late" }, { language: "de" });
    expect(de.subject).toMatch(/^Korrektur/);
    expect(de.subject).toContain("verspätet");
  });
});

describe("alert recipients", () => {
  const family = { id: "fam-1", contactEmail: " Family@Example.test " };

  it("guardians with an active login get one alert each (primary first); the contact e-mail is not used", () => {
    const r = resolveAlertRecipients({
      guardians: [
        { profileId: "g2", active: true, suspendedInClub: false },
        { profileId: "g1", active: true, suspendedInClub: false, isPrimary: true },
        { profileId: "g1", active: true, suspendedInClub: false, isPrimary: true },
        { profileId: "g3", active: false, suspendedInClub: false },
        { profileId: "g4", active: true, suspendedInClub: true },
      ],
      family,
    });
    expect(r).toEqual([
      { kind: "guardian", key: "g:g1", profileId: "g1" },
      { kind: "guardian", key: "g:g2", profileId: "g2" },
    ]);
  });

  it("no guardian login: the family contact e-mail, keyed by the family", () => {
    expect(resolveAlertRecipients({ guardians: [{ profileId: "gx", active: false, suspendedInClub: false }], family })).toEqual([
      { kind: "family_email", key: "f:fam-1", familyId: "fam-1", email: "family@example.test" },
    ]);
  });

  it("never e-mails the player's own address (minors) or an archived family", () => {
    expect(resolveAlertRecipients({ guardians: [], family, playerLoginEmails: ["family@example.test"] })).toEqual([{ kind: "none", key: "none" }]);
    expect(resolveAlertRecipients({ guardians: [], family: { ...family, status: "archived" } })).toEqual([{ kind: "none", key: "none" }]);
  });

  it("no login and no usable e-mail: no_contact for staff follow-up", () => {
    expect(resolveAlertRecipients({ guardians: [], family: { id: "fam-2", contactEmail: null } })).toEqual([{ kind: "none", key: "none" }]);
    expect(resolveAlertRecipients({ guardians: [], family: { id: "fam-2", contactEmail: "not-an-email" } })).toEqual([{ kind: "none", key: "none" }]);
    expect(resolveAlertRecipients({ guardians: [], family: null })).toEqual([{ kind: "none", key: "none" }]);
  });

  it("recipient keys are stable (an address change keeps the family key)", () => {
    expect(recipientKey({ guardianProfileId: "g1", familyId: "fam-1" })).toBe("g:g1");
    expect(recipientKey({ familyId: "fam-1" })).toBe("f:fam-1");
    expect(recipientKey({})).toBe("none");
  });
});

function familyAlert(over: Partial<ClaimedAlert> = {}): ClaimedAlert {
  return {
    alertId: "fa1", orgId: "org-a", kind: "initial", markStatus: "unexcused", attempts: 1, channelResults: {}, notificationId: null,
    recipientKind: "family_email", guardianProfileId: null, guardianEmail: "delivered@resend.dev", guardianName: null, guardianLocale: null,
    receivesEmails: true, eventId: EVENT, athleteId: ATHLETE, athleteFirstName: "Synth", athleteLastName: "Player",
    teamName: "Synthetic U14", eventType: "training", startsAt: "2026-11-20T17:00:00Z", endsAt: "2026-11-20T18:30:00Z",
    timeZone: "Europe/Zurich", ...over,
  };
}

function transport(opts: { emailError?: string } = {}) {
  const sent = { inApp: 0, email: 0, push: 0 };
  const t: AlertTransport = {
    async wanted() { return { inApp: true, email: true, push: true }; },
    async inApp() { sent.inApp += 1; return { ok: true, notificationId: "n1" }; },
    async email() {
      sent.email += 1;
      return opts.emailError ? { ok: false, error: opts.emailError } : { ok: true, providerId: `re_${sent.email}` };
    },
    async push() { sent.push += 1; return { ok: true, count: 1 }; },
    now: () => new Date("2026-11-21T08:00:00Z"),
  };
  return { t, sent };
}

/** Store keyed like the database: one initial alert per (event, athlete, recipient key). */
function keyedStore() {
  const rows: (ClaimedAlert & { status: string; key: string })[] = [];
  const recorded: { id: string; o: AlertOutcome }[] = [];
  const insert = (a: ClaimedAlert) => {
    const key = recipientKey({ guardianProfileId: a.guardianProfileId, familyId: a.recipientKind === "family_email" ? "fam-1" : null });
    if (rows.some((r) => r.eventId === a.eventId && r.athleteId === a.athleteId && r.kind === a.kind && r.key === key)) return 0;
    rows.push({ ...a, attempts: 0, status: "pending", key });
    return 1;
  };
  const store: AlertStore = {
    async createDue() { return 0; },
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
    },
  };
  return { store, rows, recorded, insert };
}

describe("dispatcher with e-mail-only recipients", () => {
  it("sends e-mail only (no in-app, no push) and records the provider id for bounce tracking", async () => {
    const { t, sent } = transport();
    const o = await deliverAlert(familyAlert(), t);
    expect(o.status).toBe("sent");
    expect(sent).toEqual({ inApp: 0, email: 1, push: 0 });
    expect(o.channels.email?.provider_id).toBe("re_1");
  });

  it("a provider rejection is recorded as failed with the error (staff follow-up after the cap)", async () => {
    const { t } = transport({ emailError: "resend-422: Invalid `to` field" });
    const o = await deliverAlert(familyAlert(), t);
    expect(o.status).toBe("failed");
    expect(o.error).toContain("resend-422");
  });

  it("without an address there is no channel -> no_contact", async () => {
    const { t, sent } = transport();
    expect((await deliverAlert(familyAlert({ guardianEmail: null }), t)).status).toBe("no_contact");
    expect(sent.email).toBe(0);
  });

  it("is idempotent with the recipient key: re-creating the alert and re-running never sends twice", async () => {
    const { t, sent } = transport();
    const { store, rows, insert } = keyedStore();
    expect(insert(familyAlert({ alertId: "x1" }))).toBe(1);
    expect(insert(familyAlert({ alertId: "x2", guardianEmail: "changed@resend.dev" }))).toBe(0); // same family key
    expect(insert(familyAlert({ alertId: "x3", recipientKind: "guardian", guardianProfileId: "g1" }))).toBe(1); // another recipient
    await runDispatcher(store, t);
    await runDispatcher(store, t);
    expect(rows.map((r) => r.status)).toEqual(["sent", "sent"]);
    expect(sent.email).toBe(2);
  });
});

describe("Resend helpers (safe test mode)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("EMAIL_TEST_REDIRECT sends every e-mail to the test inbox instead of the real recipient", async () => {
    vi.stubEnv("EMAIL_TEST_REDIRECT", "bounced@resend.dev");
    vi.stubEnv("RESEND_API_KEY", "re_test_dummy");
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { to: string; tags?: { name: string; value: string }[] };
      expect(body.to).toBe("bounced@resend.dev");
      expect(body.tags).toEqual([{ name: "org", value: "org-a" }]);
      return new Response(JSON.stringify({ id: "re_abc" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendEmail({ to: "real.person@example.test", subject: "s", html: "<p>h</p>", tags: [{ name: "org", value: "org-a" }] });
    expect(r).toEqual({ ok: true, id: "re_abc" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ignores an invalid redirect and keeps provider errors readable", () => {
    vi.stubEnv("EMAIL_TEST_REDIRECT", "nope");
    expect(testRedirect()).toBeNull();
    expect(resendError(422, JSON.stringify({ name: "validation_error", message: "Invalid `to` field." }))).toBe("resend-422: Invalid `to` field.");
    expect(resendError(500, "<html>")).toBe("resend-500");
  });
});

describe("portal history helpers", () => {
  const rows = [
    { event_id: "e1", team_id: "t1", team_name: "U14", type: "training", starts_at: "2026-11-01T17:00:00Z", status: "present", is_guest: false, season_id: "s1", season_name: "2026/27" },
    { event_id: "e2", team_id: "t1", team_name: "U14", type: "training", starts_at: "2026-11-03T17:00:00Z", status: "late", is_guest: false, season_id: "s1", season_name: "2026/27" },
    { event_id: "e3", team_id: "t2", team_name: "U16", type: "game", starts_at: "2026-11-05T17:00:00Z", status: "unexcused", is_guest: true, season_id: "s1", season_name: "2026/27" },
    { event_id: "e4", team_id: "t1", team_name: "U14", type: "training", starts_at: "2026-04-05T17:00:00Z", status: "excused", is_guest: false, season_id: "s0", season_name: "2025/26" },
  ];

  it("totals and rate = (present + late) / sessions", () => {
    expect(summarize(rows)).toEqual({ sessions: 4, present: 1, late: 1, excused: 1, unexcused: 1, rate: 0.5 });
    expect(summarize([]).rate).toBeNull();
    expect(summarize([{ status: "unmarked" }]).sessions).toBe(0);
  });

  it("filters by team and season and lists the options", () => {
    expect(filterHistory(rows, { teamId: "t1", seasonId: "s1" }).map((r) => r.event_id)).toEqual(["e1", "e2"]);
    expect(filterHistory(rows, {}).length).toBe(4);
    expect(historyOptions(rows)).toEqual({
      teams: [{ id: "t1", name: "U14" }, { id: "t2", name: "U16" }],
      seasons: [{ id: "s1", name: "2026/27" }, { id: "s0", name: "2025/26" }],
    });
  });

  it("only accepts uuid search params", () => {
    expect(uuidParam(EVENT)).toBe(EVENT);
    expect(uuidParam("1 or 1=1")).toBeNull();
    expect(uuidParam(undefined)).toBeNull();
  });
});

describe("Resend webhook (bounces)", () => {
  const raw = Buffer.from("synthetic-secret-bytes");
  const secret = `whsec_${raw.toString("base64")}`;
  const sign = (id: string, ts: string, body: string) => `v1,${createHmac("sha256", raw).update(`${id}.${ts}.${body}`).digest("base64")}`;

  it("accepts a correctly signed event and rejects tampering, stale or missing signatures", () => {
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_1" } });
    const ts = "1700000000";
    const sig = sign("msg_1", ts, body);
    expect(verifySvixSignature({ secret, id: "msg_1", timestamp: ts, signature: `v1,bogus ${sig}`, body, nowSeconds: 1700000010 })).toBe(true);
    expect(verifySvixSignature({ secret, id: "msg_1", timestamp: ts, signature: sig, body: `${body} `, nowSeconds: 1700000010 })).toBe(false);
    expect(verifySvixSignature({ secret, id: "msg_1", timestamp: ts, signature: sig, body, nowSeconds: 1700009999 })).toBe(false);
    expect(verifySvixSignature({ secret, id: "msg_1", timestamp: ts, signature: null, body })).toBe(false);
  });

  it("maps bounces to a failure with the reason and the org tag", () => {
    expect(deliveryOutcome({
      type: "email.bounced",
      data: { email_id: "re_1", tags: { org: "org-a", kind: "attendance_alert" }, bounce: { type: "Permanent", subType: "General", message: "Mailbox does not exist" } },
    })).toEqual({ kind: "failed", providerId: "re_1", orgId: "org-a", error: "bounced: Permanent / General / Mailbox does not exist" });
    expect(deliveryOutcome({ type: "email.delivered", data: { email_id: "re_2", tags: [{ name: "org", value: "org-b" }] } }))
      .toEqual({ kind: "delivered", providerId: "re_2", orgId: "org-b" });
    expect(deliveryOutcome({ type: "email.opened", data: { email_id: "re_3" } })).toEqual({ kind: "ignored" });
    expect(deliveryOutcome({ type: "email.bounced", data: {} })).toEqual({ kind: "ignored" });
  });
});
