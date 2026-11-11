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
          org_id: string;
          full_name: string | null;
          email: string;
          phone: string | null;
          locale: string;
          is_active: boolean;
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database["public"]["Tables"]["profiles"]["Row"]> & {
          id: string;
          org_id: string;
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
          method: "card" | "bank_transfer" | "twint" | "manual" | "qr_bill";
          status:
            | "pending"
            | "succeeded"
            | "failed"
            | "refunded"
            | "partially_refunded";
          stripe_charge_id: string | null;
          stripe_payment_intent_id: string | null;
          qr_reference: string | null;
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
        Row: { id: string; org_id: string; athlete_id: string; service_id: string; coach_id: string; slot_start: string; slot_end: string | null; status: "booked" | "completed" | "no_show" | "cancelled"; paid_with: string | null; invoice_id: string | null; credits_used: number; price_chf: number | null; notes: string | null; created_by: string | null };
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
          payment_methods: string[];
          settings: Json;
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
        Args: { p_invoice: string; p_amount: number; p_payment_intent: string; p_charge?: string };
        Returns: Json;
      };
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
      payment_method: "card" | "bank_transfer" | "twint" | "manual" | "qr_bill";
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
