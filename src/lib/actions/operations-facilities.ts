"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getI18n, getLocaleContext } from "@/lib/i18n/server";
import { zonedWallTimeToUtc } from "@/lib/format";
import { logError } from "@/lib/log";
import { addDayKey, zonedDayKey } from "@/lib/staff/hours";
import type { Json } from "@/types/database";
import type { AlertRow } from "@/lib/messaging/db";
import { dispatchAlert } from "@/lib/messaging/notify";
import { opsDb, type OpsClient } from "@/lib/operations/db";
import { expandAllocations, findCourtConflicts, shiftByDays, type Conflict, type OneOff } from "@/lib/operations/facilities";
import { loadAllocations, loadClosureImpact, loadOneOffs, teamNames, toAllocation } from "@/lib/operations/data";
import { coachProfileIds, guardianProfileIds, notifyProfiles } from "@/lib/operations/notify";
import { dbFail, fail, gate, parseInput, writeAudit, type OpsResult } from "@/lib/operations/server";
import {
  allocationSchema,
  closureApplySchema,
  closureSchema,
  customerSchema,
  generateEventsSchema,
  rentalSchema,
  uuid,
} from "@/lib/operations/validation";

/**
 * Facilities: weekly court allocations (with conflict detection against
 * other allocations, team events and rentals), external rentals invoiced to
 * an external customer, and venue closures that cancel / move what they
 * touch and notify the affected families and coaches in one step.
 */
export type ConflictResult = { ok: false; error: string; conflicts: Conflict[] };

function revalidateFacilities(extra?: string) {
  revalidatePath("/admin/operations/facilities");
  revalidatePath("/admin/operations");
  revalidatePath("/admin/schedule");
  revalidatePath("/admin/calendar");
  if (extra) revalidatePath(extra);
}

/** Existing bookings of a venue over a horizon (for conflict checks). */
async function occupancy(db: OpsClient, orgId: string, venueId: string, fromKey: string, toKey: string, timeZone: string) {
  const fromIso = (zonedWallTimeToUtc(fromKey, "00:00", timeZone) ?? new Date(`${fromKey}T00:00:00Z`)).toISOString();
  const toIso = (zonedWallTimeToUtc(addDayKey(toKey, 1), "00:00", timeZone) ?? new Date(`${toKey}T23:59:59Z`)).toISOString();
  const [allocations, oneOffs] = await Promise.all([loadAllocations(db, orgId, venueId), loadOneOffs(db, orgId, venueId, fromIso, toIso)]);
  return { allocations, oneOffs };
}

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------
export async function saveAllocation(id: string | null, input: Record<string, unknown>, force = false): Promise<OpsResult<{ id: string }> | ConflictResult> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(allocationSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { timeZone } = await getLocaleContext(me.orgId);
  if (!force) {
    const today = zonedDayKey(new Date(), timeZone);
    const from = v.validFrom > today ? v.validFrom : today;
    const horizon = addDayKey(from, 7 * 26);
    const to = v.validUntil && v.validUntil < horizon ? v.validUntil : horizon;
    const names = await teamNames(db, me.orgId);
    const candidate = toAllocation({
      id: id ?? "new", org_id: me.orgId, venue_id: v.venueId, venue_space_id: v.spaceId, team_id: v.teamId, label: v.label, weekday: v.weekday,
      start_time: v.startTime, end_time: v.endTime, valid_from: v.validFrom, valid_until: v.validUntil, is_active: true, notes: null,
      created_by: null, created_at: "", updated_at: "",
    }, names);
    const existing = await occupancy(db, me.orgId, v.venueId, from, to, timeZone);
    // A team's own generated trainings are not a clash with its allocation.
    const ownTeamLabel = v.teamId ? names.get(v.teamId) : null;
    const oneOffs = existing.oneOffs.filter((o) => !(o.kind === "event" && ownTeamLabel && o.label.startsWith(ownTeamLabel)));
    const conflicts = findCourtConflicts({ allocation: candidate }, { allocations: existing.allocations, oneOffs }, timeZone);
    if (conflicts.length) return { ok: false, error: t("operations.errors.courtConflict", { count: conflicts.length }), conflicts };
  }
  const row = {
    venue_id: v.venueId, venue_space_id: v.spaceId, team_id: v.teamId, label: v.label, weekday: v.weekday, start_time: v.startTime,
    end_time: v.endTime, valid_from: v.validFrom, valid_until: v.validUntil, notes: v.notes,
  };
  const res = id
    ? await db.from("facility_allocations").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("facility_allocations").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "facility.allocation.update" : "facility.allocation.create", "facility_allocations", res.data[0].id, { forced: force });
  revalidateFacilities();
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

