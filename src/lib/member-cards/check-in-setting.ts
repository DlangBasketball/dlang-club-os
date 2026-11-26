import "server-only";
import { createClient } from "@/lib/supabase/server";

/**
 * Club decision "QR check-in with member cards" (default off, 20250420106900).
 * Off: cards show no QR, coaches get no scanner and the database refuses scans.
 */
export async function getCardCheckInEnabled(): Promise<boolean> {
  const db = (await createClient()) as unknown as { rpc: (fn: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  const { data, error } = await db.rpc("card_check_in_setting", {});
  return !error && data === true;
}
