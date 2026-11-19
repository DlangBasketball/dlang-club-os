import "server-only";
import { logError } from "@/lib/log";
import type { SessionUser } from "@/lib/auth/get-user";
import { msgAdminDb, msgDb, type AlertRow, type ContactRow, type InboxRow, type LeadReplyRow, type LeadRow, type PeopleRow } from "./db";
import { ATTACHMENT_BUCKET, ATTACHMENT_URL_TTL, type ChannelScope } from "./validation";
import { parseChannels, type ChannelPrefs } from "./preferences";

/**
 * Server reads for the message board, alerts and the new-contacts inbox.
 * Everything goes through the signed-in user's RLS client except scope lists
 * for coaches (explicitly filtered by org and coach) — so a page can never
 * show more than the database lets the user see.
 */

export type InboxItem = InboxRow;

export async function getInbox(all = false): Promise<{ items: InboxItem[]; error: boolean }> {
  const db = await msgDb();
  const { data, error } = await db.rpc("msg_inbox", { p_all: all, p_limit: 200 });
  if (error) {
    logError("messaging.inbox", error);
    return { items: [], error: true };
  }
  return { items: (data ?? []) as InboxItem[], error: false };
}

/** Total unread messages across the caller's threads (nav badge). */
export async function getUnreadMessageCount(): Promise<number> {
  const { items } = await getInbox(false);
  return items.reduce((n, i) => n + (i.unread ?? 0), 0);
}

export type ThreadMessage = {
  id: string;
  senderId: string | null;
  body: string;
  createdAt: string;
  hiddenAt: string | null;
  hiddenReason: string | null;
  mine: boolean;
  attachments: { id: string; name: string; mime: string; size: number; url: string | null }[];
  openReports: number;
};

export type ThreadView = {
  id: string;
  kind: "direct" | "channel";
  subject: string | null;
  status: "open" | "closed";
  office: boolean;
  sensitive: boolean;
  allowReplies: boolean;
  familyName: string | null;
  scopeName: string | null;
  canPost: boolean;
  isMember: boolean;
  muted: boolean;
  readReceipts: boolean;
  people: PeopleRow[];
  messages: ThreadMessage[];
};

/** One thread the caller may read (null otherwise); marks it read for the caller. */
export async function getThread(id: string, me: SessionUser): Promise<ThreadView | null> {
  const db = await msgDb();
  const { data: conv } = await db.from("msg_conversations").select("*").eq("id", id).maybeSingle();
  if (!conv) return null;
  const [msgs, people, atts, canPost, member, settings, family, scope, mine] = await Promise.all([
    db.from("msg_messages").select("*").eq("conversation_id", id).order("created_at", { ascending: true }).limit(500),
    db.rpc("msg_people", { p_conv: id }),
    db.from("msg_attachments").select("*").eq("conversation_id", id),
    db.rpc("msg_can_post", { p_conv: id }),
    db.rpc("msg_is_member", { p_conv: id }),
    db.from("messaging_settings").select("read_receipts").eq("org_id", conv.org_id).maybeSingle(),
    conv.family_id ? db.from("families").select("name").eq("id", conv.family_id).maybeSingle() : Promise.resolve({ data: null }),
    scopeName(conv.team_id, conv.program_id, conv.camp_edition_id),
    db.from("msg_participants").select("muted").eq("conversation_id", id).eq("profile_id", me.id).maybeSingle(),
  ]);
  const isAdmin = me.roles.includes("admin");
  let reports = new Map<string, number>();
  if (isAdmin) {
    const { data } = await db.from("msg_reports").select("message_id").eq("conversation_id", id).eq("status", "open");
    reports = (data ?? []).reduce((m, r) => m.set(r.message_id, (m.get(r.message_id) ?? 0) + 1), new Map<string, number>());
  }
  const attRows = atts.data ?? [];
  const urls = new Map<string, string>();
  if (attRows.length) {
    const { data: signed } = await db.storage.from(ATTACHMENT_BUCKET).createSignedUrls(attRows.map((a) => a.storage_path), ATTACHMENT_URL_TTL);
    for (const s of signed ?? []) if (s.path && s.signedUrl && !s.error) urls.set(s.path, s.signedUrl);
  }
  const byMessage = new Map<string, ThreadMessage["attachments"]>();
  for (const a of attRows) {
    const list = byMessage.get(a.message_id) ?? [];
    list.push({ id: a.id, name: a.file_name, mime: a.mime_type, size: a.size_bytes, url: urls.get(a.storage_path) ?? null });
    byMessage.set(a.message_id, list);
  }
  // Reading the thread marks it read (members and admins).
  const { error: readErr } = await db.rpc("msg_mark_read", { p_conv: id });
  if (readErr) logError("messaging.markRead", readErr);

  return {
    id: conv.id,
    kind: conv.kind,
    subject: conv.subject,
    status: conv.status,
    office: conv.office,
    sensitive: conv.sensitive,
    allowReplies: conv.allow_replies,
    familyName: (family.data as { name: string } | null)?.name ?? null,
    scopeName: scope,
    canPost: canPost.data === true,
    isMember: member.data === true,
    muted: mine.data?.muted === true,
    readReceipts: settings.data?.read_receipts === true,
    people: (people.data ?? []) as PeopleRow[],
    messages: (msgs.data ?? []).map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      createdAt: m.created_at,
      hiddenAt: m.hidden_at,
      hiddenReason: m.hidden_reason,
      mine: m.sender_id === me.id,
      attachments: byMessage.get(m.id) ?? [],
      openReports: reports.get(m.id) ?? 0,
    })),
  };
}

