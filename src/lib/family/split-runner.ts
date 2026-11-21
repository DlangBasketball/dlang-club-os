import "server-only";
import { logError } from "@/lib/log";
import { familyAdminDb, familyDb } from "./db";
import { notifyMembers } from "./notify";
import { orgsWithFeature } from "@/lib/upgrades/server";

const OPEN = ["draft", "pending", "sent", "overdue"] as const;
/** Only recent invoices are split automatically (older ones stay as issued). */
const LOOKBACK_DAYS = 60;

/**
 * Splits the open, never-paid invoices of one family by its billing split
 * (public.split_family_invoice does the work and refuses anything already
 * paid, linked to a payment plan / shop order / package, or adjusted).
 * `session: true` runs as the signed-in finance user, else as the service role.
 */
export async function splitOpenInvoicesForFamily(orgId: string, familyId: string, opts: { session?: boolean } = {}): Promise<{ split: number; skipped: number }> {
  const admin = familyAdminDb();
  const db = opts.session ? await familyDb() : admin;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 864e5).toISOString();
  const { data: fam } = await admin.from("families").select("id,billing_split_mode").eq("id", familyId).eq("org_id", orgId).maybeSingle();
  if ((fam as { billing_split_mode?: string } | null)?.billing_split_mode !== "split") return { split: 0, skipped: 0 };
  const { data: invoices } = await admin
    .from("invoices")
    .select("id,number")
    .eq("org_id", orgId)
    .eq("family_id", familyId)
    .is("split_group_id", null)
    .in("status", [...OPEN])
    .gte("created_at", since)
    .limit(100);
  let split = 0;
  let skipped = 0;
  for (const inv of invoices ?? []) {
    const { data, error } = await db.rpc("split_family_invoice", { p_invoice: inv.id });
    if (error) {
      skipped += 1;
      if (!/INVOICE_LINKED|INVOICE_NOT|ALREADY_SPLIT|FAMILY_NOT_SPLIT|SPLIT_NEEDS/.test(error.message)) logError("family.split", error);
      continue;
    }
    split += 1;
    const ids = data?.invoices ?? [];
    const { data: parts } = await admin.from("invoices").select("id,number,payer_profile_id").eq("org_id", orgId).in("id", ids);
    for (const part of parts ?? []) {
      if (!part.payer_profile_id) continue;
      await notifyMembers({
        orgId, profileIds: [part.payer_profile_id], category: "payments", type: "payment", app: "parent", tag: `split-${part.id}`,
        build: ({ t }) => ({
          title: t("family.push.split.title", { number: part.number }),
          body: t("family.push.split.body"),
          path: `/parent/invoices/${part.id}`,
        }),
      });
    }
  }
  return { split, skipped };
}

/** Cron: every family with a split, in every club. Service role. */
export async function splitAllOpenFamilyInvoices(): Promise<{ families: number; split: number }> {
  const admin = familyAdminDb();
  const { data: fams } = await admin.from("families").select("id,org_id").eq("billing_split_mode", "split").limit(2000);
  let split = 0;
  const splitBilling = await orgsWithFeature("split_billing");
  for (const f of (fams ?? []).filter((x) => splitBilling.has(x.org_id))) {
    const r = await splitOpenInvoicesForFamily(f.org_id, f.id);
    split += r.split;
  }
  return { families: fams?.length ?? 0, split };
}
