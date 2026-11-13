"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireRole, writeAudit, type ActionResult } from "@/lib/people/server";
import { logError } from "@/lib/log";
import { msgAdminDb, msgDb } from "@/lib/messaging/db";
import { notifyNewMessage } from "@/lib/messaging/notify";
import { appFor, MESSAGES_BASE, threadPath } from "@/lib/messaging/paths";
import { preferencesSchema, type PreferencesInput } from "@/lib/messaging/preferences";
import {
  ATTACHMENT_BUCKET,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  body as bodySchema,
  cleanFileName,
  hideSchema,
  messagingErrorKey,
  messagingSettingsSchema,
  reportSchema,
  sniffAttachmentType,
  startChannelSchema,
  startDirectSchema,
  uuid,
  type MessagingSettingsInput,
  type ReportInput,
  type StartChannelInput,
  type StartDirectInput,
} from "@/lib/messaging/validation";

/**
 * Message board server actions. The org always comes from the signed-in
 * user's profile; who may write where is decided by the database (RLS and
 * the msg_* RPCs), these actions validate input, audit the intent (never the
 * message text) and fan out notifications.
 */

const ANY = ["admin", "finance", "coach", "parent"] as ("admin" | "finance" | "coach" | "parent")[];

function revalidateMessaging(conversationId?: string) {
  for (const base of Object.values(MESSAGES_BASE)) {
    revalidatePath(base);
    if (conversationId) revalidatePath(`${base}/${conversationId}`);
  }
  revalidatePath("/admin/notifications");
}

export async function startDirectThread(input: StartDirectInput): Promise<ActionResult<{ id: string; path: string }>> {
  const { me, t } = await requireRole(ANY);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const p = startDirectSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("messaging.errors.invalid") };
  const db = await msgDb();
  const { data, error } = await db.rpc("msg_start_direct", {
    p_target: p.data.targetId,
    p_body: p.data.body,
    p_subject: p.data.subject,
    p_family: p.data.familyId,
    p_sensitive: p.data.sensitive,
  });
  if (error || !data) {
    logError("messaging.startDirect", error);
    return { ok: false, error: t.dynamic(messagingErrorKey(error?.message)) };
  }
  await writeAudit(me, "message.thread.start", "msg_conversations", data, { office: p.data.targetId === null });
  after(() => notifyNewMessage({ orgId: me.orgId, conversationId: data, senderId: me.id, body: p.data.body }));
  revalidateMessaging(data);
  return { ok: true, message: t("messaging.messages.sent"), data: { id: data, path: threadPath(appFor(me.roles), data) } };
}

export async function startChannel(input: StartChannelInput): Promise<ActionResult<{ id: string; path: string }>> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const p = startChannelSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("messaging.errors.invalid") };
  const db = await msgDb();
  const { data, error } = await db.rpc("msg_start_channel", {
    p_scope: p.data.scope,
    p_scope_id: p.data.scopeId,
    p_subject: p.data.subject,
    p_body: p.data.body,
    p_allow_replies: p.data.allowReplies,
    p_sensitive: p.data.sensitive,
  });
  if (error || !data) {
    logError("messaging.startChannel", error);
    return { ok: false, error: t.dynamic(messagingErrorKey(error?.message)) };
  }
  await writeAudit(me, "message.channel.start", "msg_conversations", data, { scope: p.data.scope, scope_id: p.data.scopeId });
  after(() => notifyNewMessage({ orgId: me.orgId, conversationId: data, senderId: me.id, body: p.data.body }));
  revalidateMessaging(data);
  return { ok: true, message: t("messaging.messages.channelCreated"), data: { id: data, path: threadPath(appFor(me.roles), data) } };
}