async function scopeName(team: string | null, program: string | null, edition: string | null): Promise<string | null> {
  const db = await msgDb();
  if (team) return ((await db.from("teams").select("name").eq("id", team).maybeSingle()).data as { name: string } | null)?.name ?? null;
  if (program) return ((await db.from("programs").select("name").eq("id", program).maybeSingle()).data as { name: string } | null)?.name ?? null;
  if (edition) {
    const admin = msgAdminDb();
    const { data } = await admin.from("camp_editions").select("name,program_id,starts_on").eq("id", edition).maybeSingle();
    if (!data) return null;
    const prog = (await admin.from("programs").select("name").eq("id", data.program_id).maybeSingle()).data as { name: string } | null;
    return [prog?.name, data.name ?? data.starts_on].filter(Boolean).join(" · ");
  }
  return null;
}

export async function getContacts(): Promise<ContactRow[]> {
  const db = await msgDb();
  const { data, error } = await db.rpc("msg_contacts");
  if (error) logError("messaging.contacts", error);
  return ((data ?? []) as ContactRow[]).sort((a, b) => (a.display_name ?? "").localeCompare(b.display_name ?? ""));
}

/** The caller's own families (a guardian picks which family a thread is about). */
export async function getMyFamilies(me: SessionUser): Promise<{ id: string; name: string }[]> {
  if (!me.orgId) return [];
  const db = await msgDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", me.id);
  const ids = (links ?? []).map((l) => l.family_id as string);
  if (!ids.length) return [];
  const { data } = await db.from("families").select("id,name").in("id", ids).eq("org_id", me.orgId).order("name");
  return (data ?? []) as { id: string; name: string }[];
}

export type ScopeOption = { scope: ChannelScope; id: string; label: string };

