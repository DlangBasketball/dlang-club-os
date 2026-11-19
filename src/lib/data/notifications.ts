import { createClient } from "@/lib/supabase/server";

export type NavNotification = { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string };

/** Recent (non-archived) notifications + unread count for the header bell. */
export async function getNavNotifications(): Promise<{ items: NavNotification[]; unread: number }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { items: [], unread: 0 };
  const { data } = await supabase
    .from("notifications")
    .select("id,type,title,body,link,read_at,created_at")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(12);
  const items = (data ?? []).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, readAt: n.read_at, createdAt: n.created_at }));
  return { items, unread: items.filter((i) => !i.readAt).length };
}