/** Post a message (FormData: conversationId, body, optional file). */
export async function sendMessage(formData: FormData): Promise<ActionResult> {
  const { me, t } = await requireRole(ANY);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const conversationId = String(formData.get("conversationId") ?? "");
  if (!uuid.safeParse(conversationId).success) return { ok: false, error: t("messaging.errors.notFound") };
  const text = bodySchema.safeParse(String(formData.get("body") ?? ""));
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!text.success && !hasFile) return { ok: false, error: t("messaging.errors.emptyMessage") };

  const db = await msgDb();
  const { data: canPost } = await db.rpc("msg_can_post", { p_conv: conversationId });
  if (canPost !== true) return { ok: false, error: t("messaging.errors.cannotPost") };

  // Validate and store the file first (Storage RLS: msg_can_post), so a
  // rejected upload never leaves a message without its attachment.
  let upload: { path: string; name: string; type: string; size: number } | null = null;
  if (hasFile) {
    if (file.size > ATTACHMENT_MAX_BYTES) return { ok: false, error: t("messaging.errors.fileTooLarge") };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffAttachmentType(bytes);
    if (!type || !ATTACHMENT_TYPES[type]) return { ok: false, error: t("messaging.errors.fileType") };
    const ext = ATTACHMENT_TYPES[type];
    const path = `${me.orgId}/${conversationId}/${crypto.randomUUID()}.${ext}`;
    const up = await db.storage.from(ATTACHMENT_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
    if (up.error) {
      logError("messaging.upload", up.error);
      return { ok: false, error: t("messaging.errors.uploadFailed") };
    }
    upload = { path, name: cleanFileName(file.name, ext), type, size: file.size };
  }

  const messageText = text.success ? text.data : t("messaging.thread.attachmentOnly");
  const { data: msg, error } = await db
    .from("msg_messages")
    .insert({ org_id: me.orgId, conversation_id: conversationId, sender_id: me.id, body: messageText })
    .select("id")
    .single();
  if (error || !msg) {
    logError("messaging.send", error);
    if (upload) await msgAdminDb().storage.from(ATTACHMENT_BUCKET).remove([upload.path]);
    return { ok: false, error: t.dynamic(messagingErrorKey(error?.message)) };
  }
  if (upload) {
    const { error: attErr } = await db.from("msg_attachments").insert({
      org_id: me.orgId,
      conversation_id: conversationId,
      message_id: msg.id,
      storage_path: upload.path,
      file_name: upload.name,
      mime_type: upload.type,
      size_bytes: upload.size,
      uploaded_by: me.id,
    });
    if (attErr) {
      logError("messaging.attachment", attErr);
      await msgAdminDb().storage.from(ATTACHMENT_BUCKET).remove([upload.path]);
      return { ok: false, error: t("messaging.errors.uploadFailed") };
    }
  }
  await writeAudit(me, "message.send", "msg_messages", msg.id, { conversation_id: conversationId, attachment: Boolean(upload) });
  after(() => notifyNewMessage({ orgId: me.orgId, conversationId, senderId: me.id, body: messageText }));
  revalidateMessaging(conversationId);
  return { ok: true, message: t("messaging.messages.sent") };
}

export async function setThreadStatus(conversationId: string, status: "open" | "closed"): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin", "coach"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  if (!uuid.safeParse(conversationId).success || (status !== "open" && status !== "closed")) return { ok: false, error: t("messaging.errors.invalid") };
  const db = await msgDb();
  const { error } = await db.rpc("msg_set_status", { p_conv: conversationId, p_status: status });
  if (error) {
    logError("messaging.status", error);
    return { ok: false, error: t.dynamic(messagingErrorKey(error.message)) };
  }
  await writeAudit(me, status === "closed" ? "message.thread.close" : "message.thread.reopen", "msg_conversations", conversationId);
  revalidateMessaging(conversationId);
  return { ok: true, message: t(status === "closed" ? "messaging.messages.closed" : "messaging.messages.reopened") };
}

export async function hideMessage(input: { messageId: string; hidden: boolean; reason?: string | null }): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const p = hideSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("messaging.errors.invalid") };
  const db = await msgDb();
  const { data, error } = await db.rpc("msg_hide_message", { p_message: p.data.messageId, p_hidden: p.data.hidden, p_reason: p.data.reason });
  if (error) {
    logError("messaging.hide", error);
    return { ok: false, error: t.dynamic(messagingErrorKey(error.message)) };
  }
  await writeAudit(me, p.data.hidden ? "message.hide" : "message.unhide", "msg_messages", p.data.messageId);
  revalidateMessaging(data ?? undefined);
  return { ok: true, message: t(p.data.hidden ? "messaging.messages.hidden" : "messaging.messages.unhidden") };
}

