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
            | "refunded";
          due_date: string | null;
          issued_at: string;
          paid_at: string | null;
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
          kind: "camp" | "recurring_team" | "clinic" | "tournament";
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
          is_active: boolean;
        };
        Insert: Record<string, unknown>;
        Update: Partial<{ profile_id: string | null; display_name: string; is_active: boolean }>;
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
        };
        Insert: {
          org_id: string | null;
          athlete_id: string;
          consent_form_id: string;
          accepted_version: number;
          accepted_by?: string | null;
        };
        Update: Record<string, unknown>;
        Relationships: [];
      };
      families: {
        Row: {
          id: string;
          org_id: string;
          name: string;
          address: string | null;
          phone: string | null;
          contact_name: string | null;
          contact_email: string | null;
          primary_contact_id: string | null;
          created_at: string;
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
    };
    Views: Record<string, never>;
    Functions: {
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
      withdraw_consent: { Args: { p_id: string }; Returns: Json };
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
      athlete_attendance_summary: {
        Args: { p_athlete: string };
        Returns: { session_date: string; program_name: string | null; status: "present" | "late" | "absent" | "excused" }[];
      };
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
        | "refunded";
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
