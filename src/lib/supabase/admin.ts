import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Service-role client. BYPASSES RLS — server-only.
 * Used for privileged operations the user's session can't do, e.g.
 * auth.admin.inviteUserByEmail(). NEVER import this into a Client Component;
 * the service-role key must never reach the browser.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
