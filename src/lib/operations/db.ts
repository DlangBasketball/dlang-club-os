import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";
import type { EventRow, SeasonRow, TeamCoachRow, TeamMembershipRow, TeamRow, VenueRow, VenueSpaceRow } from "@/lib/sportsops/db";
import type { AlertRow } from "@/lib/messaging/db";

/**
 * Typed view of the tables and RPCs of migration
 * 20250420101600_operations.sql (equipment, kit, facilities, board,
 * sponsors and donations), plus the existing tables the module reads. Kept
 * local like src/lib/shop/db.ts; merges into src/types/database.ts once the
 * types are regenerated with `npm run types`.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type Condition = "new" | "good" | "fair" | "poor" | "broken";

export type EquipmentItemRow = {
  id: string; org_id: string; venue_id: string | null; name: string; category: string; quantity: number; condition: Condition;
  purchase_date: string | null; purchase_value: number | null; currency: string | null; expense_id: string | null; notes: string | null;
  is_active: boolean; created_by: string | null; created_at: string; updated_at: string;
};
export type EquipmentCheckoutRow = {
  id: string; org_id: string; item_id: string; quantity: number; coach_id: string | null; team_id: string | null; checked_out_by: string | null;
  checked_out_at: string; due_on: string | null; returned_at: string | null; returned_by: string | null; return_condition: Condition | null;
  notes: string | null; last_reminded_at: string | null; created_at: string; updated_at: string;
};
export type EquipmentMaintenanceRow = {
  id: string; org_id: string; item_id: string; performed_on: string; note: string; cost: number | null; created_by: string | null;
  created_at: string; updated_at: string;
};
export type KitStatusValue = "sizes_requested" | "sizes_submitted" | "ordered" | "handed_out" | "returned";
export type KitAssignmentRow = {
  id: string; org_id: string; season_id: string | null; team_id: string; athlete_id: string; jersey_number: number | null;
  jersey_size: string | null; shorts_size: string | null; warmup_size: string | null; include_jersey: boolean; include_shorts: boolean;
  include_warmup: boolean; status: KitStatusValue; deposit_amount: number | null; currency: string | null; deposit_invoice_id: string | null;
  sizes_submitted_by: string | null; sizes_submitted_at: string | null; handed_out_at: string | null; returned_at: string | null;
  notes: string | null; created_at: string; updated_at: string;
};
export type AllocationRow = {
  id: string; org_id: string; venue_id: string; venue_space_id: string | null; team_id: string | null; label: string | null; weekday: number;
  start_time: string; end_time: string; valid_from: string; valid_until: string | null; is_active: boolean; notes: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
export type CustomerRow = {
  id: string; org_id: string; kind: "company" | "person" | "organization"; name: string; contact_name: string | null; email: string | null;
  phone: string | null; street: string | null; postal_code: string | null; city: string | null; country: string | null; notes: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
export type OpsInvoiceRow = {
  id: string; org_id: string; customer_id: string; number: string; source: "rental" | "sponsor" | "donation" | "other"; source_id: string | null;
  description: string | null; currency: string; total: number; status: "draft" | "issued" | "paid" | "cancelled"; issued_on: string;
  due_on: string | null; paid_on: string | null; reference: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type OpsInvoiceLineRow = {
  id: string; org_id: string; invoice_id: string; description: string; quantity: number; unit_price: number; amount: number; sort_order: number;
  created_at: string; updated_at: string;
};
export type RentalRow = {
  id: string; org_id: string; venue_id: string; venue_space_id: string | null; customer_id: string | null; renter_name: string;
  contact_email: string | null; contact_phone: string | null; starts_at: string; ends_at: string; price: number; currency: string;
  status: "tentative" | "confirmed" | "cancelled"; invoice_id: string | null; notes: string | null; created_by: string | null;
  created_at: string; updated_at: string;
};
export type ClosureRow = {
  id: string; org_id: string; venue_id: string; venue_space_id: string | null; starts_on: string; ends_on: string;
  reason: "holiday" | "maintenance" | "emergency" | "other"; note: string | null; applied_at: string | null; notified_at: string | null;
  summary: Json | null; created_by: string | null; created_at: string; updated_at: string;
};
export type CommitteeRow = {
  id: string; org_id: string; name: string; kind: string; description: string | null; is_active: boolean; created_at: string; updated_at: string;
};
export type CommitteeMemberRow = {
  id: string; org_id: string; committee_id: string; profile_id: string | null; display_name: string; role: string; email: string | null;
  starts_on: string | null; ends_on: string | null; created_at: string; updated_at: string;
};
export type MeetingRow = {
  id: string; org_id: string; committee_id: string; title: string; kind: "meeting" | "agm" | "extraordinary"; starts_at: string;
  location: string | null; status: "planned" | "held" | "cancelled"; agenda: Json; minutes: string | null; minutes_approved_at: string | null;
  invitation_sent_at: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type AttendeeRow = {
  id: string; org_id: string; meeting_id: string; member_id: string | null; display_name: string; status: "present" | "absent" | "excused" | "proxy";
  proxy_for: string | null; created_at: string; updated_at: string;
};
export type CommitteeDocumentRow = {
  id: string; org_id: string; committee_id: string; meeting_id: string | null; title: string; url: string; created_by: string | null;
  created_at: string; updated_at: string;
};
export type DecisionRow = {
  id: string; org_id: string; committee_id: string; meeting_id: string | null; title: string; description: string | null;
  owner_member_id: string | null; due_on: string | null; status: "open" | "in_progress" | "done" | "cancelled"; decided_on: string;
  completed_at: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type VoteRow = {
  id: string; org_id: string; meeting_id: string; motion: string; votes_for: number; votes_against: number; abstentions: number;
  result: "carried" | "rejected" | "tied"; notes: string | null; sort_order: number; created_at: string; updated_at: string;
};
export type SponsorRow = {
  id: string; org_id: string; customer_id: string; tier: string; package_name: string | null; amount: number; currency: string;
  contract_start: string | null; contract_end: string | null; renewal_reminder_days: number; status: "prospect" | "active" | "expired" | "cancelled";
  notes: string | null; renewal_reminded_at: string | null; created_by: string | null; created_at: string; updated_at: string;
};
export type DeliverableRow = {
  id: string; org_id: string; sponsor_id: string; kind: string; title: string; due_on: string | null; done_at: string | null; notes: string | null;
  created_at: string; updated_at: string;
};
export type CampaignRow = {
  id: string; org_id: string; slug: string; title: string; description: string | null; goal_amount: number; currency: string;
  starts_on: string | null; ends_on: string | null; is_public: boolean; status: "draft" | "active" | "closed"; created_by: string | null;
  created_at: string; updated_at: string;
};
export type DonationRow = {
  id: string; org_id: string; campaign_id: string | null; donor_id: string | null; amount: number; currency: string; donated_on: string;
  purpose: string | null; method: string; is_anonymous: boolean; status: "received" | "refunded"; stripe_session_id: string | null;
  notes: string | null; created_by: string | null; created_at: string; updated_at: string;
};

/** Existing tables read by the module (only the columns used here). */
export type CampEditionLite = {
  id: string; org_id: string; program_id: string; name: string | null; starts_on: string; ends_on: string; venue_id: string | null;
  location_name: string | null; status: string; archived_at: string | null;
};
export type BookingLite = {
  id: string; org_id: string; athlete_id: string; coach_id: string; service_id: string; slot_start: string; slot_end: string | null;
  status: string; venue_id: string | null;
};

