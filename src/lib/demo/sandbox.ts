import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import type { Database, Json } from "@/types/database";
import {
  DEMO_COOKIE,
  DEMO_ROLES,
  DEMO_TTL_HOURS,
  type DemoRole,
  demoLoginEmail,
  demoMaxPerHour,
  hashDemoToken,
  isWellFormedDemoToken,
  newDemoToken,
} from "./config";

/**
 * Prospect demo sandboxes (migration 20250420107000_demo_sandbox.sql).
 *
 * One prospect = one fictional club + five logins. The prospect's browser
 * holds a random token (httpOnly cookie); the database stores its SHA-256.
 * "Start as <role>" signs the browser in as that role's login with a one-time
 * magic-link token generated server-side (nothing is e-mailed). Every screen
 * then runs with the normal session, so RLS and RPC checks apply unchanged.
 */

type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type DemoSandboxRow = {
  id: string;
  org_id: string;
  token_hash: string;
  admin_profile_id: string | null;
  finance_profile_id: string | null;
  coach_profile_id: string | null;
  parent_profile_id: string | null;
  player_profile_id: string | null;
  status: "active" | "expired";
  reset_count: number;
  previous_org_ids: string[];
  expires_at: string;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

type Pub = Database["public"];
type DemoDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Pub["Tables"] & { demo_sandboxes: T<DemoSandboxRow> };
    Functions: Pub["Functions"] & {
      demo_sandbox_create: {
        Args: { p_token_hash: string; p_admin: string; p_finance: string; p_coach: string; p_parent: string; p_player: string; p_ttl_hours: number };
        Returns: Json;
      };
      demo_sandbox_reset: { Args: { p_sandbox: string }; Returns: Json };
      demo_sandbox_expire: { Args: Record<string, never>; Returns: string[] };
    };
  };
};
type DemoClient = SupabaseClient<DemoDatabase>;

/** Service role, server-only. Every query below filters by sandbox id / token hash. */
function demoAdminDb(): DemoClient {
  return createAdminClient() as unknown as DemoClient;
}

const PROFILE_COLUMN: Record<DemoRole, keyof DemoSandboxRow> = {
  admin: "admin_profile_id",
  finance: "finance_profile_id",
  coach: "coach_profile_id",
  parent: "parent_profile_id",
  player: "player_profile_id",
};

export type DemoSession = { sandbox: DemoSandboxRow; token: string };

export type DemoError = "busy" | "failed" | "expired";

function usable(s: DemoSandboxRow | null): s is DemoSandboxRow {
  return Boolean(s && s.status === "active" && new Date(s.expires_at).getTime() > Date.now());
}

/** The prospect's live sandbox from the cookie, or null (missing, unknown, expired). */
export async function currentDemoSession(): Promise<DemoSession | null> {
  const token = (await cookies()).get(DEMO_COOKIE)?.value;
  if (!isWellFormedDemoToken(token)) return null;
  const { data, error } = await demoAdminDb()
    .from("demo_sandboxes")
    .select("*")
    .eq("token_hash", hashDemoToken(token))
    .maybeSingle();
  if (error) {
    logError("demo.lookup", error);
    return null;
  }
  return usable(data) ? { sandbox: data, token } : null;
}

async function setDemoCookie(token: string) {
  (await cookies()).set(DEMO_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEMO_TTL_HOURS * 3600,
  });
}

/** Deletes the auth logins of expired sandboxes (best effort, never throws). */
async function sweepExpired(db: DemoClient) {
  try {
    const { data, error } = await db.rpc("demo_sandbox_expire");
    if (error) throw error;
    for (const id of (data ?? []) as string[]) {
      const { error: delErr } = await db.auth.admin.deleteUser(id);
      if (delErr) logError("demo.sweep.deleteUser", delErr, { id });
    }
  } catch (e) {
    logError("demo.sweep", e);
  }
}

/** Creates a sandbox for this browser: five fresh logins + a seeded club. */
async function createDemoSession(): Promise<DemoSession | DemoError> {
  const db = demoAdminDb();
  await sweepExpired(db);

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count, error: countErr } = await db
    .from("demo_sandboxes")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (countErr) {
    logError("demo.rateCount", countErr);
    return "failed";
  }
  if ((count ?? 0) >= demoMaxPerHour()) return "busy";

  const key = randomBytes(6).toString("hex");
  const ids: Partial<Record<DemoRole, string>> = {};
  try {
    for (const role of DEMO_ROLES) {
      const { data, error } = await db.auth.admin.createUser({
        email: demoLoginEmail(key, role),
        email_confirm: true,
        // Never used: demo sign-in goes through a server-generated one-time token.
        password: randomBytes(32).toString("base64url"),
        app_metadata: { demo_sandbox: true },
      });
      if (error || !data.user) throw error ?? new Error("createUser returned no user");
      ids[role] = data.user.id;
    }
    const token = newDemoToken();
    const { error } = await db.rpc("demo_sandbox_create", {
      p_token_hash: hashDemoToken(token),
      p_admin: ids.admin!,
      p_finance: ids.finance!,
      p_coach: ids.coach!,
      p_parent: ids.parent!,
      p_player: ids.player!,
      p_ttl_hours: DEMO_TTL_HOURS,
    });
    if (error) throw error;
    const { data: sandbox, error: readErr } = await db
      .from("demo_sandboxes")
      .select("*")
      .eq("token_hash", hashDemoToken(token))
      .single();
    if (readErr || !sandbox) throw readErr ?? new Error("sandbox not found after create");
    await setDemoCookie(token);
    return { sandbox, token };
  } catch (e) {
    logError("demo.create", e);
    for (const id of Object.values(ids)) if (id) await db.auth.admin.deleteUser(id).catch(() => undefined);
    return "failed";
  }
}

/** The live sandbox for this browser, created on first use. */
export async function ensureDemoSession(): Promise<DemoSession | DemoError> {
  return (await currentDemoSession()) ?? (await createDemoSession());
}

/**
 * Signs this browser in as one role of its sandbox. A one-time magic-link
 * token is generated with the service role and verified at once on the
 * server, which writes the normal session cookies. No e-mail is sent.
 */
export async function signInAsDemoRole(session: DemoSession, role: DemoRole): Promise<boolean> {
  const db = demoAdminDb();
  const profileId = session.sandbox[PROFILE_COLUMN[role]] as string | null;
  if (!profileId) return false;
  const { data: user, error: userErr } = await db.auth.admin.getUserById(profileId);
  const email = user?.user?.email;
  if (userErr || !email) {
    logError("demo.signIn.user", userErr ?? new Error("no email"), { role });
    return false;
  }
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    logError("demo.signIn.link", linkErr ?? new Error("no hashed_token"), { role });
    return false;
  }
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error) {
    logError("demo.signIn.verify", error, { role });
    return false;
  }
  await db.from("demo_sandboxes").update({ last_seen_at: new Date().toISOString() }).eq("id", session.sandbox.id);
  return true;
}

/** Restores the starting scenario of THIS prospect's sandbox only, and signs out. */
export async function resetDemoSession(session: DemoSession): Promise<boolean> {
  const { error } = await demoAdminDb().rpc("demo_sandbox_reset", { p_sandbox: session.sandbox.id });
  if (error) {
    logError("demo.reset", error);
    return false;
  }
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}
