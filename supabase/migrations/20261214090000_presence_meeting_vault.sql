-- ============================================================================
-- Meet Sync durable meeting memory — Sync-native markdown/JSON vault.
--
-- Behavior reference only: persistent notes outside the model, no vector DB.
-- Sync-native table, not a third-party note app and not a parallel
-- Decision Case / evidence / approval / conversation store.
--
-- Canonical reuse:
--   organizations / user_profiles -- tenant + signed-in owner
--   Decision Case identity stays in the existing case workspace
--   sessionStorage remains the tab cache; this table is the signed-in SoR
--
-- Governance: notes recommend, they do not authorize. No plant execute.
-- ============================================================================

create table if not exists public.presence_meeting_vault (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  path text not null,
  kind text not null check (kind in (
    'index',
    'session',
    'daily_meeting',
    'decision_continuity'
  )),
  title text not null,
  body_markdown text not null default '',
  body_json jsonb not null default '{}'::jsonb,
  decision_case_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, path),
  check (jsonb_typeof(body_json) = 'object'),
  check (body_json ->> 'governance' = 'recommend_not_authorize'),
  check (char_length(body_markdown) <= 100000),
  check (octet_length(body_json::text) <= 100000),
  check (char_length(path) <= 160),
  check (path ~ '^(index\.md|session\.json|meetings/[0-9]{4}-[0-9]{2}-[0-9]{2}\.md|decisions/[A-Za-z0-9._-]{1,80}\.md)$'),
  check (
    (kind = 'index' and path = 'index.md')
    or (kind = 'session' and path = 'session.json')
    or (kind = 'daily_meeting' and path like 'meetings/%.md')
    or (kind = 'decision_continuity' and path like 'decisions/%.md')
  )
);

comment on table public.presence_meeting_vault is
  'Signed-in Meet Sync notes (markdown/JSON vault shape). Owner-scoped continuity only — not a Decision Case, evidence, approval, or authorization store.';
comment on column public.presence_meeting_vault.decision_case_id is
  'Optional pointer to an existing Decision Case identity. Not a parallel case row.';
comment on column public.presence_meeting_vault.body_json is
  'Structured twin of the markdown note. Must carry governance=recommend_not_authorize.';

create index if not exists idx_presence_meeting_vault_owner
  on public.presence_meeting_vault (organization_id, user_id, updated_at desc);

alter table public.presence_meeting_vault enable row level security;

drop policy if exists presence_meeting_vault_owner_read on public.presence_meeting_vault;
create policy presence_meeting_vault_owner_read
  on public.presence_meeting_vault for select to authenticated
  using (
    organization_id = public.app_current_org()
    and user_id = auth.uid()
  );

drop policy if exists presence_meeting_vault_owner_insert on public.presence_meeting_vault;
create policy presence_meeting_vault_owner_insert
  on public.presence_meeting_vault for insert to authenticated
  with check (
    organization_id = public.app_current_org()
    and user_id = auth.uid()
  );

drop policy if exists presence_meeting_vault_owner_update on public.presence_meeting_vault;
create policy presence_meeting_vault_owner_update
  on public.presence_meeting_vault for update to authenticated
  using (
    organization_id = public.app_current_org()
    and user_id = auth.uid()
  )
  with check (
    organization_id = public.app_current_org()
    and user_id = auth.uid()
  );

create or replace function public.presence_meeting_vault_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'presence_meeting_vault requires a signed-in user';
  end if;
  new.user_id := auth.uid();
  new.organization_id := public.app_current_org();
  if new.organization_id is null then
    raise exception 'presence_meeting_vault requires an organization session';
  end if;
  new.updated_at := now();
  if new.body_json is null or jsonb_typeof(new.body_json) <> 'object' then
    new.body_json := '{}'::jsonb;
  end if;
  new.body_json := new.body_json || jsonb_build_object(
    'governance',
    'recommend_not_authorize'
  );
  return new;
end;
$$;

drop trigger if exists trg_presence_meeting_vault_stamp on public.presence_meeting_vault;
create trigger trg_presence_meeting_vault_stamp
  before insert or update on public.presence_meeting_vault
  for each row execute function public.presence_meeting_vault_stamp();

revoke all on function public.presence_meeting_vault_stamp() from public, anon, authenticated;
revoke all on table public.presence_meeting_vault from public, anon;
grant select, insert, update on table public.presence_meeting_vault to authenticated;
