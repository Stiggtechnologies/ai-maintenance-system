-- ============================================================================
-- First-party product analytics (ui_events) — Tier 2 of the analytics plan.
--
-- Governance-clean by construction: NO customer content is ever recorded —
-- only event names, route, and device class, written through the governed
-- RPC with organization_id set server-side from the session. Read access is
-- admin/ai_admin of the same organization only. No third party involved.
-- ============================================================================

create table if not exists public.ui_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null check (char_length(event_name) between 1 and 64),
  event_detail text check (char_length(event_detail) <= 160),
  route text not null check (char_length(route) <= 200),
  device_class text not null default 'desktop' check (device_class in ('mobile', 'desktop')),
  created_at timestamptz not null default now()
);

create index if not exists idx_ui_events_org_time
  on public.ui_events(organization_id, created_at desc);
create index if not exists idx_ui_events_name_time
  on public.ui_events(event_name, created_at desc);

alter table public.ui_events enable row level security;

-- Read: admin/ai_admin of the same organization only.
drop policy if exists ui_events_read on public.ui_events;
create policy ui_events_read on public.ui_events
  for select to authenticated
  using (
    organization_id = public.app_current_org()
    and exists (
      select 1 from user_profiles p
      where p.id = auth.uid()
        and p.organization_id = public.app_current_org()
        and p.role in ('admin', 'ai_admin')
    )
  );

-- No insert/update/delete policies for clients: writes go through
-- log_ui_events (SECURITY DEFINER), which sets organization_id server-side
-- and validates the event vocabulary.

-- ---------------------------------------------------------------------------
-- log_ui_events — batch write path. Client sends ONLY event payloads; the
-- organization, user, and device integrity are established here.
-- ---------------------------------------------------------------------------
create or replace function public.log_ui_events(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_inserted int;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;

  if p_events is null or jsonb_array_length(p_events) = 0 then
    return jsonb_build_object('logged', 0);
  end if;
  if jsonb_array_length(p_events) > 50 then
    return jsonb_build_object('error', 'batch too large (max 50 events)');
  end if;

  insert into ui_events
    (organization_id, user_id, event_name, event_detail, route, device_class)
  select
    v_org,
    auth.uid(),
    nullif(e->>'event_name', ''),
    left(nullif(e->>'event_detail', ''), 160),
    left(coalesce(e->>'route', '/'), 200),
    case when e->>'device_class' = 'mobile' then 'mobile' else 'desktop' end
  from jsonb_array_elements(p_events) e
  where char_length(coalesce(e->>'event_name', '')) between 1 and 64;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object('logged', v_inserted);
end
$$;

revoke execute on function public.log_ui_events(jsonb) from public, anon;
grant execute on function public.log_ui_events(jsonb) to authenticated;
