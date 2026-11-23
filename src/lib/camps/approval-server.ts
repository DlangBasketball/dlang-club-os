import "server-only";
import { randomUUID } from "node:crypto";
import { campsAdminDb } from "./db";
import type { PublicCamp } from "./data";
import { notifyAdminsOfRequest } from "./approval-notify";
import { storeRegistrationExtras, type ChildAnswers } from "@/lib/registration-form/server";
import type { RegistrationConfig } from "@/lib/registration-form/config";
import type { Json } from "@/types/database";
import { logError } from "@/lib/log";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ApprovalChild = {
  athleteId: string; name: string; ageGroupId: string; priceOptionId: string; days: string[]; answers: ChildAnswers["answers"];
};

/**
 * Parent app: children in the camp's age approval band, submitted for admin
 * review (camp_approval_submit, service role). The caller resolved the org,
 * the family and that the children are the signed-in guardian's own. A retry
 * with the same request id returns the same rows (no duplicate, no second
 * admin alert).
 */
export async function submitApprovalRequests(opts: {
  orgId: string; camp: PublicCamp; editionId: string; familyId: string; profileId: string; requestId?: string | null;
  ip: string | null; consents: string[]; config: RegistrationConfig; children: ApprovalChild[];
}): Promise<{ ok: true; registrationIds: string[]; replayed: boolean } | { ok: false; error: string }> {
  const requestId = opts.requestId && UUID.test(opts.requestId) ? opts.requestId : randomUUID();
  const payload = {
    program_id: opts.camp.program.id, edition_id: opts.editionId, family_id: opts.familyId, registered_by: opts.profileId,
    request_id: requestId, ip: opts.ip, consents: opts.consents,
    children: opts.children.map((c) => ({ athlete_id: c.athleteId, age_group_id: c.ageGroupId, price_option_id: c.priceOptionId, days: c.days })),
  };
  const { data, error } = await campsAdminDb().rpc("camp_approval_submit", { p_payload: payload as unknown as Json });
  if (error) {
    logError("camp.approval.submit", error);
    return { ok: false, error: error.message };
  }
  const r = (data ?? {}) as { registration_ids?: string[]; athlete_ids?: string[]; ages?: (number | null)[]; replayed?: boolean };
  const regIds = r.registration_ids ?? [];
  const athIds = r.athlete_ids ?? [];
  if (!r.replayed) {
    await storeRegistrationExtras(opts.orgId, opts.camp.program.id, opts.config, athIds
      .map((athleteId, i): ChildAnswers => ({ athleteId, registrationId: regIds[i], extras: {}, answers: opts.children.find((c) => c.athleteId === athleteId)?.answers ?? {} }))
      .filter((x) => x.athleteId && x.registrationId));
    const edition = opts.camp.editions.find((e) => e.id === opts.editionId);
    for (const [i, athleteId] of athIds.entries()) {
      await notifyAdminsOfRequest({
        orgId: opts.orgId, programName: opts.camp.program.name, childName: opts.children.find((c) => c.athleteId === athleteId)?.name ?? "",
        startsOn: edition?.startsOn ?? "", endsOn: edition?.endsOn ?? "", age: r.ages?.[i] ?? null,
      });
    }
  }
  return { ok: true, registrationIds: regIds, replayed: !!r.replayed };
}