export async function deleteAllocation(id: string): Promise<OpsResult> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data, error } = await db.from("facility_allocations").update({ is_active: false }).eq("id", id).eq("org_id", me.orgId).select("id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, "facility.allocation.end", "facility_allocations", id);
  revalidateFacilities();
  return { ok: true, message: t("operations.messages.deleted") };
}

/** Put a team's weekly court time on the schedule as training events. */
export async function generateEventsFromAllocation(input: Record<string, unknown>): Promise<OpsResult<{ created: number; skipped: number }>> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(generateEventsSchema, input, t);
  if (!p.ok) return p;
  const db = await opsDb();
  const { data: a } = await db.from("facility_allocations").select("*").eq("id", p.data.allocationId).eq("org_id", me.orgId).maybeSingle();
  if (!a || !a.team_id) return fail(t, "operations.errors.teamRequired");
  const { data: team } = await db.from("teams").select("id,season_id").eq("id", a.team_id).eq("org_id", me.orgId).maybeSingle();
  if (!team) return fail(t, "operations.errors.notFound");
  const { timeZone } = await getLocaleContext(me.orgId);
  const slots = expandAllocations([toAllocation(a, new Map())], p.data.from, p.data.to, timeZone);
  if (slots.length > 120) return fail(t, "operations.errors.tooMany");
  const { data: existing } = await db.from("events").select("starts_at").eq("org_id", me.orgId).eq("team_id", a.team_id)
    .gte("starts_at", slots[0]?.start ?? new Date().toISOString()).lte("starts_at", slots[slots.length - 1]?.start ?? new Date().toISOString());
  const have = new Set((existing ?? []).map((e) => Date.parse(e.starts_at)));
  let created = 0;
  let skipped = 0;
  for (const s of slots) {
    if (have.has(Date.parse(s.start))) {
      skipped += 1;
      continue;
    }
    const { error } = await db.from("events").insert({
      org_id: me.orgId, team_id: a.team_id, season_id: team.season_id, type: "training", venue_id: a.venue_id, venue_space_id: a.venue_space_id,
      starts_at: s.start, ends_at: s.end, status: "scheduled", created_by: me.id,
    });
    if (error) skipped += 1;
    else created += 1;
  }
  await writeAudit(me, "facility.allocation.generate_events", "facility_allocations", a.id, { created, skipped, from: p.data.from, to: p.data.to });
  revalidateFacilities(`/admin/teams/${a.team_id}`);
  return { ok: true, message: t("operations.messages.eventsGenerated", { created, skipped }), data: { created, skipped } };
}

