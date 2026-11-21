-- ============================================================================
-- Website import polish (additive, idempotent)
--
-- 1. site_import_map.content_hash   hash of the content the importer wrote.
--                                   A re-import compares it with the current
--                                   row: equal -> nobody edited it since, safe
--                                   to update; different -> the admin edited
--                                   it, kept unless "overwrite my edits".
-- 2. site_settings.contact_phone /  club contact details shown in the site
--    contact_address                footer (imported from the old website or
--                                   typed by the admin). Club data, not
--                                   personal data of members.
-- 3. site_public_settings()         also returns the two contact fields.
--
-- RLS: unchanged (both tables already have admin-only policies for every
-- verb, org_id = current_org_id()). Tests: tests/db/site_import_polish.sql.
-- ============================================================================

-- 1) Content hash of the last import -----------------------------------------
alter table public.site_import_map add column if not exists content_hash text;

do $$ begin
  alter table public.site_import_map add constraint site_import_map_hash_chk
    check (content_hash is null or content_hash ~ '^[0-9a-f]{16,128}$');
exception when duplicate_object then null; end $$;

comment on column public.site_import_map.content_hash is
  'sha256 (hex) of the content the importer last wrote; a re-import overwrites the row only while it still matches (no admin edits) unless the admin asks to overwrite.';

-- 2) Contact details ----------------------------------------------------------
alter table public.site_settings add column if not exists contact_phone text;
alter table public.site_settings add column if not exists contact_address text;

do $$ begin
  alter table public.site_settings add constraint site_settings_contact_phone_chk
    check (contact_phone is null or (length(contact_phone) between 3 and 40 and contact_phone ~ '^[+0-9 ().\/-]+$'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.site_settings add constraint site_settings_contact_address_chk
    check (contact_address is null or length(contact_address) between 1 and 300);
exception when duplicate_object then null; end $$;

-- 3) Public settings RPC (same contract + contact fields) ---------------------
create or replace function public.site_public_settings(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'template', s.template, 'home_page_id', s.home_page_id, 'header_nav', s.header_nav,
           'footer_columns', s.footer_columns, 'social_links', s.social_links, 'logo_path', s.logo_path,
           'favicon_path', s.favicon_path, 'fonts', s.fonts, 'palette', s.palette,
           'default_language', s.default_language, 'languages', to_jsonb(s.languages), 'seo', s.seo,
           'analytics', s.analytics, 'contact_email', s.contact_email,
           'contact_phone', s.contact_phone, 'contact_address', s.contact_address,
           'updated_at', s.updated_at)
    from public.site_settings s
   where s.org_id = p_org and s.enabled;
$$;

revoke all on function public.site_public_settings(uuid) from public;
grant execute on function public.site_public_settings(uuid) to anon, authenticated, service_role;
