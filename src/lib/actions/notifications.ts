"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function uid() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function markRead(id: string): Promise<{ ok: boolean }> {
  if (!(await uid())) return { ok: false };
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/parent/notifications");
  return { ok: true };
}

export async function markAllRead(): Promise<{ ok: boolean }> {
  if (!(await uid())) return { ok: false };
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  revalidatePath("/parent/notifications");
  return { ok: true };
}

export async function archiveNotification(id: string): Promise<{ ok: boolean }> {
  if (!(await uid())) return { ok: false };
  const supabase = await createClient();
  await supabase.from("notifications").update({ archived_at: new Date().toISOString(), read_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/parent/notifications");
  return { ok: true };
}