// ---------------------------------------------------------------------------
// External customers + rentals
// ---------------------------------------------------------------------------
export async function saveCustomer(id: string | null, input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(customerSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const row = {
    kind: v.kind, name: v.name, contact_name: v.contactName, email: v.email, phone: v.phone, street: v.street, postal_code: v.postalCode,
    city: v.city, country: v.country, notes: v.notes,
  };
  const db = await opsDb();
  const res = id
    ? await db.from("ops_customers").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("ops_customers").insert({ ...row, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "customer.update" : "customer.create", "ops_customers", res.data[0].id, { kind: v.kind });
  revalidatePath("/admin/operations/customers");
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

export async function saveRental(id: string | null, input: Record<string, unknown>, force = false): Promise<OpsResult<{ id: string }> | ConflictResult> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (id && !uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const p = parseInput(rentalSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const { timeZone, currency } = await getLocaleContext(me.orgId);
  const start = zonedWallTimeToUtc(v.date, v.startTime, timeZone);
  const end = zonedWallTimeToUtc(v.date, v.endTime, timeZone);
  if (!start || !end || end <= start) return fail(t, "operations.errors.timeOrder");
  const db = await opsDb();
  if (!force && v.status !== "cancelled") {
    const existing = await occupancy(db, me.orgId, v.venueId, v.date, v.date, timeZone);
    const candidate: OneOff = { id: id ?? "new", kind: "rental", venueId: v.venueId, spaceId: v.spaceId, label: v.renterName, start: start.toISOString(), end: end.toISOString() };
    const conflicts = findCourtConflicts({ oneOff: candidate }, existing, timeZone);
    if (conflicts.length) return { ok: false, error: t("operations.errors.courtConflict", { count: conflicts.length }), conflicts };
  }
  const row = {
    venue_id: v.venueId, venue_space_id: v.spaceId, customer_id: v.customerId, renter_name: v.renterName, contact_email: v.contactEmail,
    contact_phone: v.contactPhone, starts_at: start.toISOString(), ends_at: end.toISOString(), price: v.price, status: v.status, notes: v.notes,
  };
  const res = id
    ? await db.from("facility_rentals").update(row).eq("id", id).eq("org_id", me.orgId).select("id")
    : await db.from("facility_rentals").insert({ ...row, currency, org_id: me.orgId, created_by: me.id }).select("id");
  if (res.error) return dbFail(t, res.error.message);
  if (!res.data?.length) return fail(t, "operations.errors.notFound");
  await writeAudit(me, id ? "facility.rental.update" : "facility.rental.create", "facility_rentals", res.data[0].id, { price: v.price, status: v.status, forced: force });
  revalidateFacilities();
  return { ok: true, message: t("operations.messages.saved"), data: { id: res.data[0].id } };
}

/** Invoice a rental to its external customer (created from the renter when missing). */
export async function invoiceRental(id: string): Promise<OpsResult<{ invoiceId: string }>> {
  const { me, t } = await gate(["admin", "finance"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data: r } = await db.from("facility_rentals").select("*").eq("id", id).eq("org_id", me.orgId).maybeSingle();
  if (!r) return fail(t, "operations.errors.notFound");
  if (r.invoice_id) return fail(t, "operations.errors.alreadyInvoiced");
  if (r.status === "cancelled" || r.price <= 0) return fail(t, "operations.errors.nothingToInvoice");
  let customerId = r.customer_id;
  if (!customerId) {
    const ins = await db.from("ops_customers").insert({ org_id: me.orgId, kind: "organization", name: r.renter_name, email: r.contact_email?.toLowerCase() ?? null, phone: r.contact_phone, created_by: me.id }).select("id");
    if (ins.error || !ins.data?.length) return dbFail(t, ins.error?.message);
    customerId = ins.data[0].id;
    await db.from("facility_rentals").update({ customer_id: customerId }).eq("id", id).eq("org_id", me.orgId);
  }
  const { f } = await getI18n(me.orgId);
  const { data: venue } = await db.from("venues").select("name").eq("id", r.venue_id).eq("org_id", me.orgId).maybeSingle();
  const line = t("operations.rentals.invoiceLine", { venue: venue?.name ?? "", when: f.dateRange(r.starts_at, r.ends_at) });
  const { data, error } = await db.rpc("ops_create_invoice", {
    p_customer: customerId, p_source: "rental", p_source_id: id, p_description: line, p_currency: r.currency,
    p_due_on: addDayKey(zonedDayKey(new Date(), f.timeZone), 30), p_lines: [{ description: line, quantity: 1, unit_price: r.price }] as unknown as Json,
  });
  const invoiceId = (data as { id?: string } | null)?.id;
  if (error || !invoiceId) return dbFail(t, error?.message);
  await db.from("facility_rentals").update({ invoice_id: invoiceId }).eq("id", id).eq("org_id", me.orgId);
  await writeAudit(me, "facility.rental.invoice", "facility_rentals", id, { invoice_id: invoiceId });
  revalidateFacilities();
  revalidatePath("/admin/operations/invoices");
  return { ok: true, message: t("operations.messages.invoiced"), data: { invoiceId } };
}

// ---------------------------------------------------------------------------
// Venue closures
// ---------------------------------------------------------------------------
export async function createClosure(input: Record<string, unknown>): Promise<OpsResult<{ id: string }>> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(closureSchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { data, error } = await db.from("venue_closures").insert({
    org_id: me.orgId, venue_id: v.venueId, venue_space_id: v.spaceId, starts_on: v.startsOn, ends_on: v.endsOn, reason: v.reason, note: v.note, created_by: me.id,
  }).select("id");
  if (error || !data?.length) return dbFail(t, error?.message);
  await writeAudit(me, "facility.closure.create", "venue_closures", data[0].id, { reason: v.reason, starts_on: v.startsOn, ends_on: v.endsOn });
  revalidateFacilities();
  return { ok: true, message: t("operations.messages.saved"), data: { id: data[0].id } };
}

export async function deleteClosure(id: string): Promise<OpsResult> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  if (!uuid.safeParse(id).success) return fail(t, "operations.errors.notFound");
  const db = await opsDb();
  const { data, error } = await db.from("venue_closures").delete().eq("id", id).eq("org_id", me.orgId).is("applied_at", null).select("id");
  if (error) return dbFail(t, error.message);
  if (!data?.length) return fail(t, "operations.errors.closureApplied");
  await writeAudit(me, "facility.closure.delete", "venue_closures", id);
  revalidateFacilities();
  return { ok: true, message: t("operations.messages.deleted") };
}

/**
 * One step for a closure: cancel, move by N days or relocate the selected
 * items, then notify every affected team, programme and camp (club alerts,
 * which reach families and coaches by their preferences) plus the families
 * and coaches of affected training bookings and sessions.
 */
export async function applyClosure(input: Record<string, unknown>): Promise<OpsResult<{ changed: number; skipped: number; notified: number }>> {
  const { me, t } = await gate(["admin"]);
  if (!me) return fail(t, "operations.errors.forbidden");
  const p = parseInput(closureApplySchema, input, t);
  if (!p.ok) return p;
  const v = p.data;
  const db = await opsDb();
  const { data: c } = await db.from("venue_closures").select("*").eq("id", v.closureId).eq("org_id", me.orgId).maybeSingle();
  if (!c) return fail(t, "operations.errors.notFound");
  const { t: tt, f } = await getI18n(me.orgId);
  const tz = f.timeZone;
  const impact = await loadClosureImpact(db, me.orgId, { venueId: c.venue_id, spaceId: c.venue_space_id, startsOn: c.starts_on, endsOn: c.ends_on }, tz);
  const affected = new Map(impact.items.map((i) => [`${i.kind}:${i.id}`, i]));
  let target: { id: string; name: string } | null = null;
  if (v.op === "relocate") {
    const { data: tv } = await db.from("venues").select("id,name").eq("id", v.targetVenueId as string).eq("org_id", me.orgId).maybeSingle();
    if (!tv || tv.id === c.venue_id) return fail(t, "operations.errors.targetVenue");
    target = tv;
  }
  const reasonText = tt.dynamic(`operations.closures.reasons.${c.reason}`);
  const supabase = await createClient();
  let changed = 0;
  let skipped = 0;
  for (const sel of v.items) {
    const item = affected.get(`${sel.kind}:${sel.id}`);
    if (!item || v.op === "notify_only") {
      if (!item) skipped += 1;
      continue;
    }
    let error: { message: string } | null = null;
    let done = true;
    const days = v.shiftDays ?? 0;
    if (sel.kind === "event") {
      const patch = v.op === "cancel"
        ? { status: "cancelled", cancel_reason: reasonText.slice(0, 500), cancelled_at: new Date().toISOString(), cancelled_by: me.id }
        : v.op === "shift" ? { starts_at: shiftByDays(item.start, days, tz), ends_at: shiftByDays(item.end, days, tz) }
        : { venue_id: target!.id, venue_space_id: null };
      ({ error } = await db.from("events").update(patch).eq("id", sel.id).eq("org_id", me.orgId));
    } else if (sel.kind === "session") {
      if (v.op === "cancel") done = false;
      else {
        const patch = v.op === "shift" ? { starts_at: shiftByDays(item.start, days, tz), ends_at: shiftByDays(item.end, days, tz) } : { location: target!.name };
        ({ error } = await db.from("program_sessions").update(patch).eq("id", sel.id).eq("org_id", me.orgId));
      }
    } else if (sel.kind === "camp") {
      if (v.op === "cancel") done = false;
      else {
        const patch = v.op === "shift" ? { starts_on: shiftByDays(item.start, days, tz), ends_on: shiftByDays(item.end, days, tz) } : { venue_id: target!.id };
        ({ error } = await db.from("camp_editions").update(patch).eq("id", sel.id).eq("org_id", me.orgId));
      }
    } else if (sel.kind === "booking") {
      if (v.op === "shift") done = false;
      else if (v.op === "cancel") ({ error } = await supabase.rpc("admin_cancel_booking", { p_booking: sel.id, p_reason: reasonText }));
      else ({ error } = await db.from("training_bookings").update({ venue_id: target!.id }).eq("id", sel.id).eq("org_id", me.orgId));
    } else if (sel.kind === "rental") {
      const patch = v.op === "cancel" ? { status: "cancelled" }
        : v.op === "shift" ? { starts_at: shiftByDays(item.start, days, tz), ends_at: shiftByDays(item.end, days, tz) }
        : { venue_id: target!.id, venue_space_id: null };
      ({ error } = await db.from("facility_rentals").update(patch).eq("id", sel.id).eq("org_id", me.orgId));
    }
    if (!done || error) {
      if (error) logError("operations.closure.apply", error, { kind: sel.kind });
      skipped += 1;
    } else changed += 1;
  }

  // ---- Notify (one alert per affected team / programme / camp edition) ----
  let notified = 0;
  if (v.notify) {
    const { data: venue } = await db.from("venues").select("name").eq("id", c.venue_id).eq("org_id", me.orgId).maybeSingle();
    const opText = tt.dynamic(`operations.closures.opNotice.${v.op}`, { days: Math.abs(v.shiftDays ?? 0), venue: target?.name ?? "" });
    const title = tt("operations.closures.alertTitle", { venue: venue?.name ?? "", from: f.date(c.starts_on), to: f.date(c.ends_on) }).slice(0, 140);
    const body = [reasonText, opText, v.message].filter(Boolean).join("\n\n").slice(0, 2000);
    const expires = (zonedWallTimeToUtc(addDayKey(c.ends_on, 1), "00:00", tz) ?? new Date(Date.now() + 30 * 864e5)).toISOString();
    const scopes = [
      ...impact.teamIds.map((id) => ({ audience: "team" as const, team_id: id })),
      ...impact.programIds.filter((id) => !impact.items.some((i) => i.kind === "camp" && i.programId === id)).map((id) => ({ audience: "program" as const, program_id: id })),
      ...impact.campEditionIds.map((id) => ({ audience: "camp_edition" as const, camp_edition_id: id })),
    ];
    const alerts: AlertRow[] = [];
    for (const s of scopes) {
      const { data, error } = await db.from("club_alerts").insert({
        org_id: me.orgId, title, body, severity: c.reason === "emergency" ? "urgent" : "warning", starts_at: new Date().toISOString(),
        expires_at: expires, created_by: me.id, team_id: null, program_id: null, camp_edition_id: null, ...s,
      }).select("*").single();
      if (error || !data) logError("operations.closure.alert", error);
      else alerts.push(data as AlertRow);
    }
    after(async () => {
      for (const a of alerts) await dispatchAlert(a).catch((e) => logError("operations.closure.dispatch", e));
    });
    // Bookings and sessions have no alert audience: notify their families / coaches directly.
    const direct = impact.items.filter((i) => i.kind === "booking" || i.kind === "session");
    const profiles = [
      ...(await guardianProfileIds(me.orgId, direct.map((i) => i.athleteId).filter((x): x is string => !!x))),
      ...(await coachProfileIds(me.orgId, direct.flatMap((i) => i.coachIds ?? []))),
    ];
    const sent = await notifyProfiles(me.orgId, profiles, (lt, lf) => ({
      title: lt("operations.closures.alertTitle", { venue: venue?.name ?? "", from: lf.date(c.starts_on), to: lf.date(c.ends_on) }),
      body: [lt.dynamic(`operations.closures.reasons.${c.reason}`), lt.dynamic(`operations.closures.opNotice.${v.op}`, { days: Math.abs(v.shiftDays ?? 0), venue: target?.name ?? "" })].join(" · "),
      link: null,
    }), "practice");
    notified = alerts.length + sent;
  }

  const summary = { op: v.op, changed, skipped, notified, counts: impact.counts, shift_days: v.shiftDays, target_venue_id: target?.id ?? null };
  await db.from("venue_closures").update({
    applied_at: v.op === "notify_only" && c.applied_at ? c.applied_at : new Date().toISOString(),
    notified_at: v.notify ? new Date().toISOString() : c.notified_at, summary: summary as unknown as Json,
  }).eq("id", c.id).eq("org_id", me.orgId);
  await writeAudit(me, "facility.closure.apply", "venue_closures", c.id, summary);
  revalidateFacilities(`/admin/operations/facilities/closures/${c.id}`);
  revalidatePath("/admin/alerts");
  return { ok: true, message: t("operations.messages.closureApplied", { changed, skipped, notified }), data: { changed, skipped, notified } };
}
