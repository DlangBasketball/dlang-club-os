-- ============================================================================
-- DLang Basketball — test data for the family/athlete module
-- Idempotent (fixed UUIDs + ON CONFLICT). Safe to re-run.
-- ============================================================================

-- A third family with an athlete (gives the list + detail pages more content)
insert into public.families (id, org_id, name, address, phone) values
  ('00000000-0000-0000-0000-000000000063','00000000-0000-0000-0000-000000000001','Rossi family','Carouge, Genève','+41 76 555 12 34')
on conflict (id) do nothing;

insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, gender, nationality, school, jersey_size, dominant_hand, position_pref, status) values
  ('00000000-0000-0000-0000-000000000074','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000063','Giulia','Rossi','2015-06-30','Female','Italian / Swiss','EIB','YM','Right','Guard','active')
on conflict (id) do nothing;

insert into public.athlete_medical (id, org_id, athlete_id, allergies, conditions, insurance, emergency_contact_name, emergency_contact_phone) values
  ('00000000-0000-0000-0000-0000000000d7','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000074','None declared','None','CSS','Marco Rossi (father)','+41 76 555 99 88')
on conflict (id) do nothing;

insert into public.registrations (id, org_id, athlete_id, program_id, status) values
  ('00000000-0000-0000-0000-000000000084','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000074','00000000-0000-0000-0000-000000000043','confirmed')
on conflict (id) do nothing;

-- Documents (pointers to private Storage objects) for the documents section
insert into public.documents (id, org_id, athlete_id, family_id, kind, storage_path, file_name, mime_type) values
  ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000061','consent_pdf','org/001/athlete/071/consent-media-v1.pdf','Media consent (signed).pdf','application/pdf'),
  ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000061','insurance','org/001/athlete/071/insurance-card.pdf','Insurance card.pdf','application/pdf'),
  ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000072','00000000-0000-0000-0000-000000000062','medical','org/001/athlete/072/allergy-action-plan.pdf','Allergy action plan.pdf','application/pdf')
on conflict (id) do nothing;