/** Teams / programmes / camp editions the caller may address (channels, alerts). */
export async function getScopeOptions(me: SessionUser): Promise<ScopeOption[]> {
  if (!me.orgId) return [];
  const admin = msgAdminDb();
  const orgId = me.orgId;
  const isAdmin = me.roles.includes("admin");
  let teamIds: string[] | null = null;
  let programIds: string[] | null = null;
  if (!isAdmin) {
    const { data: coach } = await admin.from("coaches").select("id").eq("org_id", orgId).eq("profile_id", me.id).maybeSingle();
    if (!coach) return [];
    const [{ data: tc }, { data: ps }] = await Promise.all([
      admin.from("team_coaches").select("team_id").eq("org_id", orgId).eq("coach_id", coach.id),
      admin.from("program_sessions").select("program_id").eq("org_id", orgId).eq("coach_id", coach.id),
    ]);
    teamIds = Array.from(new Set((tc ?? []).map((r) => r.team_id as string)));
    programIds = Array.from(new Set((ps ?? []).map((r) => r.program_id as string)));
  }
  const teamsQ = admin.from("teams").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name");
  const progQ = admin.from("programs").select("id,name").eq("org_id", orgId).eq("is_active", true).order("name");
  const edQ = admin.from("camp_editions").select("id,name,program_id,starts_on,status,archived_at").eq("org_id", orgId).is("archived_at", null).order("starts_on");
  const [{ data: teams }, { data: programs }, { data: editions }] = await Promise.all([
    teamIds ? (teamIds.length ? teamsQ.in("id", teamIds) : Promise.resolve({ data: [] })) : teamsQ,
    programIds ? (programIds.length ? progQ.in("id", programIds) : Promise.resolve({ data: [] })) : progQ,
    programIds ? (programIds.length ? edQ.in("program_id", programIds) : Promise.resolve({ data: [] })) : edQ,
  ]);
  const progName = new Map(((programs ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  if (editions?.length) {
    const missing = (editions as { program_id: string }[]).map((e) => e.program_id).filter((id) => !progName.has(id));
    if (missing.length) {
      const { data } = await admin.from("programs").select("id,name").eq("org_id", orgId).in("id", missing);
      for (const p of (data ?? []) as { id: string; name: string }[]) progName.set(p.id, p.name);
    }
  }
  return [
    ...((teams ?? []) as { id: string; name: string }[]).map((t) => ({ scope: "team" as const, id: t.id, label: t.name })),
    ...((programs ?? []) as { id: string; name: string }[]).map((p) => ({ scope: "program" as const, id: p.id, label: p.name })),
    ...((editions ?? []) as { id: string; name: string | null; program_id: string; starts_on: string; status: string }[])
      .filter((e) => e.status !== "cancelled")
      .map((e) => ({ scope: "camp_edition" as const, id: e.id, label: [progName.get(e.program_id), e.name ?? e.starts_on].filter(Boolean).join(" · ") })),
  ];
}

export type MessagingSettings = {
  parentsCanStart: boolean;
  parentRepliesInChannels: boolean;
  readReceipts: boolean;
  emailNotifications: boolean;
  quietStart: string | null;
  quietEnd: string | null;
};

export async function getMessagingSettings(orgId: string): Promise<MessagingSettings> {
  const db = await msgDb();
  const { data } = await db.from("messaging_settings").select("*").eq("org_id", orgId).maybeSingle();
  return {
    parentsCanStart: data?.parents_can_start ?? true,
    parentRepliesInChannels: data?.parent_replies_in_channels ?? true,
    readReceipts: data?.read_receipts ?? false,
    emailNotifications: data?.email_notifications ?? true,
    quietStart: data?.quiet_start?.slice(0, 5) ?? null,
    quietEnd: data?.quiet_end?.slice(0, 5) ?? null,
  };
}

export async function getMyPreferences(me: SessionUser): Promise<{ channels: ChannelPrefs; quietStart: string | null; quietEnd: string | null }> {
  const db = await msgDb();
  const { data } = await db.from("notification_preferences").select("*").eq("profile_id", me.id).maybeSingle();
  return { channels: parseChannels(data?.channels), quietStart: data?.quiet_start?.slice(0, 5) ?? null, quietEnd: data?.quiet_end?.slice(0, 5) ?? null };
}

export type ReportItem = { id: string; conversationId: string; messageId: string; reason: string; createdAt: string; excerpt: string | null; hidden: boolean };

/** Open abuse reports (admins). */
export async function getOpenReports(): Promise<ReportItem[]> {
  const db = await msgDb();
  const { data } = await db.from("msg_reports").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(50);
  const rows = data ?? [];
  if (!rows.length) return [];
  const { data: msgs } = await db.from("msg_messages").select("id,body,hidden_at").in("id", rows.map((r) => r.message_id));
  const byId = new Map((msgs ?? []).map((m) => [m.id, m]));
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    messageId: r.message_id,
    reason: r.reason,
    createdAt: r.created_at,
    excerpt: byId.get(r.message_id)?.body.slice(0, 200) ?? null,
    hidden: Boolean(byId.get(r.message_id)?.hidden_at),
  }));
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------
export type BannerAlert = { id: string; title: string; body: string | null; severity: AlertRow["severity"]; startsAt: string };

/** Live alerts aimed at the caller and not dismissed (banner). */
export async function getBannerAlerts(me: SessionUser): Promise<BannerAlert[]> {
  if (!me.orgId) return [];
  try {
    const db = await msgDb();
    const nowIso = new Date().toISOString();
    const [{ data: alerts }, { data: dismissed }] = await Promise.all([
      db.from("club_alerts").select("*").is("cancelled_at", null).lte("starts_at", nowIso).or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order("starts_at", { ascending: false }).limit(20),
      db.from("club_alert_dismissals").select("alert_id").eq("profile_id", me.id),
    ]);
    const hide = new Set((dismissed ?? []).map((d) => d.alert_id));
    const out: BannerAlert[] = [];
    for (const a of (alerts ?? []) as AlertRow[]) {
      if (hide.has(a.id)) continue;
      // Admins can read every alert; the banner only shows the ones aimed at them.
      const { data: forMe } = await db.rpc("club_alert_for_me", {
        p_audience: a.audience, p_team: a.team_id, p_program: a.program_id, p_edition: a.camp_edition_id,
      });
      if (forMe !== true && a.created_by !== me.id) continue;
      out.push({ id: a.id, title: a.title, body: a.body, severity: a.severity, startsAt: a.starts_at });
      if (out.length >= 3) break;
    }
    return out;
  } catch (e) {
    logError("messaging.banner", e);
    return [];
  }
}

export type AlertListItem = AlertRow & { scopeLabel: string | null; mine: boolean };

export async function listAlerts(me: SessionUser): Promise<AlertListItem[]> {
  const db = await msgDb();
  let q = db.from("club_alerts").select("*").order("starts_at", { ascending: false }).limit(100);
  if (!me.roles.includes("admin")) q = q.eq("created_by", me.id);
  const { data } = await q;
  const rows = (data ?? []) as AlertRow[];
  const scopes = await getScopeOptions(me);
  const label = new Map(scopes.map((s) => [s.id, s.label]));
  return rows.map((a) => ({ ...a, scopeLabel: label.get(a.team_id ?? a.program_id ?? a.camp_edition_id ?? "") ?? null, mine: a.created_by === me.id }));
}

// ---------------------------------------------------------------------------
// Leads (admins)
// ---------------------------------------------------------------------------
export async function listLeads(status?: LeadRow["status"] | "open"): Promise<LeadRow[]> {
  const db = await msgDb();
  let q = db.from("contact_leads").select("*").order("created_at", { ascending: false }).limit(200);
  if (status === "open") q = q.in("status", ["new", "replied"]);
  else if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) logError("messaging.leads", error);
  return (data ?? []) as LeadRow[];
}

