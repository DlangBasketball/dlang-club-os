import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { SportsDatabase } from "@/lib/sportsops/db";

/**
 * Typed view of the messaging, alerts, preferences and leads tables and RPCs
 * (migration 20250420100700_messaging_alerts_leads.sql). Kept local like
 * src/lib/staff/db.ts; merges into src/types/database.ts once the types are
 * regenerated with `npm run types`.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type MessagingSettingsRow = {
  id: string; org_id: string; parents_can_start: boolean; parent_replies_in_channels: boolean; read_receipts: boolean;
  email_notifications: boolean; quiet_start: string | null; quiet_end: string | null; created_at: string; updated_at: string;
};
export type ConversationRow = {
  id: string; org_id: string; kind: "direct" | "channel"; subject: string | null; family_id: string | null; office: boolean;
  team_id: string | null; program_id: string | null; camp_edition_id: string | null; allow_replies: boolean; sensitive: boolean;
  status: "open" | "closed"; closed_at: string | null; closed_by: string | null; created_by: string | null; last_message_at: string;
  created_at: string; updated_at: string;
};
export type ParticipantRow = {
  id: string; org_id: string; conversation_id: string; profile_id: string; side: "staff" | "family"; muted: boolean;
  created_at: string; updated_at: string;
};
export type MessageRow = {
  id: string; org_id: string; conversation_id: string; sender_id: string | null; body: string; hidden_at: string | null;
  hidden_by: string | null; hidden_reason: string | null; created_at: string; updated_at: string;
};
export type AttachmentRow = {
  id: string; org_id: string; conversation_id: string; message_id: string; storage_path: string; file_name: string;
  mime_type: string; size_bytes: number; uploaded_by: string | null; created_at: string; updated_at: string;
};
export type ReadStateRow = { id: string; org_id: string; conversation_id: string; profile_id: string; last_read_at: string; created_at: string; updated_at: string };
export type ReportRow = {
  id: string; org_id: string; conversation_id: string; message_id: string; reporter_id: string | null; reason: string;
  status: "open" | "resolved" | "dismissed"; resolved_by: string | null; resolved_at: string | null; created_at: string; updated_at: string;
};
export type PreferencesRow = {
  id: string; org_id: string; profile_id: string; channels: unknown; quiet_start: string | null; quiet_end: string | null;
  created_at: string; updated_at: string;
};
export type AlertRow = {
  id: string; org_id: string; title: string; body: string | null; severity: "info" | "warning" | "urgent";
  audience: "all" | "staff" | "parents" | "team" | "program" | "camp_edition"; team_id: string | null; program_id: string | null;
  camp_edition_id: string | null; starts_at: string; expires_at: string | null; dispatched_at: string | null; cancelled_at: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
export type AlertDismissalRow = { id: string; org_id: string; alert_id: string; profile_id: string; created_at: string; updated_at: string };
export type LeadRow = {
  id: string; org_id: string; name: string; email: string; phone: string | null; message: string;
  interest: "camp" | "training" | "team" | "other"; program_id: string | null; source_page: string | null; locale: string | null;
  consent_contact: boolean; consent_at: string; ip_hash: string | null; status: "new" | "replied" | "converted" | "closed";
  family_id: string | null; handled_by: string | null; replied_at: string | null; closed_at: string | null; created_at: string; updated_at: string;
};
export type LeadReplyRow = { id: string; org_id: string; lead_id: string; author_id: string | null; body: string; email_sent: boolean; created_at: string; updated_at: string };
export type CampEditionNameRow = { id: string; org_id: string; program_id: string; name: string | null; starts_on: string; ends_on: string; status: string; archived_at: string | null };

export type InboxRow = {
  conversation_id: string; kind: "direct" | "channel"; subject: string | null; status: "open" | "closed"; office: boolean;
  family_id: string | null; family_name: string | null; team_id: string | null; program_id: string | null; camp_edition_id: string | null;
  scope_name: string | null; last_message_at: string; unread: number; is_member: boolean; has_family_side: boolean;
  last_sender_side: "staff" | "family" | null; people: string | null;
};
export type PeopleRow = { profile_id: string; display_name: string | null; side: "staff" | "family"; is_participant: boolean; last_read_at: string | null };
export type ContactRow = { profile_id: string; display_name: string | null; kind: "office" | "coach" | "guardian"; family_id: string | null; family_name: string | null };

type MsgTables = {
  messaging_settings: T<MessagingSettingsRow>;
  msg_conversations: T<ConversationRow>;
  msg_participants: T<ParticipantRow>;
  msg_messages: T<MessageRow>;
  msg_attachments: T<AttachmentRow>;
  msg_read_state: T<ReadStateRow>;
  msg_reports: T<ReportRow>;
  notification_preferences: T<PreferencesRow>;
  club_alerts: T<AlertRow>;
  club_alert_dismissals: T<AlertDismissalRow>;
  contact_leads: T<LeadRow>;
  contact_lead_replies: T<LeadReplyRow>;
  camp_editions: T<CampEditionNameRow>;
};

type MsgFunctions = {
  msg_start_direct: { Args: { p_target: string | null; p_body: string; p_subject?: string | null; p_family?: string | null; p_sensitive?: boolean }; Returns: string };
  msg_start_channel: { Args: { p_scope: string; p_scope_id: string; p_subject: string; p_body: string; p_allow_replies?: boolean; p_sensitive?: boolean }; Returns: string };
  msg_set_status: { Args: { p_conv: string; p_status: "open" | "closed" }; Returns: undefined };
  msg_hide_message: { Args: { p_message: string; p_hidden: boolean; p_reason?: string | null }; Returns: string };
  msg_mark_read: { Args: { p_conv: string }; Returns: undefined };
  msg_inbox: { Args: { p_all?: boolean; p_limit?: number }; Returns: InboxRow[] };
  msg_people: { Args: { p_conv: string }; Returns: PeopleRow[] };
  msg_contacts: { Args: Record<string, never>; Returns: ContactRow[] };
  msg_can_post: { Args: { p_conv: string }; Returns: boolean };
  msg_is_member: { Args: { p_conv: string }; Returns: boolean };
  msg_conversation_audience: { Args: { p_conv: string }; Returns: { profile_id: string; side: "staff" | "family" }[] };
  club_alert_for_me: { Args: { p_audience: string; p_team: string | null; p_program: string | null; p_edition: string | null }; Returns: boolean };
  club_alert_recipients: { Args: { p_alert: string }; Returns: { profile_id: string }[] };
  contact_lead_submit: {
    Args: {
      p_org: string; p_name: string; p_email: string; p_phone: string | null; p_message: string; p_interest: string; p_consent: boolean;
      p_source?: string | null; p_locale?: string | null; p_ip_hash?: string | null; p_program?: string | null;
    };
    Returns: string;
  };
};

type Pub = SportsDatabase["public"];
export type MsgDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Pub["Tables"] & MsgTables;
    Functions: Pub["Functions"] & MsgFunctions;
  };
};
export type MsgClient = SupabaseClient<MsgDatabase>;

/** RLS-scoped client (the signed-in user's session). */
export async function msgDb(): Promise<MsgClient> {
  return (await createClient()) as unknown as MsgClient;
}

/** Service-role client: server-only (notifications, public form, cron). Always filter by org_id. */
export function msgAdminDb(): MsgClient {
  return createAdminClient() as unknown as MsgClient;
}

// Keep the generated Database type referenced (regeneration replaces this file's types).
export type _Generated = Database;
