/**
 * Supabase database types.
 *
 * This is a hand-written subset covering the tables the scaffold touches.
 * Regenerate the full, authoritative types from your live schema with:
 *
 *   npm run types
 *   # = supabase gen types typescript --project-id <ref> --schema public
 *
 * The catch-all index signature keeps any not-yet-typed table usable.
 */
import type { AppRole } from "@/lib/auth/roles";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          /** Null until an invitation or provision_tenant() assigns a club. */
          org_id: string | null;
          full_name: string | null;
          email: string;
          phone: string | null;
          locale: string;
          /** Set when the user explicitly picked a language (i18n migration). */
          locale_set_at?: string | null;
          is_active: boolean;
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          email: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Row"]>;
        Relationships: [];
      };
      staff_roles: {
        Row: {
          id: string;
          org_id: string;
          profile_id: string;
          role: AppRole;
          created_at: string;
        };
        Insert: {
          org_id: string;
          profile_id: string;
          role: AppRole;
        };
        Update: Partial<{ role: AppRole }>;
        Relationships: [];
      };
      family_members: {
        Row: {
          family_id: string;
          profile_id: string;
          relation: string | null;
          is_primary: boolean;
          created_at: string;
        };
        Insert: {
          family_id: string;
          profile_id: string;
          relation?: string | null;
          is_primary?: boolean;
        };
        Update: Partial<{ relation: string | null; is_primary: boolean }>;
        Relationships: [];
      };
      athletes: {
        Row: {
          id: string;
          org_id: string;
          family_id: string;
          first_name: string;
          last_name: string;
          dob: string;
          gender: string | null;
          nationality: string | null;
          school: string | null;
          jersey_size: string | null;
          dominant_hand: string | null;
          position_pref: string | null;
          status: string;
          notes: string | null;
          photo_path: string | null;
          photo_updated_at: string | null;
          // covers (20250420101100): private athlete-covers key or a club library path
          cover_path: string | null;
          cover_focal_x: number;
          cover_focal_y: number;
          // federation licence (20250420102300); club-managed, staff-only writes
          licence_number: string | null;
          licence_category: string | null;
          licence_issued_on: string | null;
          licence_fee: number | null;
          licence_federation: string | null;
          // sponsored players (20250420102400); staff-only writes, stamps server-set
          sponsorship_kind: "none" | "full" | "partial";
          sponsorship_percent: number | null;
          sponsorship_scope: string[];
          sponsor_name: string | null;
          sponsorship_reason: string | null;
          sponsorship_from: string | null;
          sponsorship_until: string | null;
          sponsored_by: string | null;
          sponsored_at: string | null;
          // remove a person (20250420102500): status active | inactive | archived | erased
          archived_at: string | null;
          archived_by: string | null;
          // player portal (20250420104000): the athlete's own login, if any
          player_profile_id: string | null;
          player_linked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          org_id: string;
          number: string;
          family_id: string;
          athlete_id: string | null;
          program_id: string | null;
          registration_id: string | null;
          description: string | null;
          payment_reference: string | null;
          total_chf: number;
          currency: string;
          subtotal_amount: number | null;
          tax_rate: number;
          tax_amount: number;
          tax_label: string | null;
          tax_inclusive: boolean;
          reverse_charge: boolean;
          tax_exempt_reason: string | null;
          buyer_tax_id: string | null;
          status:
            | "draft"
            | "sent"
            | "pending"
            | "partially_paid"
            | "paid"
            | "overdue"
            | "void"
            | "cancelled"
            | "refunded"
            | "written_off";
          due_date: string | null;
          issued_at: string;
          paid_at: string | null;
          // Money editing (migration 20250420095900)
          adjustments_total: number;
          notes: string | null;
          locale: string | null;
          reminders_paused: boolean;
          cancelled_at: string | null;
          cancel_reason: string | null;
          written_off_at: string | null;
          // Family split billing (migration 20250420101400)
          payer_profile_id: string | null;
          split_group_id: string | null;
          split_share_pct: number | null;
          split_from_invoice_id: string | null;
          // Billing foundation (migration 20250420103500)
          activity: "club_membership" | "selection" | "camp" | "training" | "shop" | "other";
          activity_source: "migration_rule" | "migration_default" | "set" | "derived" | "default" | "linked";
          billing_entity_id: string | null;
          billing_entity_snapshot: Json | null;
          billing_entity_source: "route" | "default" | "set" | "migration_default" | null;
          membership_id: string | null;
          charge_kind: "season_fee" | "carry_forward" | "adjustment" | null;
          request_id: string | null;
          payer_kind: "guardian" | "family" | "sponsor" | "other" | null;
          payer_name: string | null;
          /** What the invoice is for, as printed (set at issue). */
          source_label: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      programs: {
        Row: {
          id: string;
          org_id: string;
          slug: string | null;
          name: string;
          kind: "camp" | "recurring_team" | "clinic" | "tournament" | "selection";
          description: string | null;
          price_chf: number;
          capacity: number | null;
          starts_on: string | null;
          ends_on: string | null;
          location: string | null;
          is_public: boolean;
          is_active: boolean;
          // club ops admin edit (20250420095800)
          schedule: Json | null; status: "draft" | "published" | "archived"; currency: string | null;
          min_age: number | null; max_age: number | null; registration_opens_at: string | null;
          registration_closes_at: string | null; archived_at: string | null; updated_at: string;
          // camp seasons + cover image (20250420101200)
          season: "spring" | "summer" | "fall" | "winter" | "other" | null; season_year: number | null;
          cover_path: string | null; cover_focal_x: number | null; cover_focal_y: number | null;
          // selection programmes (20250420102600)
          selection_enabled: boolean; requires_approval: boolean; allow_non_members: boolean;
          // selection payment period (20250420103400)
          payment_starts_on: string | null; payment_ends_on: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      invitations: {
        Row: {
          id: string;
          org_id: string;
          email: string;
          role: AppRole;
          family_id: string | null;
          coach_id: string | null;
          relation: string | null;
          /** Player invitations (role 'player'): the athlete the login is linked to. */
          athlete_id: string | null;
          status: "pending" | "accepted" | "revoked" | "expired";
          token: string;
          invited_by: string | null;
          expires_at: string;
          accepted_at: string | null;
          accepted_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          org_id: string | null;
          email: string;
          role: AppRole;
          family_id?: string | null;
          coach_id?: string | null;
          relation?: string | null;
          athlete_id?: string | null;
          invited_by?: string | null;
        };
        Update: Partial<{
          status: "pending" | "accepted" | "revoked" | "expired";
          accepted_at: string | null;
          accepted_by: string | null;
        }>;
        Relationships: [];
      };
      coaches: {
        Row: {
          id: string;
          org_id: string;
          profile_id: string | null;
          display_name: string;
          role_title: string | null;
          serves: string[];
          bio: string | null;
          is_active: boolean;
          photo_path: string | null;
          photo_updated_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Partial<{
          profile_id: string | null;
          display_name: string;
          role_title: string | null;
          serves: string[];
          bio: string | null;
          is_active: boolean;
          photo_path: string | null;
          photo_updated_at: string | null;
        }>;
        Relationships: [];
      };
      consent_forms: {
        Row: {
          id: string;
          org_id: string;
          key: string;
          title: string;
          body: string | null;
          version: number;
          locale: string | null;
          is_required: boolean;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      consent_acceptances: {
        Row: {
          id: string;
          org_id: string;
          athlete_id: string;
          consent_form_id: string;
          accepted_version: number;
          accepted_by: string | null;
          accepted_at: string;
          status: "accepted" | "withdrawn" | "expired";
          program_id: string | null;
          ip_address: string | null;
          accepted_text: string | null;
          withdrawn_at: string | null;
          user_agent: string | null;
          source: "online" | "paper" | "verbal" | "email" | "other";
          recorded_by: string | null;
          signer_name: string | null;
          withdrawal_reason: string | null;
          withdrawn_by: string | null;
        };
        Insert: {
          org_id: string | null;
          athlete_id: string;
          consent_form_id: string;
          accepted_version: number;
          accepted_by?: string | null;
          accepted_at?: string;
          status?: "accepted" | "withdrawn" | "expired";
          program_id?: string | null;
          source?: "online" | "paper" | "verbal" | "email" | "other";
          recorded_by?: string | null;
          signer_name?: string | null;
        };
        Update: Record<string, unknown>;
        Relationships: [];
      };
      families: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          /** Street line; postal code and city live in their own columns (20250420102300). */
          address: string | null;
          postal_code: string | null;
          city: string | null;
          phone: string | null;
          contact_name: string | null;
          contact_email: string | null;
          primary_contact_id: string | null;
          /** member | guest (registered from a public camp page without membership). */
          membership_status: "member" | "guest";
          /** active | archived (restorable 30 days) | erased (anonymised tombstone) — 20250420102500. */
          status: "active" | "archived" | "erased";
          archived_at: string | null;
          archived_by: string | null;
          created_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      // Remove a person everywhere (20250420102500): ids and counts only.
      person_deletions: {
        Row: {
          id: string;
          org_id: string;
          kind: "athlete" | "family";
          target_id: string;
          family_id: string | null;
          status: "archived" | "restored" | "erased";
          mode: "archive" | "erase";
          summary: Json;
          snapshot: Json | null;
          requested_by: string | null;
          purge_after: string | null;
          purge_notified_at: string | null;
          restored_at: string | null;
          restored_by: string | null;
          erased_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      program_sessions: {
        Row: {
          id: string;
          org_id: string;
          program_id: string;
          coach_id: string | null;
          starts_at: string;
          ends_at: string | null;
          location: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      attendance_sessions: {
        Row: {
          id: string;
          org_id: string;
          program_id: string | null;
          program_session_id: string | null;
          coach_id: string | null;
          session_date: string;
          status: "open" | "submitted" | "locked";
          roster_size: number | null;
          submitted_at: string | null;
          // club ops admin edit (20250420095800)
          reopened_at: string | null; reopened_by: string | null; correction_count: number;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      registrations: {
        Row: {
          id: string;
          org_id: string;
          athlete_id: string;
          program_id: string;
          status:
            | "pending"
            | "confirmed"
            | "waitlist"
            | "cancelled"
            | "completed";
          registered_by: string | null;
          notes: string | null;
          cancellation_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          // camps (20250420100100): the invoice the registration is billed on
          invoice_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          org_id: string;
          invoice_id: string;
          amount_chf: number;
          currency: string;
          method: "card" | "bank_transfer" | "twint" | "manual" | "qr_bill" | "sepa_debit" | "ach" | "ideal" | "bancontact" | "apple_pay" | "google_pay";
          status:
            | "pending"
            | "succeeded"
            | "failed"
            | "refunded"
            | "partially_refunded";
          stripe_charge_id: string | null;
          stripe_payment_intent_id: string | null;
          qr_reference: string | null;
          stripe_account_id: string | null;
          stripe_refund_id: string | null;
          application_fee_amount: number | null;
          method_detail: string | null;
          recorded_by: string | null;
          paid_at: string | null;
          notes: string | null;
          created_at: string;
          // Money editing (migration 20250420095900)
          voided_at: string | null;
          voided_by: string | null;
          void_reason: string | null;
          reverses_payment_id: string | null;
          replaced_by_payment_id: string | null;
          admin_note: string | null;
          // Billing foundation (migration 20250420103500)
          receipt_id: string | null;
          request_id: string | null;
          installment_id: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          org_id: string;
          recipient_id: string | null;
          type:
            | "practice"
            | "payment"
            | "training"
            | "registration"
            | "system"
            | "other";
          title: string;
          body: string | null;
          link: string | null;
          read_at: string | null;
          archived_at: string | null;
          created_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      athlete_medical: {
        Row: {
          id: string;
          org_id: string;
          athlete_id: string;
          allergies: string | null;
          conditions: string | null;
          medications: string | null;
          insurance: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          notes: string | null;
          updated_at: string;
        };
        Insert: {
          org_id: string | null;
          athlete_id: string;
          allergies?: string | null;
          conditions?: string | null;
          medications?: string | null;
          insurance?: string | null;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          notes?: string | null;
          updated_by?: string | null;
        };
        Update: Record<string, unknown>;
        Relationships: [];
      };
      attendance_marks: {
        Row: {
          notes: string | null;
          injury_flag: boolean;
          id: string;
          org_id: string;
          attendance_session_id: string;
          athlete_id: string;
          status: "present" | "late" | "absent" | "excused";
          marked_at: string;
          // club ops admin edit (20250420095800)
          corrected_by: string | null; corrected_at: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          org_id: string;
          athlete_id: string | null;
          family_id: string | null;
          kind: "consent_pdf" | "medical" | "insurance" | "photo" | "other";
          storage_path: string;
          program_id: string | null;
          title: string | null;
          size_bytes: number | null;
          uploaded_by: string | null;
          file_name: string | null;
          mime_type: string | null;
          expires_at: string | null;
          updated_at: string;
          updated_by: string | null;
          created_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      invoice_items: {
        Row: {
          id: string;
          org_id: string;
          invoice_id: string;
          description: string;
          quantity: number;
          unit_price_chf: number;
          amount_chf: number;
          created_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      credit_packages: {
        Row: { id: string; org_id: string; name: string; credit_category: "personal" | "nutrition" | "mental"; credits: number; price_chf: number; is_active: boolean };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      training_credits: {
        Row: { id: string; org_id: string; athlete_id: string; credit_category: "personal" | "nutrition" | "mental"; total_credits: number; used_credits: number };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      // Money editing (migration 20250420095900): written only through RPCs.
      invoice_adjustments: {
        Row: {
          id: string; org_id: string; invoice_id: string; number: string;
          kind: "credit_note" | "debit_note" | "write_off" | "cancellation";
          amount: number; currency: string; tax_rate: number; tax_amount: number;
          description: string | null; reason: string; created_by: string | null;
          voided_at: string | null; voided_by: string | null; void_reason: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      family_credit_entries: {
        Row: {
          id: string; org_id: string; family_id: string; amount: number; currency: string;
          kind: "overpayment" | "applied" | "manual" | "reversal";
          invoice_id: string | null; payment_id: string | null; reason: string;
          created_by: string | null; created_at: string; updated_at: string;
          /** Activity pool (migration 20250420103500); null = unassigned credit. */
          activity: string | null;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      training_credit_adjustments: {
        Row: {
          id: string; org_id: string; athlete_id: string; credit_category: "personal" | "nutrition" | "mental";
          kind: "grant" | "adjust" | "revoke"; delta: number; total_before: number; total_after: number;
          used_at_time: number; reason: string; created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      training_services: {
        Row: { id: string; org_id: string; slug: string; name: string; tagline: string | null; description: string | null; duration_min: number; price_chf: number; credits_required: number; credit_category: "personal" | "nutrition" | "mental"; is_active: boolean };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      coach_availability: {
        Row: { id: string; org_id: string; coach_id: string; starts_at: string; ends_at: string; is_booked: boolean };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      training_bookings: {
        Row: { id: string; org_id: string; athlete_id: string; service_id: string; coach_id: string; slot_start: string; slot_end: string | null; status: "booked" | "completed" | "no_show" | "cancelled"; paid_with: string | null; invoice_id: string | null; credits_used: number; price_chf: number | null; notes: string | null; created_by: string | null; cancel_reason: string | null; cancelled_at: string | null; cancelled_by: string | null };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      email_logs: {
        Row: { id: string; org_id: string; recipient_id: string | null; to_email: string; subject: string | null; template: string | null; status: "queued" | "sent" | "delivered" | "bounced" | "failed"; provider_id: string | null; invoice_id: string | null; error: string | null; attempts: number; html: string | null; notification_id: string | null; sent_at: string | null; updated_at: string; created_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      organizations: {
        Row: {
          id: string; name: string; slug: string; country: string | null; currency: string | null; created_at: string; updated_at: string;
          // white-label tenancy (20250420091600)
          custom_domain: string | null; branding: Json; terminology: Json; sport: string | null;
          default_locale: string; supported_locales: string[]; timezone: string;
          plan: string; status: string; data_region: string;
          // club hub hero (20250420101100)
          cover_path: string | null; cover_focal_x: number; cover_focal_y: number;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      // --- media library (migration 20250420101100) -------------------------
      media_assets: {
        Row: {
          id: string; org_id: string; path: string; kind: "cover" | "banner" | "gallery";
          width: number | null; height: number | null; size_bytes: number | null; mime_type: string | null;
          alt_text: string | null; consent_note: string | null;
          public_use_confirmed_at: string | null; public_use_confirmed_by: string | null;
          uploaded_by: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      deletion_requests: {
        Row: { id: string; org_id: string; family_id: string; requested_by: string | null; reason: string | null; status: string; reviewed_by: string | null; reviewed_at: string | null; completed_at: string | null; created_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      // --- compliance (migration 20250420091900) ---------------------------
      compliance_settings: {
        Row: {
          org_id: string; data_region: "CH" | "EU" | "UK" | "US" | "OTHER"; jurisdiction_subdivision: string | null; org_type: string;
          hosting_region: string; legal_entity_name: string | null; registered_address: string | null; company_register_id: string | null;
          vat_id: string | null; privacy_contact_email: string | null; dpo_name: string | null; dpo_email: string | null;
          eu_representative: string | null; ch_representative: string | null; supervisory_authority: string | null;
          coppa_applies: boolean; coppa_direct_notice_version: number; ferpa_applies: boolean; ferpa_school_official_designated: boolean;
          ferpa_designation_date: string | null; ferpa_annual_notice_url: string | null; us_state_laws: string[];
          honor_global_privacy_control: boolean; cookie_banner_enabled: boolean; legal_overrides: Json; last_reviewed_at: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      data_retention_policies: {
        Row: { id: string; org_id: string; data_category: string; retention_months: number; retention_trigger: string; expiry_action: string; legal_basis: string | null; statutory_reference: string | null; is_default: boolean; notes: string | null; created_at: string; updated_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      processing_activities: {
        Row: { id: string; org_id: string; name: string; purpose: string; role: string; legal_basis: string; special_category_basis: string | null; data_subject_categories: string[]; data_categories: string[]; involves_special_category: boolean; involves_minors: boolean; recipients: string[]; subprocessor_names: string[]; international_transfers: string | null; transfer_safeguards: string | null; retention_category: string | null; security_measures: string | null; dpia_required: boolean; dpia_completed_at: string | null; owner_name: string | null; next_review_at: string | null; is_active: boolean; created_at: string; updated_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      subprocessors: {
        Row: { id: string; org_id: string | null; name: string; service: string; purpose: string; data_categories: string[]; processing_location: string; transfer_mechanism: string | null; dpa_url: string | null; website: string | null; is_active: boolean; added_on: string; created_at: string; updated_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      parental_consents: {
        Row: { id: string; org_id: string; athlete_id: string; guardian_profile_id: string | null; guardian_name: string; guardian_email: string | null; method: string; status: "pending" | "verified" | "rejected" | "revoked" | "expired"; scope: string[]; third_party_disclosure_consented: boolean; direct_notice_version: number; evidence_reference: string | null; requested_at: string; verified_at: string | null; verified_by: string | null; revoked_at: string | null; expires_at: string | null; notes: string | null; created_at: string; updated_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      education_record_disclosures: {
        Row: { id: string; org_id: string; athlete_id: string | null; disclosed_to: string; legitimate_interest: string; records_described: string; exception_basis: string; disclosed_by: string | null; disclosed_at: string; created_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      breach_incidents: {
        Row: { id: string; org_id: string; title: string; description: string | null; status: "open" | "investigating" | "contained" | "notified" | "closed"; severity: "low" | "medium" | "high" | "critical"; risk_assessment: string; occurred_at: string | null; detected_at: string; contained_at: string | null; data_categories: string[]; subjects_affected_estimate: number | null; involves_minors: boolean; involves_special_category: boolean; jurisdictions: string[]; authority_notify_by: string | null; authority_notification_required: boolean | null; authority_notified_at: string | null; authority_reference: string | null; subjects_notified_at: string | null; controller_notified_at: string | null; root_cause: string | null; remediation: string | null; reported_by: string | null; closed_at: string | null; created_at: string; updated_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      dsar_requests: {
        Row: { id: string; org_id: string; family_id: string | null; athlete_id: string | null; requester_profile_id: string | null; requester_name: string; requester_email: string | null; relationship: string; request_type: string; jurisdiction: "CH" | "EU" | "UK" | "US" | "OTHER"; channel: string; received_at: string; due_at: string | null; extended_due_at: string | null; extension_reason: string | null; identity_verified_at: string | null; status: "received" | "verifying" | "in_progress" | "extended" | "completed" | "rejected" | "withdrawn"; rejection_reason: string | null; completed_at: string | null; response_summary: string | null; deletion_request_id: string | null; handled_by: string | null; notes: string | null; created_at: string; updated_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      ai_queries: {
        Row: { id: string; org_id: string; actor_id: string | null; role: string | null; question: string; answer_preview: string | null; grounded: boolean; escalated: boolean; created_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      app_settings: {
        Row: {
          org_id: string;
          invoice_pattern: string | null;
          invoice_counter: number;
          currency: string;
          default_locale: string;
          /** IANA time zone (i18n migration). */
          timezone?: string;
          /** Languages offered in the switcher (i18n migration). */
          enabled_locales?: string[];
          payment_methods: string[];
          settings: Json;
          updated_at: string;
          // Club season billing defaults (migration 20250420103500)
          club_season_start_month?: number;
          club_installment_count?: number;
          club_installment_due_day?: number;
          club_first_installment_month?: number | null;
          // Team attendance go-live (migration 20250420104000)
          attendance_tracking_starts_on?: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      /** AI assistant add-on entitlement (migration 20250420095600). Platform-written only. */
      ai_assistant_addons: {
        Row: {
          id: string;
          org_id: string;
          scope: "org" | "family";
          family_id: string | null;
          source: "paid_addon" | "complimentary";
          status: "active" | "paused" | "canceled";
          starts_at: string;
          ends_at: string | null;
          note: string | null;
          granted_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      athlete_sponsorship_entries: {
        // sponsored players (20250420102400): value given, admin / finance read only
        Row: {
          id: string;
          org_id: string;
          athlete_id: string;
          family_id: string | null;
          invoice_id: string | null;
          invoice_adjustment_id: string | null;
          installment_id: string | null;
          membership_id: string | null;
          scope: string;
          method: string;
          sponsorship_kind: string;
          percent: number;
          sponsor_name: string | null;
          list_amount: number;
          amount: number;
          currency: string;
          service_date: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          voided_at: string | null;
          void_reason: string | null;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: number;
          org_id: string | null;
          actor_id: string | null;
          action: string;
          target_table: string | null;
          target_id: string | null;
          old_data: Json | null;
          new_data: Json | null;
          created_at: string;
        };
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      };
      // ---- Billing foundation (migration 20250420103500) --------------------
      billing_entities: {
        Row: {
          id: string; org_id: string; name: string; legal_name: string | null; street: string | null; building_number: string | null;
          address_extra: string | null; postal_code: string | null; city: string | null; country: string; vat_number: string | null;
          iban: string | null; qr_iban: string | null; email: string | null; phone: string | null; is_default: boolean; is_active: boolean;
          created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      billing_entity_routes: {
        Row: { id: string; org_id: string; activity: string; billing_entity_id: string; created_by: string | null; created_at: string; updated_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      membership_payers: {
        Row: {
          id: string; org_id: string; membership_id: string; sort: number; payer_kind: "guardian" | "family" | "sponsor" | "other";
          payer_profile_id: string | null; family_id: string | null; payer_name: string | null; payer_email: string | null;
          share_kind: "fixed" | "percent"; share_value: number; amount: number; currency: string; invoice_id: string | null;
          created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      payment_receipts: {
        Row: {
          id: string; org_id: string; family_id: string | null; payer_name: string | null; amount: number; currency: string;
          received_on: string; method: string; reference: string | null; note: string | null; bank_entry_id: string | null;
          request_id: string; status: "open" | "partially_allocated" | "allocated" | "void"; voided_at: string | null;
          void_reason: string | null; created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      data_review_flags: {
        Row: {
          id: string; org_id: string; entity_table: string; entity_id: string | null; reason_code: string; details: Json;
          original_reference: string | null; resolved_at: string | null; resolved_by: string | null; resolution_note: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      invoice_number_series: {
        Row: { id: string; org_id: string; category: string; prefix: string; is_active: boolean; created_by: string | null; created_at: string; updated_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      invoice_number_counters: {
        Row: { org_id: string; prefix: string; year: number; last_value: number; updated_at: string };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      seasons: {
        Row: {
          id: string; org_id: string; name: string; starts_on: string; ends_on: string; is_current: boolean; created_at: string; updated_at: string;
          /** Training calendar of the season (migration 20250420104000); null = no window. */
          training_starts_on: string | null; training_ends_on: string | null;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      // ---- Team attendance (migration 20250420104000) -----------------------
      // All writes go through the RPCs below (RLS denies direct writes),
      // except club_training_breaks (admin RLS writes allowed; trigger cancels).
      team_membership_periods: {
        Row: {
          id: string; org_id: string; membership_id: string | null; team_id: string; athlete_id: string;
          joined_on: string; left_on: string; jersey_number: number | null; position: string | null; reason: string | null;
          archived_by: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      event_coach_assignments: {
        Row: {
          id: string; org_id: string; event_id: string; coach_id: string; role: "substitute" | "lead";
          status: "approved" | "pending" | "rejected"; request_note: string | null; requested_by: string | null;
          assigned_by: string | null; decided_by: string | null; decided_at: string | null; decision_note: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      team_attendance_sheets: {
        Row: {
          id: string; org_id: string; event_id: string; team_id: string; roster_date: string;
          status: "draft" | "final" | "reopened"; version: number; led_by_coach_id: string | null; opened_by: string | null;
          submitted_by: string | null; submitted_at: string | null; finalized_by: string | null; finalized_at: string | null;
          first_finalized_at: string | null; reopened_by: string | null; reopened_at: string | null; reopen_reason: string | null;
          finalize_count: number; correction_count: number; alerts_synced_at: string | null;
          legacy_attendance_session_id: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      team_attendance_marks: {
        Row: {
          id: string; org_id: string; sheet_id: string; event_id: string; athlete_id: string; membership_id: string | null;
          is_guest: boolean; status: "unmarked" | "present" | "late" | "excused" | "unexcused";
          finalized_status: "present" | "late" | "excused" | "unexcused" | null; rev: number; note: string | null;
          reported_absence_ack: boolean; added_by: string | null; updated_by: string | null; marked_at: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      team_attendance_mark_history: {
        Row: {
          id: string; org_id: string; sheet_id: string; mark_id: string; event_id: string; athlete_id: string;
          previous_status: string | null; new_status: string; phase: "draft" | "reopened" | "correction";
          reason: string | null; request_id: string | null; changed_by: string | null; changed_at: string;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      team_absence_reports: {
        Row: {
          id: string; org_id: string; event_id: string; athlete_id: string; reported_by: string | null;
          reporter_kind: "guardian" | "player"; reason: string | null;
          reason_category: "illness" | "injury" | "school" | "family" | "travel" | "other";
          status: "reported" | "acknowledged" | "superseded" | "withdrawn"; needs_review: boolean; event_starts_at: string;
          acknowledged_by: string | null; acknowledged_at: string | null; withdrawn_at: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      attendance_no_show_alerts: {
        Row: {
          id: string; org_id: string; event_id: string; athlete_id: string; mark_id: string | null; history_id: string | null;
          guardian_profile_id: string | null; kind: "initial" | "correction"; mark_status: "present" | "late" | "excused" | "unexcused";
          // e-mail-only recipient + stable recipient key (20250420104300)
          recipient_family_id: string | null; recipient_key: string;
          status: "pending" | "sent" | "failed" | "no_contact" | "suppressed" | "superseded"; channel_results: Json;
          attempts: number; last_error: string | null; notification_id: string | null; claimed_at: string | null;
          next_attempt_at: string | null; sent_at: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      attendance_correction_requests: {
        Row: {
          id: string; org_id: string; event_id: string; team_id: string; athlete_id: string; mark_id: string;
          requested_by: string | null; current_status: string; requested_status: string | null; message: string;
          status: "open" | "accepted" | "rejected" | "withdrawn"; resolved_by: string | null; resolved_at: string | null;
          resolution_note: string | null; history_id: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      club_training_breaks: {
        Row: {
          id: string; org_id: string; season_id: string | null; label: string; starts_on: string; ends_on: string;
          created_by: string | null; created_at: string; updated_at: string;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
      memberships: {
        Row: {
          id: string; org_id: string; membership_type_id: string | null; family_id: string; athlete_id: string | null;
          valid_from: string; valid_until: string; status: "pending_payment" | "active" | "expired" | "cancelled";
          price_amount: number; currency: string; invoice_id: string | null; renewed_from_id: string | null;
          cancelled_at: string | null; cancel_reason: string | null; created_by: string | null; created_at: string; updated_at: string;
          // Season fee (migration 20250420103500)
          season_id: string | null; kind: "season_fee" | null; agreed_fee: number | null; installment_count: number | null;
          first_due_month: string | null; due_day: number | null; sponsored: boolean; sponsored_notes: string | null;
          request_id: string | null; source: "issue" | "migration" | null;
        };
        Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // ---- Team attendance (migration 20250420104000); contract: docs/team-attendance.md
      is_player: { Args: Record<string, never>; Returns: boolean };
      current_player_athlete_id: { Args: Record<string, never>; Returns: string | null };
      team_roster_on: {
        Args: { p_team: string; p_on?: string | null };
        Returns: { athlete_id: string; membership_id: string | null; first_name: string; last_name: string; jersey_number: number | null;
                   player_position: string | null; membership_status: string; joined_on: string; left_on: string | null; source: "current" | "history" }[];
      };
      team_roster_history: {
        Args: { p_team: string };
        Returns: { athlete_id: string; membership_id: string | null; first_name: string; last_name: string; joined_on: string;
                   left_on: string | null; membership_status: string; end_reason: string | null; source: "current" | "history" }[];
      };
      team_member_add: { Args: { p_team: string; p_athlete: string; p_effective_on?: string | null; p_jersey?: number | null; p_position?: string | null }; Returns: Json };
      team_member_leave: { Args: { p_team: string; p_athlete: string; p_effective_on: string | null; p_reason: string }; Returns: Json };
      team_member_transfer: { Args: { p_from_team: string; p_to_team: string; p_athlete: string; p_effective_on: string | null; p_reason: string }; Returns: Json };
      attendance_settings: { Args: Record<string, never>; Returns: Json };
      attendance_settings_set: { Args: { p_tracking_starts_on: string | null }; Returns: Json };
      athlete_player_link: { Args: { p_athlete: string; p_profile: string }; Returns: Json };
      athlete_player_unlink: { Args: { p_athlete: string }; Returns: Json };
      player_me: {
        Args: Record<string, never>;
        Returns: { athlete_id: string; first_name: string; last_name: string; dob: string | null; photo_path: string | null; teams: Json }[];
      };
      session_assign_coach: { Args: { p_event: string; p_coach: string; p_role?: "substitute" | "lead" }; Returns: Json };
      session_request_access: { Args: { p_event: string; p_note?: string | null }; Returns: Json };
      session_decide_access: { Args: { p_assignment: string; p_approve: boolean; p_note?: string | null }; Returns: Json };
      attendance_sheet: { Args: { p_event: string }; Returns: Json };
      attendance_open: { Args: { p_event: string }; Returns: Json };
      attendance_save: { Args: { p_event: string; p_marks: Json; p_expected_version: number; p_request_id?: string | null; p_ack_reported?: boolean }; Returns: Json };
      attendance_mark_all_present: { Args: { p_event: string; p_expected_version: number; p_request_id?: string | null }; Returns: Json };
      attendance_add_guest: { Args: { p_event: string; p_athlete: string }; Returns: Json };
      attendance_remove_guest: { Args: { p_event: string; p_athlete: string }; Returns: Json };
      attendance_finalize: { Args: { p_event: string; p_led_by_coach: string | null; p_expected_version: number; p_request_id?: string | null; p_ack_reported?: boolean }; Returns: Json };
      attendance_reopen: { Args: { p_event: string; p_reason: string }; Returns: Json };
      attendance_correct: { Args: { p_event: string; p_athlete: string; p_new_status: string; p_reason: string; p_request_id?: string | null; p_ack_reported?: boolean }; Returns: Json };
      absence_report: { Args: { p_event: string; p_athlete: string; p_reason?: string | null; p_category?: string }; Returns: Json };
      absence_withdraw: { Args: { p_report: string }; Returns: Json };
      absence_acknowledge: { Args: { p_report: string }; Returns: Json };
      attendance_correction_request: { Args: { p_event: string; p_athlete: string; p_message: string; p_requested_status?: string | null }; Returns: Json };
      attendance_correction_withdraw: { Args: { p_request: string }; Returns: Json };
      attendance_correction_resolve: { Args: { p_request: string; p_accept: boolean; p_new_status?: string | null; p_note?: string | null }; Returns: Json };
      coach_sessions: {
        Args: { p_from?: string | null; p_to?: string | null };
        Returns: { event_id: string; team_id: string | null; team_name: string | null; event_type: string; title: string | null; starts_at: string;
                   ends_at: string; event_status: string; access: "team_coach" | "substitute" | "lead" | "pending"; can_run: boolean;
                   sheet_status: "draft" | "final" | "reopened" | null; sheet_version: number | null; unmarked: number; marked: number;
                   reported_absences: number; tracked: boolean }[];
      };
      sessions_awaiting_attendance: {
        Args: { p_team?: string | null; p_limit?: number };
        Returns: { event_id: string; team_id: string; team_name: string; event_type: string; starts_at: string; ends_at: string;
                   sheet_status: "draft" | "reopened" | null; unmarked: number; days_since_end: number }[];
      };
      attendance_stats: {
        Args: { p_from?: string | null; p_to?: string | null; p_team?: string | null; p_season?: string | null; p_athlete?: string | null; p_group?: "player" | "team" };
        Returns: { team_id: string; team_name: string; athlete_id: string | null; first_name: string | null; last_name: string | null;
                   sessions: number; present: number; late: number; excused: number; unexcused: number; rate: number | null }[];
      };
      attendance_alerts_followup: {
        Args: { p_limit?: number };
        Returns: { alert_id: string; status: string; kind: string; mark_status: string; attempts: number; last_error: string | null; created_at: string;
                   event_id: string; starts_at: string; team_id: string | null; team_name: string | null; athlete_id: string; first_name: string;
                   last_name: string; guardian_profile_id: string | null; guardian_name: string | null }[];
      };
      attendance_correction_requests_list: {
        Args: { p_status?: string | null; p_athlete?: string | null };
        Returns: { request_id: string; status: string; event_id: string; starts_at: string; team_id: string; team_name: string; athlete_id: string;
                   first_name: string; last_name: string; current_status: string; requested_status: string | null; mark_status: string | null;
                   message: string; requested_by: string | null; requested_by_name: string | null; created_at: string;
                   resolved_at: string | null; resolved_by_name: string | null; resolution_note: string | null }[];
      };
      session_access_list: {
        Args: { p_status?: string | null };
        Returns: { assignment_id: string; status: string; role: string; event_id: string; starts_at: string; team_id: string | null;
                   team_name: string | null; coach_id: string; coach_name: string; request_note: string | null; decision_note: string | null;
                   created_at: string; decided_at: string | null }[];
      };
      guardian_attendance_overview: { Args: { p_athlete: string; p_from?: string | null; p_to?: string | null }; Returns: Json };
      player_attendance_overview: { Args: { p_from?: string | null; p_to?: string | null }; Returns: Json };
      attendance_review_flags: { Args: { p_org: string }; Returns: number };
      attendance_due_alerts: { Args: Record<string, never>; Returns: number };
      team_memberships_apply_due: { Args: Record<string, never>; Returns: number };
      attendance_alerts_claim: {
        Args: { p_limit?: number; p_org?: string | null };
        Returns: { alert_id: string; org_id: string; kind: "initial" | "correction"; mark_status: string; attempts: number; channel_results: Json;
                   notification_id: string | null; guardian_profile_id: string | null; guardian_email: string | null; guardian_name: string | null;
                   guardian_locale: string | null; receives_emails: boolean; event_id: string; athlete_id: string;
                   athlete_first_name: string; athlete_last_name: string; team_name: string | null; event_type: string;
                   starts_at: string; ends_at: string; timezone: string }[];
      };
      // family attendance UI (20250420104300)
      attendance_alert_email_failed: { Args: { p_provider_id: string; p_error: string }; Returns: number };
      guardian_attendance_record: { Args: { p_event: string; p_athlete: string }; Returns: Json };
      attendance_alert_record: { Args: { p_alert: string; p_status: "sent" | "failed" | "no_contact"; p_channel_results: Json; p_error?: string | null; p_notification_id?: string | null }; Returns: Json };
      training_break_save: { Args: { p_id: string | null; p_label: string; p_starts_on: string; p_ends_on: string; p_season?: string | null }; Returns: Json };
      training_break_delete: { Args: { p_id: string }; Returns: Json };
      training_breaks_list: {
        Args: { p_season?: string | null };
        Returns: { id: string; season_id: string | null; label: string; starts_on: string; ends_on: string; cancelled_sessions: number | null }[];
      };
      // ---- Billing foundation (migration 20250420103500) --------------------
      club_installment_schedule: {
        Args: { p_total: number; p_count: number; p_first_due_month: string; p_due_day: number; p_season_end: string | null; p_currency?: string };
        Returns: { seq: number; due_on: string; amount: number }[];
      };
      club_season_months_without_installment: {
        Args: { p_first_due_month: string; p_count: number; p_season_start: string; p_season_end: string }; Returns: string[];
      };
      club_billing_settings: { Args: Record<string, never>; Returns: Json };
      club_billing_settings_set: { Args: { p_payload: Json }; Returns: Json };
      club_season_bounds: { Args: { p_on: string; p_start_month?: number | null }; Returns: { starts_on: string; ends_on: string }[] };
      season_set_current: { Args: { p_season: string }; Returns: Json };
      billing_entity_save: { Args: { p_payload: Json }; Returns: Json };
      billing_entity_route_set: { Args: { p_activity: string; p_entity: string | null }; Returns: Json };
      invoice_set_billing_entity: { Args: { p_invoice: string; p_entity: string }; Returns: Json };
      invoice_set_activity: { Args: { p_invoice: string; p_activity: string; p_reason: string }; Returns: Json };
      data_review_flag_resolve: { Args: { p_flag: string; p_note?: string | null }; Returns: Json };
      family_credit_assign_activity: {
        Args: { p_family: string; p_currency: string; p_activity: string; p_amount: number; p_reason: string }; Returns: Json;
      };
      family_balance_by_activity: {
        Args: { p_family: string };
        Returns: {
          activity: string; currency: string; open_count: number; amount_due: number; paid: number; balance: number;
          overdue_count: number; overdue_balance: number; credit: number;
        }[];
      };
      receipt_record: { Args: { p_payload: Json }; Returns: Json };
      receipt_allocate: { Args: { p_receipt: string; p_allocations: Json; p_request_id?: string | null }; Returns: Json };
      receipt_void: { Args: { p_receipt: string; p_reason: string }; Returns: Json };
      receipt_unallocated: {
        Args: Record<string, never>;
        Returns: {
          receipt_id: string; family_id: string | null; payer_name: string | null; amount: number; allocated: number; unallocated: number;
          currency: string; received_on: string; method: string; reference: string | null; bank_entry_id: string | null; created_at: string;
        }[];
      };
      membership_preview: { Args: { p_payload: Json }; Returns: Json };
      membership_issue: { Args: { p_payload: Json }; Returns: Json };
      membership_carry_forward: {
        Args: { p_from: string; p_to: string; p_amount: number; p_reason: string; p_request_id?: string | null }; Returns: Json;
      };
      membership_summary: { Args: { p_membership: string }; Returns: Json };
      invoice_source: { Args: { p_invoice: string }; Returns: Json };
      invoice_number_series_set: { Args: { p_category: string; p_prefix: string | null; p_is_active?: boolean }; Returns: Json };
      invoice_totals_by_category: {
        Args: { p_from: string | null; p_to: string | null; p_entity?: string | null; p_status?: string | null };
        Returns: { category: string; currency: string; invoice_count: number; invoiced: number; received: number; outstanding: number }[];
      };
      billing_category_label: { Args: { p_invoice: string }; Returns: string | null };
      // sponsored players (20250420102400)
      sponsorship_apply_open_invoices: { Args: { p_athlete: string; p_dry_run?: boolean }; Returns: Json };
      sponsorship_apply_service: { Args: { p_invoice: string }; Returns: Json };
      get_public_tenant: {
        Args: { p_host?: string | null; p_slug?: string | null };
        Returns: {
          id: string; slug: string; name: string; custom_domain: string | null; branding: Json; terminology: Json;
          sport: string | null; country: string | null; default_locale: string | null; supported_locales: string[] | null;
          currency: string | null; timezone: string | null; status: string | null;
        }[];
      };
      // AI assistant opt-in (migration 20250420095500)
      set_org_ai_assistant: { Args: { p_enabled: boolean }; Returns: boolean };
      org_ai_assistant_entitled: { Args: { p_org: string }; Returns: boolean };
      org_ai_assistant_enabled: { Args: { p_org: string }; Returns: boolean };
      anonymise_family: { Args: { p_family: string }; Returns: Json };
      // remove a person everywhere (20250420102500)
      preview_delete_athlete: { Args: { p_athlete: string }; Returns: Json };
      preview_delete_family: { Args: { p_family: string }; Returns: Json };
      delete_athlete: { Args: { p_athlete: string; p_mode?: string }; Returns: Json };
      delete_family: { Args: { p_family: string; p_mode?: string }; Returns: Json };
      remove_guardian: { Args: { p_family: string; p_profile: string }; Returns: Json };
      restore_person: { Args: { p_deletion: string }; Returns: Json };
      erase_person_deletion: { Args: { p_deletion: string }; Returns: Json };
      purge_due_person_deletions: { Args: { p_limit?: number }; Returns: Json };
      person_deletions_due_notice: { Args: { p_days?: number }; Returns: { org_id: string; deletion_id: string; kind: string; purge_after: string }[] };
      // archive / delete a team, programme division teams (20250420102700)
      preview_delete_team: { Args: { p_team: string }; Returns: Json };
      delete_team: { Args: { p_team: string; p_mode?: string }; Returns: Json };
      restore_team: { Args: { p_team: string }; Returns: Json };
      create_division_team: { Args: { p_division: string; p_name?: string | null }; Returns: string };
      selection_delete_division: { Args: { p_division: string; p_move_to?: string | null; p_team_mode?: string }; Returns: Json };
      set_coach_photo: { Args: { p_coach: string; p_path: string | null }; Returns: string | null };
      coach_usage: { Args: { p_coach: string }; Returns: Json };
      delete_coach_if_unused: { Args: { p_coach: string }; Returns: Json };
      withdraw_consent: { Args: { p_id: string }; Returns: Json };
      withdraw_consent_with_reason: { Args: { p_id: string; p_reason: string }; Returns: Json };
      next_invoice_number: { Args: { p_org: string }; Returns: string };
      register_public: { Args: { p_payload: Json }; Returns: Json };
      create_manual_invoice: { Args: { p_payload: Json }; Returns: Json };
      record_manual_payment: {
        Args: { p_invoice: string; p_amount: number; p_method: string; p_reference?: string; p_note?: string };
        Returns: Json;
      };
      apply_stripe_payment: {
        Args: {
          p_invoice: string; p_amount: number; p_payment_intent: string; p_charge?: string;
          p_method?: string; p_currency?: string; p_account?: string; p_fee?: number; p_method_detail?: string;
        };
        Returns: Json;
      };
      // Regional payments (migration 20250420091800)
      apply_stripe_refund: {
        Args: { p_payment_intent: string; p_refund_id: string; p_amount: number; p_currency?: string; p_account?: string };
        Returns: Json;
      };
      // Payments review fixes (migration 20250420095300)
      apply_stripe_dispute_loss: {
        Args: { p_payment_intent: string; p_dispute_id: string; p_amount: number; p_currency?: string; p_account?: string };
        Returns: Json;
      };
      claim_stripe_event: { Args: { p_id: string; p_type: string; p_account?: string; p_livemode?: boolean }; Returns: boolean };
      finish_stripe_event: { Args: { p_id: string; p_status: string; p_error?: string }; Returns: undefined };
      set_stripe_connect_account: {
        Args: {
          p_org: string; p_account_id: string; p_account_type?: string;
          p_charges_enabled?: boolean; p_payouts_enabled?: boolean; p_details_submitted?: boolean;
        };
        Returns: Json;
      };
      org_for_stripe_account: { Args: { p_account: string }; Returns: string | null };
      resolve_application_fee: { Args: { p_org: string; p_amount_minor: number }; Returns: number };
      get_org_payment_profile: { Args: { p_org: string }; Returns: Json };
      update_payment_settings: { Args: { p_patch: Json }; Returns: Json };
      create_installment_plan: {
        Args: { p_invoice: string; p_count: number; p_first_due: string; p_frequency?: string };
        Returns: Json;
      };
      create_recurring_plan: { Args: { p_payload: Json }; Returns: Json };
      run_recurring_billing: { Args: { p_org: string; p_as_of?: string }; Returns: number };
      installments_due: {
        Args: { p_org: string; p_as_of?: string };
        Returns: {
          installment_id: string; plan_id: string; invoice_id: string | null; family_id: string;
          seq: number; due_date: string; amount: number; currency: string;
        }[];
      };
      installment_schedule: {
        Args: { p_total: number; p_count: number; p_start: string; p_frequency?: string; p_currency?: string; p_interval_count?: number };
        Returns: { seq: number; due_date: string; amount: number }[];
      };
      invoice_net_paid: { Args: { p_invoice: string }; Returns: number };
      flag_overdue_invoices: { Args: { p_org: string }; Returns: number };
      open_attendance_session: { Args: { p_program_session: string }; Returns: Json };
      save_attendance: { Args: { p_session: string; p_marks: Json; p_submit?: boolean }; Returns: Json };
      session_roster: {
        Args: { p_attendance_session: string };
        Returns: {
          athlete_id: string;
          full_name: string;
          status: "present" | "late" | "absent" | "excused" | null;
          notes: string | null;
          injury_flag: boolean;
          allergies: string | null;
          conditions: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
        }[];
      };
      book_training_slot: { Args: { p_athlete: string; p_service: string; p_slot: string }; Returns: Json };
      cancel_training_booking: { Args: { p_booking: string }; Returns: Json };
      book_training_session: { Args: { p_athlete: string; p_service: string; p_slot: string; p_pay_with?: string }; Returns: Json };
      reschedule_booking: { Args: { p_booking: string; p_new_slot: string }; Returns: Json };
      // club ops admin edit (20250420095800)
      admin_update_booking: { Args: { p_booking: string; p_service: string; p_coach: string; p_start: string; p_end: string | null; p_status: string; p_notes?: string | null }; Returns: Json };
      admin_cancel_booking: { Args: { p_booking: string; p_reason: string }; Returns: Json };
      correct_attendance: { Args: { p_session: string; p_marks: Json; p_reason?: string | null }; Returns: Json };
      reopen_attendance_session: { Args: { p_session: string; p_reason?: string | null }; Returns: Json };
      grant_training_credits: { Args: { p_athlete: string; p_category: string; p_credits: number }; Returns: Json };
      // Money editing (migration 20250420095900)
      update_draft_invoice: { Args: { p_invoice: string; p_payload: Json }; Returns: Json };
      update_invoice_details: { Args: { p_invoice: string; p_payload: Json }; Returns: Json };
      issue_invoice_adjustment: {
        Args: { p_invoice: string; p_kind: string; p_amount: number | null; p_reason: string; p_description?: string | null };
        Returns: Json;
      };
      void_invoice_adjustment: { Args: { p_adjustment: string; p_reason: string }; Returns: Json };
      cancel_invoice: { Args: { p_invoice: string; p_reason: string }; Returns: Json };
      reopen_invoice: { Args: { p_invoice: string; p_reason: string }; Returns: Json };
      record_offline_payment: {
        Args: { p_invoice: string; p_amount: number; p_method: string; p_paid_on?: string | null; p_reference?: string | null; p_note?: string | null };
        Returns: Json;
      };
      void_payment: { Args: { p_payment: string; p_reason: string }; Returns: Json };
      edit_manual_payment: { Args: { p_payment: string; p_payload: Json; p_reason: string }; Returns: Json };
      annotate_payment: { Args: { p_payment: string; p_note: string }; Returns: Json };
      transfer_overpayment_to_credit: { Args: { p_invoice: string; p_amount?: number | null; p_reason?: string | null }; Returns: Json };
      apply_family_credit: { Args: { p_invoice: string; p_amount?: number | null; p_reason?: string | null }; Returns: Json };
      // p_activity (migration 20250420103500): the 5-argument overload scopes the credit to an activity; without it the credit is unassigned.
      adjust_family_credit: { Args: { p_family: string; p_currency: string; p_amount: number; p_reason: string; p_activity?: string | null }; Returns: Json };
      adjust_training_credits: {
        Args: { p_athlete: string; p_category: string; p_delta?: number | null; p_new_total?: number | null; p_reason: string };
        Returns: Json;
      };
      athlete_attendance_summary: {
        Args: { p_athlete: string };
        Returns: { session_date: string; program_name: string | null; status: "present" | "late" | "absent" | "excused" }[];
      };
      set_cover: {
        Args: { p_target: string; p_id: string; p_path: string | null; p_focal_x?: number; p_focal_y?: number; p_public_consent?: boolean };
        Returns: Json;
      };
      media_cover_targets: { Args: Record<string, never>; Returns: string[] };
      media_asset_usage: { Args: { p_ids: string[] }; Returns: { asset_id: string; uses: number }[] };
      qrr_check_digit: { Args: { p_ref: string }; Returns: string };
      gen_qr_reference: { Args: { p_org: string; p_seed: string }; Returns: string };
      find_invoice_by_reference: { Args: { p_org: string; p_reference: string }; Returns: string };
      athlete_safety: {
        Args: { p_athlete: string };
        Returns: {
          allergies: string | null;
          conditions: string | null;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
        }[];
      };
    };
    Enums: {
      app_role: AppRole;
      invoice_status:
        | "draft"
        | "pending"
        | "paid"
        | "overdue"
        | "void"
        | "refunded"
        | "sent"
        | "partially_paid"
        | "cancelled"
        | "written_off";
      payment_method: "card" | "bank_transfer" | "twint" | "manual" | "qr_bill" | "sepa_debit" | "ach" | "ideal" | "bancontact" | "apple_pay" | "google_pay";
      attendance_status: "present" | "late" | "absent" | "excused";
    };
    CompositeTypes: Record<string, never>;
  };
};

// Convenience row aliases
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Athlete = Database["public"]["Tables"]["athletes"]["Row"];
export type Invoice = Database["public"]["Tables"]["invoices"]["Row"];
export type Program = Database["public"]["Tables"]["programs"]["Row"];