type OpsTables = {
  equipment_items: T<EquipmentItemRow>;
  equipment_checkouts: T<EquipmentCheckoutRow>;
  equipment_maintenance: T<EquipmentMaintenanceRow>;
  kit_assignments: T<KitAssignmentRow>;
  facility_allocations: T<AllocationRow>;
  ops_customers: T<CustomerRow>;
  ops_invoices: T<OpsInvoiceRow>;
  ops_invoice_lines: T<OpsInvoiceLineRow>;
  facility_rentals: T<RentalRow>;
  venue_closures: T<ClosureRow>;
  committees: T<CommitteeRow>;
  committee_members: T<CommitteeMemberRow>;
  committee_meetings: T<MeetingRow>;
  committee_meeting_attendees: T<AttendeeRow>;
  committee_documents: T<CommitteeDocumentRow>;
  committee_decisions: T<DecisionRow>;
  committee_votes: T<VoteRow>;
  sponsors: T<SponsorRow>;
  sponsor_deliverables: T<DeliverableRow>;
  fundraising_campaigns: T<CampaignRow>;
  donations: T<DonationRow>;
  // existing
  seasons: T<SeasonRow>;
  venues: T<VenueRow>;
  venue_spaces: T<VenueSpaceRow>;
  teams: T<TeamRow>;
  team_coaches: T<TeamCoachRow>;
  team_memberships: T<TeamMembershipRow>;
  events: T<EventRow>;
  camp_editions: T<CampEditionLite>;
  training_bookings: T<BookingLite>;
  club_alerts: T<AlertRow>;
  expenses: T<{ id: string; org_id: string; expense_date: string; amount: number; currency: string; description: string | null; deleted_at: string | null }>;
};

type OpsFunctions = {
  equipment_check_out: {
    Args: { p_item: string; p_quantity: number; p_coach: string | null; p_team: string | null; p_due_on: string | null; p_notes: string | null };
    Returns: string;
  };
  equipment_check_in: { Args: { p_checkout: string; p_condition: string | null; p_notes: string | null }; Returns: undefined };
  kit_submit_sizes: { Args: { p_assignment: string; p_jersey: string | null; p_shorts: string | null; p_warmup: string | null }; Returns: undefined };
  ops_create_invoice: {
    Args: { p_customer: string; p_source: string; p_source_id: string | null; p_description: string | null; p_currency: string; p_due_on: string | null; p_lines: Json };
    Returns: Json;
  };
  record_online_donation: {
    Args: { p_org: string; p_campaign: string | null; p_session_id: string; p_amount: number; p_currency: string; p_name: string | null; p_email: string | null; p_anonymous: boolean };
    Returns: string;
  };
  is_any_committee_member: { Args: Record<string, never>; Returns: boolean };
};

type Pub = Database["public"];
export type OpsDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], keyof OpsTables> & OpsTables;
    Functions: Pub["Functions"] & OpsFunctions;
  };
};
export type OpsClient = SupabaseClient<OpsDatabase>;

/** RLS-scoped client (user session). */
export async function opsDb(): Promise<OpsClient> {
  return (await createClient()) as unknown as OpsClient;
}

/** Service-role client (server only; callers always filter by org explicitly). */
export function opsAdminDb(): OpsClient {
  return createAdminClient() as unknown as OpsClient;
}
