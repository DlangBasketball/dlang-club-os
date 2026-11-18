import "server-only";
import { logError } from "@/lib/log";
import { getOrgEmailContext } from "@/lib/email/org-context";
import { caAdminDb } from "./db";
import { familyRecipients, sendNotice } from "./notify";

/**
 * Waiting-list engine glue: run public.waitlist_process() (service) and email
 * every new offer with its time-limited acceptance link. Used by the admin
 * actions, by registration cancellations and by the club-admin cron.
 */
type Offer = { entry_id: string; token: string; expires_at: string };

export async function offerLinkFor(orgId: string, token: string): Promise<string> {
  const org = await getOrgEmailContext(orgId);
  return org.link(`/waitlist/${token}`);
}

/** Target name + child first name for the emails (no other personal data). */
async function describe(entryId: string): Promise<{ orgId: string; familyId: string; name: string; child: string } | null> {
  const db = caAdminDb();
  const { data: e } = await db.from("waitlist_entries").select("org_id,family_id,athlete_id,program_id,service_id,target_kind").eq("id", entryId).maybeSingle();
  if (!e) return null;
  const [{ data: a }, prog] = await Promise.all([
    db.from("athletes").select("first_name").eq("id", e.athlete_id).maybeSingle(),
    e.target_kind === "training_slot"
      ? db.from("training_services").select("name").eq("id", e.service_id ?? "").maybeSingle()
      : db.from("programs").select("name").eq("id", e.program_id ?? "").maybeSingle(),
  ]);
  return {
    orgId: e.org_id, familyId: e.family_id,
    name: (prog.data as { name?: string } | null)?.name ?? "",
    child: (a as { first_name?: string } | null)?.first_name ?? "",
  };
}

export async function notifyOffers(offers: Offer[]): Promise<number> {
  let n = 0;
  for (const o of offers) {
    try {
      const d = await describe(o.entry_id);
      if (!d) continue;
      n += await sendNotice({
        orgId: d.orgId, kind: "waitlistOffer", recipients: await familyRecipients(d.orgId, d.familyId),
        params: { name: d.name, child: d.child, date: o.expires_at, dateTime: true },
        link: await offerLinkFor(d.orgId, o.token),
      });
    } catch (e) {
      logError("clubadmin.waitlist.notify", e);
    }
  }
  return n;
}

/**
 * Expire overdue offers and offer free spots (one list, one club or every
 * club). `forceEntry`: an admin offers that entry now. Never throws.
 */
export async function processWaitlists(opts: { orgId?: string | null; targetKey?: string | null; forceEntry?: string | null } = {}): Promise<{ offers: number; error?: string }> {
  const { data, error } = await caAdminDb().rpc("waitlist_process", {
    p_org: opts.orgId ?? null, p_target_key: opts.targetKey ?? null, p_force_entry: opts.forceEntry ?? null,
  });
  if (error) {
    logError("clubadmin.waitlist.process", error);
    return { offers: 0, error: error.message };
  }
  const offers = (Array.isArray(data) ? data : []) as unknown as Offer[];
  await notifyOffers(offers);
  return { offers: offers.length };
}

/** After a registration was cancelled: refill the programme / camp week list. */
export async function refillAfterCancellation(orgId: string, registrationId: string): Promise<void> {
  try {
    const { data: r } = await caAdminDb().from("registrations").select("program_id,camp_edition_id").eq("id", registrationId).eq("org_id", orgId).maybeSingle();
    const reg = r as { program_id: string; camp_edition_id: string | null } | null;
    if (!reg) return;
    await processWaitlists({ orgId, targetKey: reg.camp_edition_id ? `e:${reg.camp_edition_id}` : `p:${reg.program_id}` });
  } catch (e) {
    logError("clubadmin.waitlist.refill", e);
  }
}
