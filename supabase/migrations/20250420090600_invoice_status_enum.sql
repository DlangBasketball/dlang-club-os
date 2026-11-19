-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 06a · Extend invoice_status enum
--
-- New values must be committed in their own transaction before any later
-- migration can USE them, so this file contains ONLY the ALTER TYPE statements.
-- Legacy values 'pending' and 'void' remain in the type for compatibility but
-- are migrated to 'sent' / 'cancelled' in 06b and no longer produced by the app.
-- ============================================================================

alter type public.invoice_status add value if not exists 'sent';
alter type public.invoice_status add value if not exists 'partially_paid';
alter type public.invoice_status add value if not exists 'cancelled';
