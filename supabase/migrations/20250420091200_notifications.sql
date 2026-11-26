-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 13 · Notification system
--
-- Builds on the base schema, which already ships `notifications` and
-- `email_logs` (+ an `email_status` enum). This migration:
--   1. adds the fine-grained notification types the product needs
--   2. adds an "archived" state to notifications (unread / read / archived)
--   3. adds retry + delivery bookkeeping to email_logs (attempts, html, sent_at…)
--   4. opens an UPDATE policy on email_logs so staff retries are auditable
-- All statements are idempotent so it is safe to re-run.
-- ============================================================================

-- 1. Fine-grained notification types -----------------------------------------
-- (ADD VALUE auto-commits under psql; the new labels are used at runtime only.)
alter type public.notification_type add value if not exists 'registration_confirmation';
alter type public.notification_type add value if not exists 'invoice_sent';
alter type public.notification_type add value if not exists 'payment_received';
alter type public.notification_type add value if not exists 'payment_overdue';
alter type public.notification_type add value if not exists 'booking_confirmation';
alter type public.notification_type add value if not exists 'booking_cancellation';
alter type public.notification_type add value if not exists 'attendance_submitted';
alter type public.notification_type add value if not exists 'document_uploaded';
alter type public.notification_type add value if not exists 'consent_required';

-- 2. Archived state ----------------------------------------------------------
alter table public.notifications add column if not exists archived_at timestamptz;

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc) where read_at is null and archived_at is null;
create index if not exists notifications_recipient_idx
  on public.notifications (recipient_id, created_at desc);

-- 3. email_logs delivery + retry bookkeeping ---------------------------------
alter table public.email_logs add column if not exists attempts        integer not null default 0;
alter table public.email_logs add column if not exists html            text;
alter table public.email_logs add column if not exists notification_id uuid references public.notifications(id) on delete set null;
alter table public.email_logs add column if not exists sent_at         timestamptz;
alter table public.email_logs add column if not exists updated_at      timestamptz not null default now();

create index if not exists email_logs_status_idx  on public.email_logs (org_id, status, created_at desc);

-- 4. Allow finance/admin to UPDATE a log (retry bumps attempts/status) --------
drop policy if exists email_logs_update on public.email_logs;
create policy email_logs_update on public.email_logs for update
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());

grant select, insert, update on public.email_logs to authenticated, service_role;
grant select, insert, update on public.notifications to authenticated, service_role;