export async function getLead(id: string): Promise<{ lead: LeadRow; replies: (LeadReplyRow & { authorName: string | null })[]; programName: string | null } | null> {
  const db = await msgDb();
  const { data: lead } = await db.from("contact_leads").select("*").eq("id", id).maybeSingle();
  if (!lead) return null;
  const [{ data: replies }, { data: program }] = await Promise.all([
    db.from("contact_lead_replies").select("*").eq("lead_id", id).order("created_at"),
    lead.program_id ? db.from("programs").select("name").eq("id", lead.program_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const authorIds = Array.from(new Set((replies ?? []).map((r) => r.author_id).filter((x): x is string => !!x)));
  const { data: authors } = authorIds.length ? await db.from("profiles").select("id,full_name").in("id", authorIds) : { data: [] };
  const names = new Map(((authors ?? []) as { id: string; full_name: string | null }[]).map((a) => [a.id, a.full_name]));
  return {
    lead: lead as LeadRow,
    replies: ((replies ?? []) as LeadReplyRow[]).map((r) => ({ ...r, authorName: r.author_id ? names.get(r.author_id) ?? null : null })),
    programName: (program as { name: string } | null)?.name ?? null,
  };
}

/** Admin notifications page: parent messages, employee messages and new contacts together. */
export async function getCommunicationOverview(): Promise<{ parent: InboxItem[]; staff: InboxItem[]; leads: LeadRow[]; reports: number }> {
  const db = await msgDb();
  const [{ items }, leads, { count }] = await Promise.all([
    getInbox(true),
    listLeads("new"),
    db.from("msg_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  const parent = items.filter((i) => i.has_family_side && (i.unread > 0 || (i.office && i.last_sender_side === "family")) && i.status === "open").slice(0, 8);
  const staff = items.filter((i) => !i.has_family_side && i.kind === "direct" && i.unread > 0).slice(0, 8);
  return { parent, staff, leads: leads.slice(0, 8), reports: count ?? 0 };
}
