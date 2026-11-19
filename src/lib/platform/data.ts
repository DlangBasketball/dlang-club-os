import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "./auth";
import {
  asPlatform,
  type BillingEventRow,
  type PlanPriceRow,
  type PlanRow,
  type PlatformAuditRow,
  type PlatformOrgRow,
  type SubscriptionRow,
  type TenantDomainRow,
  type TenantOverviewRow,
  type UsageSnapshotRow,
} from "./types";

export type PlanWithPrices = PlanRow & { prices: PlanPriceRow[] };

/** Public catalogue (RLS: active + public plans are readable by anyone). */
export async function getPublicPlans(): Promise<PlanWithPrices[]> {
  const db = asPlatform(await createClient());
  const [{ data: plans }, { data: prices }] = await Promise.all([
    db.from("plans").select("*").eq("is_public", true).eq("is_active", true).order("sort_order"),
    db.from("plan_prices").select("*"),
  ]);
  return ((plans ?? []) as PlanRow[]).map((p) => ({
    ...p,
    prices: ((prices ?? []) as PlanPriceRow[]).filter((x) => x.plan_code === p.code),
  }));
}

/** Every plan incl. hidden/inactive (platform admins; enforced by RLS too). */
export async function getAllPlans(): Promise<PlanWithPrices[]> {
  await requirePlatformAdmin();
  const db = asPlatform(await createClient());
  const [{ data: plans }, { data: prices }] = await Promise.all([
    db.from("plans").select("*").order("sort_order"),
    db.from("plan_prices").select("*"),
  ]);
  return ((plans ?? []) as PlanRow[]).map((p) => ({
    ...p,
    prices: ((prices ?? []) as PlanPriceRow[]).filter((x) => x.plan_code === p.code),
  }));
}

export async function getTenantOverview(): Promise<TenantOverviewRow[]> {
  await requirePlatformAdmin();
  const db = asPlatform(await createClient());
  const { data, error } = await db.rpc("platform_tenant_overview");
  if (error) throw new Error(error.message);
  return ((data ?? []) as TenantOverviewRow[]).map((r) => ({
    ...r,
    athletes: Number(r.athletes ?? 0),
    staff: Number(r.staff ?? 0),
    mrr: Number(r.mrr ?? 0),
  }));
}

export type TenantDetail = {
  org: PlatformOrgRow;
  subscription: SubscriptionRow | null;
  plan: PlanRow | null;
  usage: UsageSnapshotRow[];
  domains: TenantDomainRow[];
  billingEvents: BillingEventRow[];
  audit: PlatformAuditRow[];
  config: {
    currency: string | null;
    defaultLocale: string | null;
    paymentMethods: string[];
    invoicePattern: string | null;
    brand: Record<string, unknown> | null;
    profile: Record<string, unknown> | null;
    settingsKeys: string[];
  } | null;
  staff: { profileId: string; name: string | null; email: string; roles: string[]; lastActive: string | null }[];
  counts: { athletes: number; families: number; programs: number; invoices: number; coaches: number };
};

/**
 * Support view of one tenant (read-only, impersonation-free).
 * Platform tables are read under the operator's session (RLS: platform admin).
 * Tenant-internal config/counts are read with the service role AFTER the
 * server-side platform-admin check, and only a whitelisted subset of
 * app_settings is exposed (no bank details / secrets).
 */
export async function getTenantDetail(orgId: string): Promise<TenantDetail | null> {
  await requirePlatformAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return null;
  const db = asPlatform(await createClient());

  const [{ data: org }, { data: sub }, { data: usage }, { data: domains }, { data: events }, { data: audit }] =
    await Promise.all([
      db.from("organizations").select("*").eq("id", orgId).maybeSingle(),
      db.from("subscriptions").select("*").eq("org_id", orgId).maybeSingle(),
      db.from("usage_snapshots").select("*").eq("org_id", orgId).order("captured_on", { ascending: false }).limit(30),
      db.from("tenant_domains").select("*").eq("org_id", orgId).order("created_at"),
      db.from("billing_events").select("*").eq("org_id", orgId).order("received_at", { ascending: false }).limit(20),
      db.from("platform_audit_log").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(30),
    ]);
  if (!org) return null;

  let plan: PlanRow | null = null;
  if (sub?.plan_code) {
    const { data } = await db.from("plans").select("*").eq("code", sub.plan_code).maybeSingle();
    plan = (data as PlanRow | null) ?? null;
  }

  const svc = createAdminClient();
  const head = { count: "exact" as const, head: true };
  const [settingsRes, rolesRes, athletes, families, programs, invoices, coaches] = await Promise.all([
    svc.from("app_settings").select("*").eq("org_id", orgId).maybeSingle(),
    svc.from("staff_roles").select("profile_id, role").eq("org_id", orgId),
    svc.from("athletes").select("id", head).eq("org_id", orgId).neq("status", "archived"),
    svc.from("families").select("id", head).eq("org_id", orgId),
    svc.from("programs").select("id", head).eq("org_id", orgId),
    svc.from("invoices").select("id", head).eq("org_id", orgId),
    svc.from("coaches").select("id", head).eq("org_id", orgId),
  ]);

  const roleRows = (rolesRes.data ?? []) as { profile_id: string; role: string }[];
  const profileIds = Array.from(new Set(roleRows.map((r) => r.profile_id)));
  const { data: profiles } = profileIds.length
    ? await svc.from("profiles").select("id, full_name, email, updated_at").in("id", profileIds)
    : { data: [] as { id: string; full_name: string | null; email: string; updated_at: string }[] };

  const s = settingsRes.data;
  const settingsObj = (s?.settings ?? {}) as Record<string, unknown>;
  const pickObj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

  return {
    org: org as PlatformOrgRow,
    subscription: (sub as SubscriptionRow | null) ?? null,
    plan,
    usage: (usage ?? []) as UsageSnapshotRow[],
    domains: (domains ?? []) as TenantDomainRow[],
    billingEvents: (events ?? []) as BillingEventRow[],
    audit: (audit ?? []) as PlatformAuditRow[],
    config: s
      ? {
          currency: s.currency,
          defaultLocale: s.default_locale,
          paymentMethods: s.payment_methods ?? [],
          invoicePattern: s.invoice_pattern,
          brand: pickObj(settingsObj.brand),
          profile: pickObj(settingsObj.profile),
          settingsKeys: Object.keys(settingsObj).sort(),
        }
      : null,
    staff: (profiles ?? []).map((p) => ({
      profileId: p.id,
      name: p.full_name,
      email: p.email,
      roles: roleRows.filter((r) => r.profile_id === p.id).map((r) => r.role),
      lastActive: p.updated_at ?? null,
    })),
    counts: {
      athletes: athletes.count ?? 0,
      families: families.count ?? 0,
      programs: programs.count ?? 0,
      invoices: invoices.count ?? 0,
      coaches: coaches.count ?? 0,
    },
  };
}
