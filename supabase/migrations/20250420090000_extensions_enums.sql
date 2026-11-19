-- ============================================================================
-- DLang Basketball — Club Operating System
-- Migration 01 · Extensions, enum types, generic functions
-- Target: Supabase Postgres (provides the `auth` schema, `service_role`,
--         and `auth.uid()` automatically).
-- ============================================================================

-- ---- Extensions -----------------------------------------------------------
create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";         -- case-insensitive email

-- ---- Enum types -----------------------------------------------------------
-- One source of truth for status values referenced across the schema.

create type public.app_role as enum ('admin', 'finance', 'coach', 'parent');

create type public.program_kind as enum ('camp', 'recurring_team', 'clinic', 'tournament');

create type public.registration_status as enum ('pending', 'confirmed', 'waitlist', 'cancelled', 'completed');

create type public.invoice_status as enum ('draft', 'pending', 'paid', 'overdue', 'void', 'refunded');

create type public.payment_method as enum ('card', 'bank_transfer', 'twint', 'manual', 'qr_bill');

create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');

create type public.attendance_status as enum ('present', 'late', 'absent', 'excused');

create type public.attendance_session_status as enum ('open', 'submitted', 'locked');

create type public.booking_status as enum ('booked', 'completed', 'no_show', 'cancelled');

create type public.credit_category as enum ('personal', 'nutrition', 'mental');

create type public.consent_acceptance_status as enum ('accepted', 'withdrawn', 'expired');

create type public.document_kind as enum ('consent_pdf', 'medical', 'insurance', 'photo', 'other');

create type public.notification_type as enum ('practice', 'payment', 'training', 'registration', 'system', 'other');

create type public.email_status as enum ('queued', 'sent', 'delivered', 'bounced', 'failed');

-- ---- Generic utility: keep updated_at fresh -------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'BEFORE UPDATE trigger fn: stamps updated_at = now() on every row update.';
