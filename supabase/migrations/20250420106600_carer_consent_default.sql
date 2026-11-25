-- Carer consent with per-child links (founder decision):
--   * a relative approved or invited for one child gets the consent
--     permission by default (forms tick it; the app sends can_consent = true);
--   * a consent given by a linked relative counts like a guardian's.
-- The club setting privacy.carers_may_consent still decides whether the
-- permission is used (athlete_link_can(.., 'consent') checks it). Until now a
-- NEW grant while the setting was OFF raised CARER_CONSENT_DISABLED; now it is
-- stored as not granted (false) instead, so approvals and invitations never
-- fail because of the setting. Same signature; additive / idempotent.
create or replace function public.athlete_link_consent_value(p_org uuid, p_requested boolean, p_current boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(p_requested, false) and not coalesce(p_current, false) and not public.org_carer_consent_enabled(p_org) then
    return false;
  end if;
  return coalesce(p_requested, p_current, false);
end $$;