export async function reportMessage(input: ReportInput): Promise<ActionResult> {
  const { me, t } = await requireRole(ANY);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const p = reportSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("messaging.errors.reasonRequired") };
  const db = await msgDb();
  const { data: msg } = await db.from("msg_messages").select("id,conversation_id").eq("id", p.data.messageId).maybeSingle();
  if (!msg) return { ok: false, error: t("messaging.errors.notFound") };
  const { error } = await db.from("msg_reports").insert({
    org_id: me.orgId,
    conversation_id: msg.conversation_id,
    message_id: msg.id,
    reporter_id: me.id,
    reason: p.data.reason,
  });
  if (error) {
    logError("messaging.report", error);
    return { ok: false, error: t.dynamic(messagingErrorKey(error.message)) };
  }
  await writeAudit(me, "message.report", "msg_messages", msg.id);
  revalidatePath("/admin/messages");
  revalidatePath("/admin/notifications");
  return { ok: true, message: t("messaging.messages.reported") };
}

export async function resolveReport(reportId: string, status: "resolved" | "dismissed"): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  if (!uuid.safeParse(reportId).success || (status !== "resolved" && status !== "dismissed")) return { ok: false, error: t("messaging.errors.invalid") };
  const db = await msgDb();
  const { data, error } = await db
    .from("msg_reports")
    .update({ status, resolved_by: me.id, resolved_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("org_id", me.orgId)
    .select("id");
  if (error || !data?.length) return { ok: false, error: t("messaging.errors.forbidden") };
  await writeAudit(me, `message.report.${status}`, "msg_reports", reportId);
  revalidatePath("/admin/messages");
  revalidatePath("/admin/notifications");
  return { ok: true, message: t("messaging.messages.reportUpdated") };
}

export async function setThreadMuted(conversationId: string, muted: boolean): Promise<ActionResult> {
  const { me, t } = await requireRole(ANY);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  if (!uuid.safeParse(conversationId).success) return { ok: false, error: t("messaging.errors.invalid") };
  const db = await msgDb();
  const { data, error } = await db
    .from("msg_participants")
    .update({ muted })
    .eq("conversation_id", conversationId)
    .eq("profile_id", me.id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: t("messaging.errors.notMember") };
  await writeAudit(me, muted ? "message.thread.mute" : "message.thread.unmute", "msg_conversations", conversationId);
  revalidateMessaging(conversationId);
  return { ok: true, message: t(muted ? "messaging.messages.muted" : "messaging.messages.unmuted") };
}

export async function saveMessagingSettings(input: MessagingSettingsInput): Promise<ActionResult> {
  const { me, t } = await requireRole(["admin"]);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const p = messagingSettingsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("messaging.errors.quietHours") };
  const db = await msgDb();
  const { error } = await db.from("messaging_settings").upsert(
    {
      org_id: me.orgId,
      parents_can_start: p.data.parentsCanStart,
      parent_replies_in_channels: p.data.parentRepliesInChannels,
      read_receipts: p.data.readReceipts,
      email_notifications: p.data.emailNotifications,
      quiet_start: p.data.quietStart,
      quiet_end: p.data.quietEnd,
    },
    { onConflict: "org_id" },
  );
  if (error) {
    logError("messaging.settings", error);
    return { ok: false, error: t("messaging.errors.generic") };
  }
  await writeAudit(me, "messaging.settings.update", "messaging_settings", null, { ...p.data });
  revalidateMessaging();
  return { ok: true, message: t("messaging.messages.settingsSaved") };
}

export async function saveNotificationPreferences(input: PreferencesInput): Promise<ActionResult> {
  const { me, t } = await requireRole(ANY);
  if (!me) return { ok: false, error: t("messaging.errors.forbidden") };
  const p = preferencesSchema.safeParse(input);
  if (!p.success) return { ok: false, error: t("messaging.errors.quietHours") };
  const db = await msgDb();
  const { error } = await db.from("notification_preferences").upsert(
    { org_id: me.orgId, profile_id: me.id, channels: p.data.channels, quiet_start: p.data.quietStart, quiet_end: p.data.quietEnd },
    { onConflict: "profile_id" },
  );
  if (error) {
    logError("messaging.preferences", error);
    return { ok: false, error: t("messaging.errors.generic") };
  }
  await writeAudit(me, "notification.preferences.update", "notification_preferences", null);
  for (const base of Object.values(MESSAGES_BASE)) revalidatePath(`${base}/preferences`);
  return { ok: true, message: t("messaging.messages.preferencesSaved") };
}
