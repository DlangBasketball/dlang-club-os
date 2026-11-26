-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 16 · AI assistant query audit (v2 feature)
--
-- Records every AI question for accountability. We log the question, a short
-- answer preview, whether the answer was grounded in records, and whether the
-- user was escalated to human support. The full grounding context (which may
-- contain PII) is NEVER stored here. Append-only (no update/delete policy).
-- ============================================================================

create table if not exists public.ai_queries (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  actor_id       uuid references public.profiles(id) on delete set null,
  role           text,
  question       text not null,
  answer_preview text,
  grounded       boolean not null default true,
  escalated      boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists ai_queries_actor_idx on public.ai_queries (actor_id, created_at desc);
create index if not exists ai_queries_org_idx   on public.ai_queries (org_id, created_at desc);

alter table public.ai_queries enable row level security;
alter table public.ai_queries force row level security;

-- A user sees their own AI history; admins see the whole org's.
drop policy if exists ai_queries_select on public.ai_queries;
create policy ai_queries_select on public.ai_queries for select
  using (actor_id = auth.uid() or (org_id = public.current_org_id() and public.is_admin()));

-- Inserts happen server-side via the service role; this policy covers the
-- session-client path and pins the row to the caller.
drop policy if exists ai_queries_insert on public.ai_queries;
create policy ai_queries_insert on public.ai_queries for insert
  with check (org_id = public.current_org_id() and actor_id = auth.uid());

grant select, insert on public.ai_queries to authenticated, service_role;
